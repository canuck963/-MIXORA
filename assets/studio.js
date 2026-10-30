/* Extends the existing editor without replacing manual editing, overlay or WAV export. */
'use strict';
const studioPanel=document.createElement('section');studioPanel.className='card';
studioPanel.innerHTML='<h2>✦ Üç farklı remix yönü</h2><p>Aynı iki parçadan üç düzenleme taslağı. Bunlar kurallı önerilerdir; vokal ayrımı veya müzikal cümle analizi yapmaz. A ve B için başlangıç/bitiş seç. Önerileri çizelgeni değiştirmeden dinle, beğendiğini uygula. Yapay bas efekti eklenmez.</p><div id="threeSuggestions" class="suggestions"></div><h3>Çalışmanı sakla</h3><label>Proje adı<input id="projectName" maxlength="90" value="Yeni remix"></label><button id="saveProject">Projeyi bu cihazda sakla</button><button id="restoreProject" class="muted">Son projeyi aç</button><button id="saveLocalMix">Remixi cihaz kütüphaneme kaydet</button><a class="studio-link" href="community.html">Toplulukta yayımla ↗</a><p class="tiny">Proje ses dosyalarını da saklar. Cihaz depolaması temizlenirse kaybolabilir; WAV yedeğini indir. Toplulukta yayımlamak için WAV dosyanı seç.</p>';
document.querySelector('main').append(studioPanel);
const suggestionNames=['Duygusal','Enerjik','Sinematik'];
function selectedSuggestion(i){
  const ranges={};for(const id of ['A','B'])ranges[id]={start:Number($('start'+id).value),end:Number($('end'+id).value)};
  return MixCore.suggestions(tracks.A?.buffer.duration,tracks.B?.buffer.duration,ranges)[i];
}
for(let i=0;i<3;i++){
  const card=document.createElement('div');card.className='suggestion-card';
  const title=document.createElement('h3');title.textContent=(i+1)+'. '+suggestionNames[i];
  const preview=document.createElement('button');preview.textContent='▶ Dinle';preview.dataset.preview=i;preview.setAttribute('aria-label',suggestionNames[i]+' önerisini dinle');
  preview.onclick=async()=>{try{const s=selectedSuggestion(i);await play(s.clips,s.fade);note('▶ '+s.name+' önizlemesi. Çizelgen değişmedi. '+s.description);}catch(e){note(e.message);}};
  const apply=document.createElement('button');apply.textContent='Çizelgeye uygula';apply.dataset.apply=i;apply.setAttribute('aria-label',suggestionNames[i]+' önerisini uygula');
  apply.onclick=()=>{try{const s=selectedSuggestion(i);stop();clips.splice(0,clips.length,...s.clips);$('fade').value=s.fade;$('fade').dispatchEvent(new Event('input'));render();note(s.name+' hazır. '+s.description);}catch(e){note(e.message);}};
  card.append(title,preview,apply);$('threeSuggestions').append(card);
}
const previewStop=document.createElement('button');previewStop.textContent='⏹ Önizlemeyi durdur';previewStop.onclick=()=>{stop();note('⏹ Durduruldu.');};$('threeSuggestions').after(previewStop);
function openDB(name,store){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function writeDB(name,store,value){const db=await openDB(name,store);try{await new Promise((resolve,reject)=>{const t=db.transaction(store,'readwrite');t.objectStore(store).put(value);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Kayıt iptal edildi.'));});}finally{db.close();}}
async function latestProject(){const db=await openDB('mixora-studio','projects');try{return await new Promise((resolve,reject)=>{const r=db.transaction('projects').objectStore('projects').get('latest');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
async function busy(id,fn){const button=$(id);button.disabled=true;try{await fn();}catch(e){note('İşlem tamamlanamadı: '+e.message);}finally{button.disabled=false;}}
$('saveProject').onclick=()=>busy('saveProject',async()=>{
  if(!tracks.A||!tracks.B||!clips.length)throw Error('İki parçayı yükle ve çizelge oluştur.');
  const files={};for(const id of ['A','B']){const file=tracks[id].file;files[id]={name:file.name,type:file.type,bytes:await file.arrayBuffer()};}
  await writeDB('mixora-studio','projects',{id:'latest',name:$('projectName').value,files,clips:structuredClone(clips),fade:Number($('fade').value)});note('✓ Proje ve kaynak sesler bu cihazda saklandı.');
});
$('restoreProject').onclick=()=>busy('restoreProject',async()=>{
  const project=await latestProject();if(!project)throw Error('Saklanmış proje yok.');
  // Decode everything before mutating the working project.
  const next={};for(const id of ['A','B']){const saved=project.files[id],file=saved.bytes?new File([saved.bytes],saved.name,{type:saved.type}):saved;next[id]={file,buffer:await ctx.decodeAudioData(await file.arrayBuffer())};}
  MixCore.plan(project.clips,project.fade);
  for(const c of project.clips)if(c.end>next[c.id].buffer.duration+.001)throw Error('Proje kesitleri ses süresini aşıyor.');
  stop();for(const id of ['A','B']){loadVersions[id]++;tracks[id]=next[id];$('name'+id).textContent=next[id].file.name;$('start'+id).value=0;$('end'+id).value=String(next[id].buffer.duration);draw(id);}
  clips.splice(0,clips.length,...project.clips);$('fade').value=project.fade;$('fade').dispatchEvent(new Event('input'));$('projectName').value=project.name;render();note('✓ Proje açıldı.');
});
$('saveLocalMix').onclick=()=>busy('saveLocalMix',async()=>{
  if(!clips.length)throw Error('Önce çizelge oluştur.');
  const length=plan(clips).length;if(length>300)throw Error('Cihaz kütüphanesi için en fazla 5 dakika seç.');
  note('Ses hazırlanıyor…');const engine=new OfflineAudioContext(2,Math.ceil((length+.2)*44100),44100);schedule(clips,engine,0);
  const file=new File([wav(await engine.startRendering())],'MIXORA-remix.wav',{type:'audio/wav'});
  await writeDB('mixora-community-demo','posts',{id:crypto.randomUUID(),author:'Ben',title:$('projectName').value||'Yeni remix',description:'MIXORA Studio kaydı',fileBytes:await file.arrayBuffer(),fileName:file.name,fileType:file.type,created:Date.now(),likes:0,liked:false,comments:[]});
  note('✓ Remix kaydedildi. Cihazdaki kayıtlar sayfasından dinleyip ses dosyasını paylaşabilirsin.');
});
window.addEventListener('pagehide',()=>stop());
