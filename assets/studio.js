/* Extends the existing editor without replacing manual editing, overlay or WAV export. */
'use strict';
const studioPanel=document.createElement('section');studioPanel.className='card';
studioPanel.innerHTML='<h2>✦ Üç farklı remix yönü</h2><p>Aynı iki parçadan üç düzenleme taslağı. Bunlar kurallı önerilerdir; vokal ayrımı veya müzikal cümle analizi yapmaz. Kesme noktalarını dinleyerek düzenle.</p><div id="threeSuggestions" class="suggestions"></div><h3>Çalışmanı sakla</h3><label>Proje adı<input id="projectName" maxlength="90" value="Yeni remix"></label><button id="saveProject">Projeyi bu cihazda sakla</button><button id="restoreProject" class="muted">Son projeyi aç</button><button id="saveLocalMix">Remixi cihaz kütüphaneme kaydet</button><a class="studio-link" href="community.html">Toplulukta yayımla ↗</a><p class="tiny">Proje ses dosyalarını da saklar. Cihaz depolaması temizlenirse kaybolabilir; WAV yedeğini indir. Toplulukta yayımlamak için WAV dosyanı seç.</p>';
document.querySelector('main').append(studioPanel);
const suggestionNames=['Akıcı geçiş','Enerjik DROP','Sinematik katman'];
for(let i=0;i<3;i++){
  const button=document.createElement('button');button.textContent=(i+1)+'. '+suggestionNames[i];
  button.onclick=()=>{try{const s=MixCore.suggestions(tracks.A?.buffer.duration,tracks.B?.buffer.duration)[i];stop();clips.splice(0,clips.length,...s.clips);$('fade').value=s.fade;$('fade').dispatchEvent(new Event('input'));render();note(s.name+' hazır. '+s.description);}catch(e){note(e.message);}};
  $('threeSuggestions').append(button);
}
function openDB(name,store){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function writeDB(name,store,value){const db=await openDB(name,store);try{await new Promise((resolve,reject)=>{const t=db.transaction(store,'readwrite');t.objectStore(store).put(value);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Kayıt iptal edildi.'));});}finally{db.close();}}
async function latestProject(){const db=await openDB('mixora-studio','projects');try{return await new Promise((resolve,reject)=>{const r=db.transaction('projects').objectStore('projects').get('latest');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
async function busy(id,fn){const button=$(id);button.disabled=true;try{await fn();}catch(e){note('İşlem tamamlanamadı: '+e.message);}finally{button.disabled=false;}}
$('saveProject').onclick=()=>busy('saveProject',async()=>{
  if(!tracks.A||!tracks.B||!clips.length)throw Error('İki parçayı yükle ve çizelge oluştur.');
  await writeDB('mixora-studio','projects',{id:'latest',name:$('projectName').value,files:{A:tracks.A.file,B:tracks.B.file},clips:structuredClone(clips),fade:Number($('fade').value)});note('✓ Proje ve kaynak sesler bu cihazda saklandı.');
});
$('restoreProject').onclick=()=>busy('restoreProject',async()=>{
  const project=await latestProject();if(!project)throw Error('Saklanmış proje yok.');
  // Decode everything before mutating the working project.
  const next={};for(const id of ['A','B']){const file=project.files[id];next[id]={file,buffer:await ctx.decodeAudioData(await file.arrayBuffer())};}
  MixCore.plan(project.clips,project.fade);
  for(const c of project.clips)if(c.end>next[c.id].buffer.duration+.001)throw Error('Proje kesitleri ses süresini aşıyor.');
  stop();for(const id of ['A','B']){tracks[id]=next[id];$('name'+id).textContent=next[id].file.name;$('start'+id).value=0;$('end'+id).value=String(next[id].buffer.duration);draw(id);}
  clips.splice(0,clips.length,...project.clips);$('fade').value=project.fade;$('fade').dispatchEvent(new Event('input'));$('projectName').value=project.name;render();note('✓ Proje açıldı.');
});
$('saveLocalMix').onclick=()=>busy('saveLocalMix',async()=>{
  if(!clips.length)throw Error('Önce çizelge oluştur.');
  const length=plan(clips).length;if(length>300)throw Error('Cihaz kütüphanesi için en fazla 5 dakika seç.');
  note('Ses hazırlanıyor…');const engine=new OfflineAudioContext(2,Math.ceil((length+.2)*44100),44100);schedule(clips,engine,0);
  const file=new File([wav(await engine.startRendering())],'MIXORA-remix.wav',{type:'audio/wav'});
  await writeDB('mixora-community-demo','posts',{id:crypto.randomUUID(),author:'Ben',title:$('projectName').value||'Yeni remix',description:'MIXORA Studio kaydı',file,created:Date.now(),likes:0,liked:false,comments:[]});
  note('✓ Remix kaydedildi. Cihazdaki kayıtlar sayfasından dinleyip ses dosyasını paylaşabilirsin.');
});
window.addEventListener('pagehide',()=>stop());
