'use strict';
const $ = id => document.getElementById(id);
let user = null, offset = 0, online = false;
const status = text => { $('status').textContent = text; };
async function api(path, options = {}) {
  const response = await fetch('api/' + path, {credentials:'same-origin', ...options});
  if (!response.headers.get('content-type')?.includes('application/json')) throw Error('Topluluk sunucusu bağlı değil. Cihazdaki kayıtlar bağlantısından yerel demoyu kullanabilirsin.');
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'İşlem başarısız.');
  return result;
}
const json = (method, data) => ({method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
function el(tag, text, cls) { const e=document.createElement(tag); if(text!==undefined)e.textContent=text; if(cls)e.className=cls; return e; }
function button(text, fn) { const b=el('button',text); b.type='button'; b.onclick=()=>run(b,fn); return b; }
async function run(button, fn) {button.disabled=true;try{await fn();}catch(e){status(e.message);}finally{button.disabled=false;}}
function session(value) {user=value; $('auth').classList.toggle('hidden',!!user); $('profile').classList.toggle('hidden',!user); if(user){$('profileName').value=user.name;$('bio').value=user.bio;} }
async function authenticate(register) {const data={email:$('email').value,password:$('password').value,name:$('name').value}; const result=await api(register?'register':'login',json('POST',data));session(result.user);$('password').value='';status(result.verification_required?result.message:'Hoş geldin, '+user.name);await feed(true);}
$('authForm').onsubmit=e=>{e.preventDefault();run(e.submitter,()=>authenticate(false));};
for(const [id,path] of [['forgotPassword','forgot-password'],['resendVerification','request-verification']]){
  $(id).onclick=()=>run($(id),async()=>{if(!$('email').reportValidity())return;const result=await api(path,json('POST',{email:$('email').value}));status(result.message);});
}
$('register').onclick=()=>run($('register'),()=>authenticate(true));
$('profileForm').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{session((await api('profile',json('PATCH',{name:$('profileName').value,bio:$('bio').value}))).user);status('Profil kaydedildi.');await feed(true);});};
$('logout').onclick=()=>run($('logout'),async()=>{await api('logout',{method:'POST'});session(null);status('Çıkış yaptın.');await feed(true);});
$('publishForm').onsubmit=e=>{e.preventDefault();run($('publishBtn'),async()=>{
  if(!online)throw Error('Yayımlamak için MIXORA sunucusu gerekli.');
  if(!user)throw Error('Önce giriş yap.');
  const file=$('audioFile').files[0];if(!file||file.size>60*1024*1024)throw Error('En fazla 60 MB ses dosyası seç.');
  // Server checks size and signatures; decoder validation is a production follow-up.
  const params=new URLSearchParams({title:$('title').value,description:$('description').value,rights:$('rights').checked?'yes':'no'});
  status('Ses dosyası yükleniyor…');
  const result=await api('posts?'+params,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
  history.replaceState(null,'',location.pathname+'?post='+result.id);$('publishForm').reset();await feed(true);status('Remixin yayımlandı. Paylaş düğmesinden bağlantısını gönderebilirsin.');
});};
async function card(post){
  const box=el('article',undefined,'post');box.id='post-'+post.id;
  box.append(el('span','REMIX','tag'),el('h3',post.title));
  const creator=button(post.name,async()=>{const profile=await api('profiles/'+post.user_id);status(profile.name+(profile.bio?' — '+profile.bio:' · Henüz biyografi yok.'));});box.append(creator,el('p',new Date(post.created*1000).toLocaleDateString('tr-TR'),'meta'));
  if(post.description)box.append(el('p',post.description));
  const audio=el('audio');audio.controls=true;audio.preload='none';audio.src='api/posts/'+post.id+'/audio';audio.setAttribute('aria-label',post.title);audio.onplay=()=>document.querySelectorAll('audio').forEach(a=>{if(a!==audio)a.pause();});box.append(audio);
  const actions=el('div',undefined,'actions');
  const like=button((post.liked?'♥ ':'♡ ')+post.likes,async()=>{if(!user)throw Error('Beğenmek için giriş yap.');await api('posts/'+post.id+'/likes',{method:post.liked?'DELETE':'POST'});post.likes+=post.liked?-1:1;post.liked=!post.liked;like.textContent=(post.liked?'♥ ':'♡ ')+post.likes;});actions.append(like);
  actions.append(button('Bağlantıyı paylaş ↗',async()=>{const url=new URL(location.href);url.search='?post='+post.id;url.hash='';if(navigator.share){try{await navigator.share({title:post.title,url:url.href});}catch(e){if(e.name!=='AbortError')throw e;}}else{await navigator.clipboard.writeText(url.href);status('Bağlantı kopyalandı.');}}));
  if(user?.id===post.user_id)actions.append(button('Sil',async()=>{if(confirm('Bu remix herkese açık akıştan silinsin mi?')){await api('posts/'+post.id,{method:'DELETE'});box.remove();status('Remix silindi.');}}));box.append(actions);
  const details=el('details'),summary=el('summary',post.comments+' yorum'),list=el('div');details.append(summary,list);
  async function comments(){const data=await api('posts/'+post.id+'/comments');list.replaceChildren(...data.comments.map(c=>el('div',c.name+' · '+c.body,'comment')));}
  details.ontoggle=()=>{if(details.open)comments().catch(e=>status(e.message));};
  const form=el('form'),input=el('input');input.placeholder='Yorumunu yaz';input.setAttribute('aria-label','Yorum');input.maxLength=500;input.required=true;const send=el('button','Yorum ekle');form.append(input,send);form.onsubmit=e=>{e.preventDefault();run(send,async()=>{await api('posts/'+post.id+'/comments',json('POST',{body:input.value}));input.value='';await comments();summary.textContent=(++post.comments)+' yorum';});};details.append(form);box.append(details);return box;
}
async function feed(reset=false){
  if(reset){offset=0;$('feed').replaceChildren();}
  const selected=new URLSearchParams(location.search).get('post');
  const data=selected?{posts:[await api('posts/'+encodeURIComponent(selected))]}:await api('posts?offset='+offset);
  for(const post of data.posts)$('feed').append(await card(post));offset+=data.posts.length;
  $('more').hidden=!!selected||data.posts.length<20;
  if(!offset)$('feed').append(el('div','Henüz remix yok. İlk sesi sen paylaş.','panel'));
}
$('more').onclick=()=>run($('more'),()=>feed());
(async()=>{try{session((await api('me')).user);online=true;await feed(true);status(user?'Hoş geldin, '+user.name:'Dinlemek için hesap gerekmez. Paylaşmak için giriş yap.');}catch(e){status(e.message);$('publishBtn').disabled=true;}})();
