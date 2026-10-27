import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlencode

TEMP=tempfile.TemporaryDirectory()
os.environ['MIXORA_DATA']=TEMP.name
import server

class API(unittest.TestCase):
    def call(self,path,method='GET',data=None,cookie='',headers=None,raw=None):
        payload=raw if raw is not None else json.dumps(data).encode() if data is not None else b''
        path,_,query=path.partition('?')
        env={'PATH_INFO':path,'QUERY_STRING':query,'REQUEST_METHOD':method,'CONTENT_LENGTH':str(len(payload)),
             'CONTENT_TYPE':'application/json','wsgi.input':io.BytesIO(payload),'HTTP_ORIGIN':server.ORIGIN,
             'HTTP_COOKIE':cookie,'REMOTE_ADDR':self.id()}
        env.update(headers or {})
        out={}
        def start(status,headers):out.update(status=int(status.split()[0]),headers=dict(headers))
        result=b''.join(server.application(env,start))
        out['body']=json.loads(result) if 'application/json' in out['headers'].get('Content-Type','') else result
        return out
    def register(self,email='a@example.com'):
        r=self.call('/api/register','POST',{'email':email,'password':'a-strong-password','name':'DJ Can'})
        self.assertEqual(r['status'],200,r)
        return r['headers']['Set-Cookie'].split(';')[0],r['body']['user']['id']
    def setUp(self):
        with server.connect() as db:
            for table in ['comments','likes','posts','sessions','users','limits']:db.execute('DELETE FROM '+table)
    def post(self,cookie):
        import wave
        wav=io.BytesIO()
        with wave.open(wav,'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(8000);f.writeframes(b'\x00\x00'*8000)
        raw=wav.getvalue()
        r=self.call('/api/posts?'+urlencode({'title':'Test remix','description':'<script>alert(1)</script>','rights':'yes'}),'POST',cookie=cookie,raw=raw)
        self.assertEqual(r['status'],201,r)
        return r['body']['id'],raw
    def test_full_lifecycle_and_ownership(self):
        a,uid=self.register();b,_=self.register('b@example.com');pid,raw=self.post(a)
        self.assertEqual(self.call('/api/me',cookie=a)['body']['user']['id'],uid)
        self.assertEqual(self.call('/api/posts/'+pid,'DELETE',cookie=b)['status'],403)
        self.assertEqual(self.call('/api/posts/'+pid+'/audio')['body'],raw)
        part=self.call('/api/posts/'+pid+'/audio',headers={'HTTP_RANGE':'bytes=2-9'})
        self.assertEqual(part['status'],206);self.assertEqual(part['body'],raw[2:10])
        self.assertEqual(self.call('/api/posts/'+pid+'/audio',headers={'HTTP_RANGE':'bytes=999999-'})['status'],416)
        for _ in range(2): self.assertEqual(self.call('/api/posts/'+pid+'/likes','POST',cookie=b)['status'],200)
        self.assertEqual(self.call('/api/posts')['body']['posts'][0]['likes'],1)
        self.assertEqual(self.call('/api/posts/'+pid+'/comments','POST',{'body':'Güzel remix'},cookie=b)['status'],201)
        self.assertEqual(len(self.call('/api/posts/'+pid+'/comments')['body']['comments']),1)
        self.assertEqual(self.call('/api/profile','PATCH',{'name':'Can','bio':'DJ'},cookie=a)['status'],200)
        self.assertEqual(self.call('/api/profiles/'+uid)['body']['bio'],'DJ')
        self.assertEqual(self.call('/api/posts/'+pid,'DELETE',cookie=a)['status'],200)
        self.assertEqual(self.call('/api/posts/'+pid+'/audio')['status'],404)
        with server.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM likes').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM comments').fetchone()[0],0)
    def test_account_deletion_requires_password_and_cleans_up(self):
        a,uid=self.register()
        b,bid=self.register('b@example.com')
        own_post,_=self.post(a)
        other_post,_=self.post(b)
        self.assertEqual(self.call('/api/posts/'+own_post+'/likes','POST',cookie=b)['status'],200)
        self.assertEqual(self.call('/api/posts/'+own_post+'/comments','POST',{'body':'Hello'},cookie=b)['status'],201)
        self.assertEqual(self.call('/api/posts/'+other_post+'/comments','POST',{'body':'My comment'},cookie=a)['status'],201)
        wrong=self.call('/api/account','DELETE',{'password':'incorrect'},cookie=a)
        self.assertEqual(wrong['status'],403)
        self.assertEqual(self.call('/api/me',cookie=a)['body']['user']['id'],uid)
        self.assertEqual(self.call('/api/account','DELETE',{'password':'a-strong-password'},cookie=a)['status'],200)
        self.assertIsNone(self.call('/api/me',cookie=a)['body']['user'])
        self.assertEqual(self.call('/api/posts/'+own_post)['status'],404)
        self.assertEqual(self.call('/api/posts/'+other_post)['status'],200)
        self.assertEqual(self.call('/api/posts/'+other_post+'/comments')['body']['comments'],[])
        self.assertEqual(self.call('/api/profiles/'+uid)['status'],404)
        self.assertEqual(self.call('/api/me',cookie=b)['body']['user']['id'],bid)
        with server.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM sessions WHERE user_id=?',(uid,)).fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM likes').fetchone()[0],0)

    def test_security(self):
        cookie,_=self.register()
        self.assertEqual(self.call('/api/profile','PATCH',{'name':'Evil','bio':''},cookie=cookie,headers={'HTTP_ORIGIN':'https://evil.test'})['status'],403)
        self.assertEqual(self.call('/api/posts','POST',{},cookie='')['status'],401)
        for path in ['/server.py','/data/mixora.sqlite','/../server.py','/.env']:
            self.assertEqual(self.call(path)['status'],404)
        self.assertEqual(self.call('/api/login','POST',{'email':'a@example.com','password':'wrong-password'})['status'],401)
        self.assertEqual(self.call('/api/logout','POST',cookie=cookie)['status'],200)
        self.assertIsNone(self.call('/api/me',cookie=cookie)['body']['user'])
    def test_limits_validation_and_password_storage(self):
        cookie,_=self.register()
        with server.connect() as db:
            row=db.execute('SELECT password FROM users').fetchone()[0]
            self.assertNotIn('a-strong-password',row)
            self.assertEqual(len(row.split(':')),2)
        self.assertEqual(self.call('/api/posts?title=bad&description=&rights=yes','POST',cookie=cookie,raw=b'<html>not audio</html>')['status'],415)
        self.assertEqual(self.call('/api/posts?title=bad&description=&rights=no','POST',cookie=cookie,raw=b'RIFF0000WAVE')['status'],400)
        self.assertEqual(self.call('/api/profile','PATCH',{'name':'x'*41,'bio':''},cookie=cookie)['status'],400)
        self.assertEqual(self.call('/api/profile','PATCH',raw=b'{',cookie=cookie)['status'],400)
        self.assertEqual(self.call('/api/posts?offset=bad')['status'],400)
        for _ in range(16):r=self.call('/api/login','POST',{'email':'a@example.com','password':'wrong-password'})
        self.assertEqual(r['status'],429)

    def test_email_verification_blocks_session_until_verified(self):
        from unittest.mock import patch
        from urllib.parse import urlsplit, parse_qs
        settings={'MIXORA_SMTP_HOST':'smtp.test','MIXORA_SMTP_FROM':'noreply@example.com','MIXORA_SMTP_USER':'test','MIXORA_SMTP_PASSWORD':'test'}
        # Sessions created before email enforcement must also be rejected.
        old_cookie,old_uid=self.register('old@example.com')
        with patch.dict(os.environ,settings), patch.object(server,'send_email') as mail:
            self.assertIsNone(self.call('/api/me',cookie=old_cookie)['body']['user'])
            result=self.call('/api/register','POST',{'email':'new@example.com','password':'a-strong-password','name':'New DJ'})
            self.assertTrue(result['body']['verification_required'])
            self.assertNotIn('Set-Cookie',result['headers'])
            credentials={'email':'new@example.com','password':'a-strong-password'}
            self.assertEqual(self.call('/api/login','POST',credentials)['status'],403)
            link=mail.call_args.args[2].splitlines()[-1]
            url=urlsplit(link)
            token=parse_qs(url.query)['token'][0]
            with server.connect() as db:
                self.assertFalse(db.execute('SELECT 1 FROM email_tokens WHERE token=?',(token,)).fetchone())
            self.assertEqual(self.call(url.path+'?'+url.query)['status'],200)
            self.assertEqual(self.call(url.path+'?'+url.query)['status'],400)
            login=self.call('/api/login','POST',credentials)
            self.assertEqual(login['status'],200)
            self.assertIn('Set-Cookie',login['headers'])

    def test_password_reset_is_single_use_and_revokes_sessions(self):
        from unittest.mock import patch
        cookie,uid=self.register()
        with patch.object(server,'require_email_service'), patch.object(server,'send_email') as mail:
            result=self.call('/api/forgot-password','POST',{'email':'a@example.com'})
            self.assertEqual(result['status'],200)
            raw=mail.call_args.args[2].split('token=')[1]
            data={'token':raw,'password':'new-strong-password'}
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=2) as pool:
                results=list(pool.map(lambda _:self.call('/api/reset-password','POST',data)['status'],range(2)))
            self.assertEqual(sorted(results),[200,400])
            self.assertEqual(self.call('/api/reset-password','POST',data)['status'],400)
            self.assertIsNone(self.call('/api/me',cookie=cookie)['body']['user'])
            self.assertEqual(self.call('/api/login','POST',{'email':'a@example.com','password':'a-strong-password'})['status'],401)
            self.assertEqual(self.call('/api/login','POST',{'email':'a@example.com','password':'new-strong-password'})['status'],200)

    def test_email_delivery_failure_rolls_back_and_missing_config_is_uniform(self):
        from unittest.mock import patch
        cookie,uid=self.register()
        with patch.dict(os.environ,{'MIXORA_SMTP_HOST':''}):
            for email in ['a@example.com','missing@example.com']:
                self.assertEqual(self.call('/api/forgot-password','POST',{'email':email})['status'],503)
        with patch.object(server,'require_email_service'), patch.object(server,'send_email',side_effect=OSError('offline')):
            self.assertEqual(self.call('/api/forgot-password','POST',{'email':'a@example.com'})['status'],503)
            with server.connect() as db:
                self.assertEqual(db.execute('SELECT count(*) FROM email_tokens').fetchone()[0],0)
        with patch.dict(os.environ,{'MIXORA_SMTP_HOST':'smtp.test'}), patch.object(server,'send_email',side_effect=OSError('offline')):
            self.assertEqual(self.call('/api/register','POST',{'email':'failed@example.com','password':'a-strong-password','name':'DJ'})['status'],503)
            with server.connect() as db:
                self.assertIsNone(db.execute('SELECT id FROM users WHERE email=?',('failed@example.com',)).fetchone())

if __name__=='__main__':unittest.main()
