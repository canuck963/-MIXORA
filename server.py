"""MIXORA same-origin WSGI API. Run behind HTTPS; see README.md."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import smtplib
import urllib.request
import urllib.error
from email.message import EmailMessage
from urllib.parse import quote, urlencode
import sqlite3
import time
from http.cookies import SimpleCookie
from contextlib import contextmanager
from urllib.parse import parse_qs

ROOT = Path(__file__).parent
DATA = Path(os.environ.get('MIXORA_DATA', ROOT / 'data'))
ORIGIN = os.environ.get('MIXORA_ORIGIN', 'http://localhost:8000').rstrip('/')
SECURE = ORIGIN.startswith('https://')
MAX_AUDIO = 60 * 1024 * 1024
STATIC = {'index.html','Remix.html','remix.html','community.html','local-community.html',
          'assets/platform.css','assets/community.js','assets/studio.js','assets/mix-core.js'}

@contextmanager
def connect():
    db = sqlite3.connect(DATA / 'mixora.sqlite', timeout=20)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

def initialize():
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Multiple Gunicorn workers can initialize simultaneously on startup.
    # Retry transient SQLite writer locks instead of crashing the worker.
    for attempt in range(8):
        try:
            _initialize_schema()
            return
        except sqlite3.OperationalError as exc:
            if 'locked' not in str(exc).lower() or attempt == 7:
                raise
            time.sleep(min(0.25 * (2 ** attempt), 3))

def _initialize_schema():
    with connect() as db:
        db.execute('PRAGMA busy_timeout=20000')
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,name TEXT NOT NULL,bio TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,created REAL NOT NULL,audio BLOB NOT NULL,mime TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS likes(post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(post_id,user_id));
        CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,start REAL NOT NULL,count INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS email_tokens(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,purpose TEXT NOT NULL,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS verified_emails(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,verified_at REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS posts_created ON posts(created DESC);
        CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id,created);
        ''')

class APIError(Exception):
    def __init__(self, status, message): self.status, self.message = status, message

def fail(status, text): raise APIError(status, text)
def field(data, key, maximum, minimum=1):
    value = data.get(key)
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        fail(400, f'{key}: {minimum}–{maximum} karakter gerekli.')
    return value.strip()

def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return salt + ':' + digest

def public_user(row): return {k: row[k] for k in ('id','name','bio')}
def limit(db, key, maximum, window=300):
    now = time.time()
    db.execute('DELETE FROM limits WHERE start < ?', (now-3600,))
    db.execute('INSERT INTO limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN start<? THEN 1 ELSE count+1 END,start=CASE WHEN start<? THEN excluded.start ELSE start END', (key,now,now-window,now-window))
    count = db.execute('SELECT count FROM limits WHERE key=?',(key,)).fetchone()[0]
    db.commit()
    if count > maximum: fail(429, 'Çok fazla istek. Birkaç dakika sonra tekrar dene.')

def body(env, maximum=16384, raw=False):
    try: length = int(env.get('CONTENT_LENGTH') or 0)
    except ValueError: fail(400,'Geçersiz boyut.')
    if not 0 < length <= maximum: fail(413,'Dosya veya istek çok büyük ya da boş.')
    data = env['wsgi.input'].read(length)
    if len(data) != length: fail(400,'Eksik yükleme.')
    if raw: return data
    if env.get('CONTENT_TYPE','').split(';')[0] != 'application/json': fail(415,'JSON gerekli.')
    try: value = json.loads(data)
    except (ValueError,UnicodeDecodeError): fail(400,'Geçersiz JSON.')
    if not isinstance(value,dict): fail(400,'JSON nesnesi gerekli.')
    return value

def session(db, env):
    cookie=SimpleCookie()
    try: cookie.load(env.get('HTTP_COOKIE',''))
    except Exception: return None, None
    token=cookie.get('mixora_session')
    digest=hashlib.sha256(token.value.encode()).hexdigest() if token else ''
    row=db.execute('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?',(digest,time.time())).fetchone()
    if row and email_configured() and not db.execute('SELECT 1 FROM verified_emails WHERE user_id=?',(row['id'],)).fetchone():
        return None,digest
    return row,digest

def audio_type(data):
    if data[:4] == b'RIFF' and data[8:12] == b'WAVE': return 'audio/wav'
    if data[:3] == b'ID3' or (len(data)>1 and data[0]==255 and data[1]&224==224): return 'audio/mpeg'
    if data[4:8] == b'ftyp' and data[8:12] in (b'M4A ',b'isom',b'mp42'): return 'audio/mp4'
    fail(415,'MP3, WAV veya M4A ses dosyası gerekli.')

def email_configured():
    api_ready = bool(os.environ.get('BREVO_API_KEY') and os.environ.get('MIXORA_SMTP_FROM'))
    smtp_ready = all(os.environ.get(key) for key in ('MIXORA_SMTP_HOST','MIXORA_SMTP_FROM','MIXORA_SMTP_USER','MIXORA_SMTP_PASSWORD'))
    return api_ready or smtp_ready

def require_email_service():
    if not email_configured():
        fail(503,'E-posta servisi yapılandırılmadı.')

def send_email(to, subject, message):
    require_email_service()
    if os.environ.get('BREVO_API_KEY'):
        payload=json.dumps({'sender':{'name':'MIXORA','email':os.environ['MIXORA_SMTP_FROM']},'to':[{'email':to}],'subject':subject,'textContent':message}).encode('utf-8')
        req=urllib.request.Request('https://api.brevo.com/v3/smtp/email',data=payload,headers={'api-key':os.environ['BREVO_API_KEY'],'Content-Type':'application/json','Accept':'application/json'},method='POST')
        with urllib.request.urlopen(req,timeout=12) as response:
            if response.status not in (200,201,202):
                raise OSError('Brevo e-posta isteği başarısız')
        return
    host=os.environ.get('MIXORA_SMTP_HOST')
    sender=os.environ.get('MIXORA_SMTP_FROM')
    if not host or not sender:
        fail(503,'E-posta servisi yapılandırılmadı.')
    mail=EmailMessage()
    mail['From']=sender
    mail['To']=to
    mail['Subject']=subject
    mail.set_content(message)
    port=int(os.environ.get('MIXORA_SMTP_PORT','587'))
    with smtplib.SMTP(host,port,timeout=12) as smtp:
        smtp.starttls()
        smtp.login(os.environ['MIXORA_SMTP_USER'],os.environ['MIXORA_SMTP_PASSWORD'])
        smtp.send_message(mail)

def issue_email_token(db, row, purpose):
    raw=secrets.token_urlsafe(32)
    digest=hashlib.sha256(raw.encode()).hexdigest()
    db.execute('DELETE FROM email_tokens WHERE user_id=? AND purpose=?',(row['id'],purpose))
    db.execute('INSERT INTO email_tokens VALUES(?,?,?,?)',(digest,row['id'],purpose,time.time()+1800))
    endpoint='verify-email' if purpose=='verify' else 'reset-password'
    link=ORIGIN+'/api/'+endpoint+'?token='+quote(raw)
    try:
        send_email(row['email'],'MIXORA e-posta işlemi','Bu işlemi sen başlattıysan 30 dakika içinde bağlantıyı aç:\n'+link)
    except (OSError, smtplib.SMTPException, urllib.error.HTTPError):
        fail(503,'E-posta gönderilemedi. Daha sonra tekrar dene.')
    return {'ok':True}

def route(env, db):
    path=env.get('PATH_INFO','/'); method=env['REQUEST_METHOD']; headers=[]
    if method not in ('GET','POST','PATCH','DELETE'): fail(405,'Yöntem desteklenmiyor.')
    if method != 'GET':
        if env.get('HTTP_ORIGIN') != ORIGIN: fail(403,'Kaynak doğrulaması başarısız.')
        limit(db,'ip:'+env.get('REMOTE_ADDR','unknown'),120)
    user,token=session(db,env)
    if path == '/api/youtube/search' and method == 'GET':
        key=os.environ.get('YOUTUBE_API_KEY','')
        if not key: return 503,{'error':'YouTube araması için YOUTUBE_API_KEY ayarlanmalı.'},headers
        params=parse_qs(env.get('QUERY_STRING',''))
        q=params.get('q',[''])[0].strip()[:100]
        if len(q)<2: fail(400,'En az iki karakter yaz.')
        limit(db,'youtube:'+env.get('REMOTE_ADDR','unknown'),40)
        query=urlencode({'part':'snippet','type':'video','videoEmbeddable':'true','maxResults':'12','q':q,'key':key})
        request=urllib.request.Request('https://www.googleapis.com/youtube/v3/search?'+query,headers={'Accept':'application/json'})
        try:
            with urllib.request.urlopen(request,timeout=9) as response:
                data=json.load(response)
        except urllib.error.HTTPError as exc:
            # Google provides actionable status codes (invalid key, quota, restrictions).
            # Do not expose upstream payloads: they may contain request metadata.
            if exc.code in (400, 401, 403):
                # Status only; never log the request URL, credentials or response body.
                # Extract only Google's documented machine-readable reason, not its message or URL.
                reason = 'unknown'
                try:
                    payload = json.loads(exc.read(8192).decode('utf-8'))
                    errors = payload.get('error', {}).get('errors', [])
                    candidate = errors[0].get('reason', '') if errors else ''
                    if isinstance(candidate, str) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', candidate):
                        reason = candidate
                except (ValueError, UnicodeDecodeError, AttributeError, TypeError, IndexError):
                    pass
                # Log a sanitized explanation for diagnosis, never the URL or credentials.
                explanation = payload.get('error', {}).get('message', '') if isinstance(locals().get('payload'), dict) else ''
                if isinstance(explanation, str):
                    explanation = re.sub(r'AIza[A-Za-z0-9_-]+', '[REDACTED_KEY]', explanation)
                    explanation = re.sub(r'https?://\\S+', '[REDACTED_URL]', explanation)[:180]
                else:
                    explanation = ''
                print('YouTube upstream HTTP rejection:', exc.code, 'reason:', reason, 'detail:', explanation, flush=True)
                return 503,{'error':'YouTube API erişimi reddedildi. API anahtarı, kısıtlamaları ve kotayı kontrol edin.','upstream_status':exc.code},headers
            return 502,{'error':'YouTube servisi geçici olarak yanıt vermiyor.','upstream_status':exc.code},headers
        except urllib.error.URLError as exc:
            # Log only the exception class and a bounded network reason; never log the API key or request URL.
            reason = getattr(exc, 'reason', None)
            print('YouTube upstream network failure:', type(reason).__name__ if reason else type(exc).__name__, flush=True)
            return 502,{'error':'YouTube arama servisine ulaşılamadı. Sunucu ağ bağlantısını kontrol edin.'},headers
        except (TimeoutError,ValueError) as exc:
            print('YouTube upstream response failure:', type(exc).__name__, flush=True)
            return 502,{'error':'YouTube arama servisi zaman aşımına uğradı veya geçersiz yanıt verdi.'},headers
        items=[]
        for entry in data.get('items',[]):
            video_id=entry.get('id',{}).get('videoId','')
            snippet=entry.get('snippet',{})
            if re.fullmatch(r'[a-zA-Z0-9_-]{11}',video_id):
                items.append({'id':video_id,'title':snippet.get('title',''),'channel':snippet.get('channelTitle',''),'thumbnail':snippet.get('thumbnails',{}).get('medium',{}).get('url','')})
        return 200,{'items':items},headers
    if path == '/api/health': return 200,{'ok':True},headers
    if path == '/api/readiness' and method == 'GET':
        mail_ready=email_configured()
        public_origin=SECURE and ORIGIN != 'https://localhost:8000'
        return 200,{'ready_for_public_signup':bool(mail_ready and public_origin),'https':SECURE,'email_configured':bool(mail_ready)},headers
    if path == '/api/verify-email' and method == 'GET':
        # Opening a link (including mail scanners) must never consume a token.
        return 200,(ROOT / 'verify-email.html').read_bytes(),[('Content-Type','text/html; charset=utf-8')]
    if path == '/api/verify-email' and method == 'POST':
        raw=field(body(env),'token',256)
        digest=hashlib.sha256(raw.encode()).hexdigest()
        db.execute('BEGIN IMMEDIATE')
        record=db.execute("SELECT user_id FROM email_tokens WHERE token=? AND purpose='verify' AND expires>?",(digest,time.time())).fetchone()
        if not record: fail(400,'Doğrulama bağlantısı geçersiz veya süresi dolmuş.')
        db.execute('INSERT OR REPLACE INTO verified_emails VALUES(?,?)',(record['user_id'],time.time()))
        db.execute('DELETE FROM email_tokens WHERE token=?',(digest,))
        return 200,{'ok':True,'message':'E-posta doğrulandı. Giriş yapabilirsin.'},headers
    if path == '/api/reset-password' and method == 'GET':
        page="""<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MIXORA - Şifre yenile</title><body style="background:#10101b;color:white;font:18px system-ui;max-width:460px;margin:60px auto;padding:20px"><h1>MIXORA</h1><h2>Yeni şifre belirle</h2><form id="reset"><input id="password" type="password" minlength="10" maxlength="128" required placeholder="Yeni şifre (en az 10 karakter)" style="width:100%;padding:14px;box-sizing:border-box"><button style="padding:14px;margin-top:15px">Şifreyi yenile</button></form><p id="result"></p><script>document.querySelector('#reset').addEventListener('submit',async e=>{e.preventDefault();const token=new URLSearchParams(location.search).get('token');const r=await fetch('/api/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:document.querySelector('#password').value})});const d=await r.json();document.querySelector('#result').textContent=r.ok?'Şifren değiştirildi. Şimdi giriş yapabilirsin.':(d.error||'İşlem başarısız.');});</script></body></html>"""
        return 200,page.encode('utf-8'),[('Content-Type','text/html; charset=utf-8')]
    if path == '/api/reset-password' and method == 'POST':
        limit(db,'reset:'+env.get('REMOTE_ADDR','unknown'),5,3600)
        data=body(env)
        raw=field(data,'token',256)
        password=field(data,'password',128,10)
        digest=hashlib.sha256(raw.encode()).hexdigest()
        db.execute('BEGIN IMMEDIATE')
        record=db.execute("SELECT user_id FROM email_tokens WHERE token=? AND purpose='reset' AND expires>?",(digest,time.time())).fetchone()
        if not record: fail(400,'Sıfırlama bağlantısı geçersiz veya süresi dolmuş.')
        db.execute('UPDATE users SET password=? WHERE id=?',(password_hash(password),record['user_id']))
        db.execute('DELETE FROM email_tokens WHERE user_id=?',(record['user_id'],))
        db.execute('DELETE FROM sessions WHERE user_id=?',(record['user_id'],))
        return 200,{'ok':True},headers
    if path in ('/api/request-verification','/api/forgot-password') and method == 'POST':
        limit(db,'email:'+env.get('REMOTE_ADDR','unknown'),5,3600)
        require_email_service()
        data=body(env)
        email=field(data,'email',254).lower()
        row=db.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
        if row:
            if path == '/api/forgot-password':
                issue_email_token(db,row,'reset')
            elif not db.execute('SELECT 1 FROM verified_emails WHERE user_id=?',(row['id'],)).fetchone():
                issue_email_token(db,row,'verify')
        return 200,{'ok':True,'message':'Hesap uygunsa e-posta gönderildi.'},headers
    if path == '/api/me' and method == 'GET': return 200,{'user':public_user(user) if user else None},headers
    if path in ('/api/register','/api/login') and method == 'POST':
        limit(db,'auth:'+env.get('REMOTE_ADDR','unknown'),15)
        data=body(env); email=field(data,'email',254).lower(); password=field(data,'password',128,10)
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email): fail(400,'Geçerli e-posta gerekli.')
        row=db.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
        if path.endswith('register'):
            if SECURE: require_email_service()
            if row: fail(409,'Bu e-posta kullanılamıyor.')
            uid=secrets.token_hex(16); name=field(data,'name',40)
            db.execute('INSERT INTO users(id,email,password,name) VALUES(?,?,?,?)',(uid,email,password_hash(password),name))
            row=db.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()
            if email_configured():
                require_email_service()
                issue_email_token(db,row,'verify')
                return 200,{'user':None,'verification_required':True,'message':'Hesabın oluşturuldu. E-postandaki bağlantıyla doğrula, ardından giriş yap.'},headers
        else:
            stored=row['password'] if row else password_hash('dummy-password')
            valid=hmac.compare_digest(stored,password_hash(password,stored.split(':')[0]))
            if not row or not valid: fail(401,'E-posta veya şifre hatalı.')
            if email_configured() and not db.execute('SELECT 1 FROM verified_emails WHERE user_id=?',(row['id'],)).fetchone(): fail(403,'E-posta doğrulaması gerekli.')
        raw=secrets.token_urlsafe(32); digest=hashlib.sha256(raw.encode()).hexdigest()
        db.execute('DELETE FROM sessions WHERE expires<?',(time.time(),))
        if token: db.execute('DELETE FROM sessions WHERE token=?',(token,))
        db.execute('INSERT INTO sessions VALUES(?,?,?)',(digest,row['id'],time.time()+7*86400))
        headers.append(('Set-Cookie',f'mixora_session={raw}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800'+('; Secure' if SECURE else '')))
        return 200,{'user':public_user(row)},headers
    if path == '/api/logout' and method == 'POST':
        db.execute('DELETE FROM sessions WHERE token=?',(token,))
        headers.append(('Set-Cookie','mixora_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'+('; Secure' if SECURE else '')))
        return 200,{'ok':True},headers
    if path.startswith('/api/') and method != 'GET' and not user: fail(401,'Önce giriş yap.')
    if path == '/api/account' and method == 'DELETE':
        # Require fresh password proof before permanently deleting an account.
        data=body(env)
        password=field(data,'password',128,1)
        limit(db,'delete-account:'+user['id'],5,3600)
        if not hmac.compare_digest(user['password'],password_hash(password,user['password'].split(':')[0])):
            fail(403,'Şifre doğrulanamadı.')
        # Posts have dependent likes/comments; remove them before the user.
        # Other users' comments on this user's posts disappear with those posts.
        db.execute('DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)',(user['id'],))
        db.execute('DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)',(user['id'],))
        db.execute('DELETE FROM posts WHERE user_id=?',(user['id'],))
        db.execute('DELETE FROM comments WHERE user_id=?',(user['id'],))
        db.execute('DELETE FROM likes WHERE user_id=?',(user['id'],))
        db.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
        db.execute('DELETE FROM users WHERE id=?',(user['id'],))
        headers.append(('Set-Cookie','mixora_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'+('; Secure' if SECURE else '')))
        return 200,{'ok':True},headers
    if path == '/api/profile' and method == 'PATCH':
        data=body(env); name=field(data,'name',40); bio=field(data,'bio',300,0)
        db.execute('UPDATE users SET name=?,bio=? WHERE id=?',(name,bio,user['id']))
        return 200,{'user':{'id':user['id'],'name':name,'bio':bio}},headers
    if path == '/api/posts' and method == 'POST':
        limit(db,'upload:'+user['id'],10,3600)
        # Fixed quota bounds per-account storage; production also needs infrastructure quotas.
        db.execute('BEGIN IMMEDIATE')
        used=db.execute('SELECT COALESCE(SUM(length(audio)),0) FROM posts WHERE user_id=?',(user['id'],)).fetchone()[0]
        if used + int(env.get('CONTENT_LENGTH') or 0) > 300*1024*1024: fail(413,'Hesap depolama sınırı 300 MB.')
        params={k:v[0] for k,v in parse_qs(env.get('QUERY_STRING',''),keep_blank_values=True).items()}
        title=field(params,'title',90); description=field(params,'description',400,0)
        if params.get('rights') != 'yes': fail(400,'Paylaşım hakkı onayı gerekli.')
        audio=body(env,MAX_AUDIO,raw=True); mime=audio_type(audio); pid=secrets.token_hex(16)
        db.execute('INSERT INTO posts VALUES(?,?,?,?,?,?,?)',(pid,user['id'],title,description,time.time(),audio,mime))
        return 201,{'id':pid},headers
    if path == '/api/posts' and method == 'GET':
        params=parse_qs(env.get('QUERY_STRING',''))
        try: offset=max(0,min(100000,int(params.get('offset',['0'])[0])))
        except ValueError: fail(400,'Geçersiz sayfa.')
        uid=user['id'] if user else ''
        rows=db.execute('''SELECT p.id,p.user_id,p.title,p.description,p.created,u.name,
          (SELECT count(*) FROM likes WHERE post_id=p.id) likes,
          EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) liked,
          (SELECT count(*) FROM comments WHERE post_id=p.id) comments
          FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.created DESC LIMIT 20 OFFSET ?''',(uid,offset)).fetchall()
        return 200,{'posts':[dict(r) for r in rows]},headers
    match=re.fullmatch(r'/api/(profiles|posts)/([a-f0-9]{32})(?:/(audio|likes|comments))?',path)
    if match:
        kind,pid,action=match.groups()
        if kind=='profiles' and not action and method=='GET':
            row=db.execute('SELECT * FROM users WHERE id=?',(pid,)).fetchone()
            if not row: fail(404,'Profil bulunamadı.')
            return 200,public_user(row),headers
        if kind != 'posts': fail(404,'Bulunamadı.')
        post=db.execute('SELECT id,user_id,title,description,created,mime,length(audio) size FROM posts WHERE id=?',(pid,)).fetchone()
        if not post: fail(404,'Remix bulunamadı.')
        if action == 'audio' and method=='GET':
            size=post['size']; start=0; end=size-1; status=200
            rng=env.get('HTTP_RANGE')
            if rng:
                m=re.fullmatch(r'bytes=(\d*)-(\d*)',rng)
                if not m or not any(m.groups()): fail(416,'Geçersiz aralık.')
                a,b=m.groups()
                if a: start=int(a); end=min(int(b),end) if b else end
                else: start=max(0,size-int(b))
                if start>end or start>=size: fail(416,'Geçersiz aralık.')
                status=206; headers.append(('Content-Range',f'bytes {start}-{end}/{size}'))
            audio=db.execute('SELECT substr(audio,?,?) FROM posts WHERE id=?',(start+1,end-start+1,pid)).fetchone()[0]
            headers.extend([('Content-Type',post['mime']),('Accept-Ranges','bytes')])
            return status,audio,headers
        if not action and method=='GET':
            info=dict(post); info.pop('size'); info.pop('mime')
            info['name']=db.execute('SELECT name FROM users WHERE id=?',(post['user_id'],)).fetchone()[0]
            info['likes']=db.execute('SELECT count(*) FROM likes WHERE post_id=?',(pid,)).fetchone()[0]
            info['liked']=bool(user and db.execute('SELECT 1 FROM likes WHERE post_id=? AND user_id=?',(pid,user['id'])).fetchone())
            info['comments']=db.execute('SELECT count(*) FROM comments WHERE post_id=?',(pid,)).fetchone()[0]
            return 200,info,headers
        if not action and method=='DELETE':
            if post['user_id'] != user['id']: fail(403,'Yalnızca kendi kaydını silebilirsin.')
            db.execute('DELETE FROM posts WHERE id=?',(pid,)); return 200,{'ok':True},headers
        if action=='likes' and method in ('POST','DELETE'):
            if method=='POST': db.execute('INSERT OR IGNORE INTO likes VALUES(?,?)',(pid,user['id']))
            else: db.execute('DELETE FROM likes WHERE post_id=? AND user_id=?',(pid,user['id']))
            return 200,{'ok':True},headers
        if action=='comments' and method=='GET':
            rows=db.execute('SELECT c.id,c.body,c.created,u.name,u.id user_id FROM comments c JOIN users u ON u.id=c.user_id WHERE post_id=? ORDER BY c.created DESC LIMIT 100',(pid,)).fetchall()
            return 200,{'comments':[dict(r) for r in rows]},headers
        if action=='comments' and method=='POST':
            limit(db,'comment:'+user['id'],20)
            data=body(env); text=field(data,'body',500)
            db.execute('INSERT INTO comments VALUES(?,?,?,?,?)',(secrets.token_hex(16),pid,user['id'],text,time.time()))
            return 201,{'ok':True},headers
    if not path.startswith('/api/') and method=='GET':
        filename=path.lstrip('/') or 'index.html'
        if filename not in STATIC: fail(404,'Sayfa bulunamadı.')
        mime='text/html; charset=utf-8' if filename.endswith('.html') else 'text/css' if filename.endswith('.css') else 'text/javascript'
        return 200,(ROOT/filename).read_bytes(),[('Content-Type',mime)]
    fail(404,'Bulunamadı.')

def application(env,start_response):
    try:
        with connect() as db: status,payload,headers=route(env,db)
    except APIError as e: status,payload,headers=e.status,{'error':e.message},[]
    except Exception:
        import traceback
        traceback.print_exc()
        status,payload,headers=500,{'error':'Sunucu hatası. Tekrar dene.'},[]
    if not isinstance(payload,bytes):
        payload=json.dumps(payload,ensure_ascii=False).encode(); headers.append(('Content-Type','application/json; charset=utf-8'))
    headers.extend([('Content-Length',str(len(payload))),('Cache-Control','no-store'),('X-Content-Type-Options','nosniff'),('Referrer-Policy','strict-origin-when-cross-origin'),('X-Frame-Options','DENY'),('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data: https://i.ytimg.com https://*.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")])
    if SECURE: headers.append(('Strict-Transport-Security','max-age=31536000'))
    from http import HTTPStatus
    start_response(f'{status} {HTTPStatus(status).phrase}',headers)
    return [payload]

initialize()
if __name__=='__main__':
    from wsgiref.simple_server import make_server
    print('MIXORA development server: '+ORIGIN)
    make_server('127.0.0.1',8000,application).serve_forever()
