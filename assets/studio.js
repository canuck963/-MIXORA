/* Extends the existing editor without replacing manual editing, overlay or WAV export. */
'use strict';
const studioPanel=document.createElement('section');studioPanel.className='card';
studioPanel.innerHTML='<h2>✦ Üç farklı remix yönü</h2><p>Aynı iki parçadan üç düzenleme taslağı. Bunlar kurallı önerilerdir; vokal ayrımı veya müzikal cümle analizi yapmaz. A ve B için başlangıç/bitiş seç. Önerileri çizelgeni değiştirmeden dinle, beğendiğini uygula. Yapay bas efekti eklenmez.</p><h3>🎚️ Perdeyi koruyarak tempo eşitleme (beta)</h3><p>Seçili A/B kesitlerinin BPM değerlerini karşılaştır. Güvenilir sonuç varsa B parçasını 0,80–1,25× aralığında WSOLA ile A temposuna yaklaştırır. İşlem yalnızca cihazda yapılır; B kesiti en fazla 30 saniye olmalı.</p><button id="analyzeTempoMatch" class="muted">A/B temposunu analiz et</button><button id="applyTempoMatch" disabled>B parçasını A temposuna eşitle</button><button id="clearTempoMatch" class="muted" disabled>Tempo eşitlemeyi kaldır</button><p id="tempoMatchStatus" class="tiny" role="status">Önce iki parçayı yükle. Analiz otomatik oynatma yapmaz.</p><div id="threeSuggestions" class="suggestions"></div><h3>Çalışmanı sakla</h3><label>Proje adı<input id="projectName" maxlength="90" value="Yeni remix"></label><button id="saveProject">Projeyi bu cihazda sakla</button><button id="restoreProject" class="muted">Son projeyi aç</button><button id="saveLocalMix">Remixi cihaz kütüphaneme kaydet</button><a class="studio-link" href="community.html">Toplulukta yayımla ↗</a><p class="tiny">Proje ses dosyalarını da saklar. Cihaz depolaması temizlenirse kaybolabilir; WAV yedeğini indir. Toplulukta yayımlamak için WAV dosyanı seç.</p>';
document.querySelector('main').append(studioPanel);
let analyzedTempoRate=null,appliedTempoRate=null;
function resetTempoMatch(message='Kaynak veya kesit değişti; yeniden analiz et.') {
 analyzedTempoRate=null;appliedTempoRate=null;window.MixoraTempoStretchRate=null;
 for(const clip of clips)if(clip.id==='B')delete clip.stretchRate;
 $('applyTempoMatch').disabled=true;$('clearTempoMatch').disabled=true;$('tempoMatchStatus').textContent=message;
 if(clips.length)render();
}
$('analyzeTempoMatch').onclick=()=>{
 try{
  if(!tracks.A||!tracks.B)throw Error('Önce A ve B parçalarını yükle.');
  const a=analyzeTempo(tracks.A.buffer,Number($('startA').value),Number($('endA').value));
  const b=analyzeTempo(tracks.B.buffer,Number($('startB').value),Number($('endB').value));
  if(!a||!b)throw Error('Seçili kesitlerde güvenilir BPM ölçümü için en az 4 saniyelik düzenli ritim gerekli.');
  if(a.ambiguous||b.ambiguous)throw Error('Tempo belirsiz (yarım/çift zaman veya düzensiz vuruş). Otomatik eşitleme yapılmadı.');
  const match=tempoMatch(a.bpm,b.bpm,.8,1.25);
  if(!match||!match.hasInRange)throw Error('B parçasını A temposuna getirmek için gereken hız 0,80–1,25 aralığının dışında.');
  analyzedTempoRate=match.recommended.rate;$('applyTempoMatch').disabled=false;
  $('tempoMatchStatus').textContent='A '+a.bpm+' BPM · B '+b.bpm+' BPM · B için '+analyzedTempoRate.toFixed(2)+'× önerildi. Uygulamak için düğmeye bas.';
  note('Tempo analizi hazır. B parçası henüz değiştirilmedi.');
 }catch(error){analyzedTempoRate=null;$('applyTempoMatch').disabled=true;$('tempoMatchStatus').textContent=error.message;note(error.message);}
};
$('applyTempoMatch').onclick=()=>{
 try{
  if(analyzedTempoRate===null)throw Error('Önce A/B temposunu analiz et.');
  if(typeof MixoraWsola==='undefined')throw Error('WSOLA motoru yüklenemedi. Sayfayı yenile.');
  const targets=clips.filter(clip=>clip.id==='B');
  if(targets.some(clip=>clip.end-clip.start>MixoraWsola.MAX_DURATION_SECONDS))throw Error('Mevcut B kesitlerinden biri 30 saniyeyi aşıyor. Daha kısa kesit seç.');
  appliedTempoRate=analyzedTempoRate;window.MixoraTempoStretchRate=appliedTempoRate;targets.forEach(clip=>clip.stretchRate=appliedTempoRate);
  $('clearTempoMatch').disabled=false;$('tempoMatchStatus').textContent+=' B kesitlerine perde korunarak uygulanacak.';
  if(clips.length)render();note('Tempo eşitleme ayarı hazır. Önizleme ve WAV aynı WSOLA çıktısını kullanacak.');
 }catch(error){note(error.message);$('tempoMatchStatus').textContent=error.message;}
};
$('clearTempoMatch').onclick=()=>resetTempoMatch('Tempo eşitleme kaldırıldı; kaynak sesler özgün hızında çalacak.');
for(const id of ['fileA','fileB']){const element=$(id);if(typeof element.addEventListener==='function')element.addEventListener('change',()=>resetTempoMatch());}
for(const id of ['startA','endA','startB','endB']){const element=$(id);if(typeof element.addEventListener==='function')element.addEventListener('input',()=>resetTempoMatch());}
const suggestionNames=['Duygusal','Enerjik','Sinematik'];
function selectedSuggestion(i){
  if(typeof appliedTempoRate!=='undefined'&&appliedTempoRate!==null&&typeof MixoraWsola==='undefined')throw Error('WSOLA motoru yüklenemedi. Sayfayı yenile.');
  const ranges={};for(const id of ['A','B'])ranges[id]={start:Number($('start'+id).value),end:Number($('end'+id).value)};
  const suggestion = MixCore.suggestions(tracks.A?.buffer.duration, tracks.B?.buffer.duration, ranges)[i];
  if(typeof appliedTempoRate!=='undefined'&&appliedTempoRate!==null){for(const clip of suggestion.clips){if(clip.id!=='B')continue;if(clip.end-clip.start>MixoraWsola.MAX_DURATION_SECONDS)suggestion.description+=' B kesiti 30 saniyeyi aştığı için WSOLA tempo eşitlemesi uygulanmadı.';else clip.stretchRate=appliedTempoRate;}}
  if (i === 0) {
    const [a, b] = suggestion.clips;
    const maxOverlap = Math.min(suggestion.fade, (a.end - a.start) / 2, (b.end - b.start) / 2);
    const fade = emotionalFade(tracks.B.buffer, b.start, b.end, maxOverlap);
    if (fade !== null) {
      suggestion.fade = fade;
      suggestion.description = 'Geçiş, B bölümünde sesin yükseldiği noktada tamamlanır.';
    }
  }
  if (i === 1) {
    const clip = suggestion.clips[1];
    const quietStart = energeticEntry(tracks.B.buffer, clip.start, clip.end);
    const drop = energeticDropEntry(tracks.B.buffer, quietStart, clip.end);
    const start = drop?.start ?? quietStart;
    if (start > clip.start) {
      clip.start = start;
      suggestion.description = drop
        ? 'B bölümündeki sürdürülen enerji yükselişi, güvenilir ' + drop.bpm +
          ' BPM vuruşuna hizalanarak giriş noktası seçildi (' +
          Math.round(drop.confidence * 100) + '% güven). Kısa geçişle girer.'
        : 'B bölümünün başındaki sessizlik kısaltıldı. Kısa geçişle girer.';
    }
  }
  const entry = suggestion.clips.find(clip => clip.overlay);
  if (entry) {
    const alignment = alignOverlayPair(
      tracks.A.buffer, ranges.A.start, ranges.A.end,
      tracks.B.buffer, ranges.B.start, ranges.B.end, entry.delay
    );
    if (!alignment) {
      suggestion.description += ' A/B kesitlerinde güvenilir ve düşük kaymalı vuruş eşleşmesi bulunamadı; varsayılan giriş korundu.';
    } else {
      entry.start = alignment.start;
      entry.delay = alignment.delay;
      suggestion.description += ' A/B giriş vuruşları eşleştirildi (' + alignment.aBpm + '/' +
        alignment.bBpm + ' BPM; öngörülen kayma ' + Math.round(alignment.driftSeconds * 1000) + ' ms).';
    }
  }
  return suggestion;
}
for(let i=0;i<3;i++){
  const card=document.createElement('div');card.className='suggestion-card';
  const title=document.createElement('h3');title.textContent=(i+1)+'. '+suggestionNames[i];
  const preview=document.createElement('button');preview.textContent='▶ Dinle';preview.dataset.preview=i;preview.setAttribute('aria-label',suggestionNames[i]+' önerisini dinle');
  preview.onclick=async()=>{try{const s=selectedSuggestion(i);note('⏳ '+s.name+' önizlemesi hazırlanıyor…');if(!await play(s.clips,s.fade))return;note('▶ '+s.name+' önizlemesi. Çizelgen değişmedi. '+s.description);}catch(e){note(e.message);}};
  const apply=document.createElement('button');apply.textContent='Çizelgeye uygula';apply.dataset.apply=i;apply.setAttribute('aria-label',suggestionNames[i]+' önerisini uygula');
  apply.onclick=()=>{try{const s=selectedSuggestion(i);stop();clips.splice(0,clips.length,...s.clips);$('fade').value=s.fade;$('fade').dispatchEvent(new Event('input'));render();note(s.name+' hazır. '+s.description);}catch(e){note(e.message);}};
  card.append(title,preview,apply);$('threeSuggestions').append(card);
}
const previewStop=document.createElement('button');previewStop.textContent='⏹ Önizlemeyi durdur';previewStop.onclick=()=>{stop();note('⏹ Durduruldu.');};$('threeSuggestions').after(previewStop);
function openDB(name,store){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function writeDB(name,store,value){const db=await openDB(name,store);try{await new Promise((resolve,reject)=>{const t=db.transaction(store,'readwrite');t.objectStore(store).put(value);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Kayıt iptal edildi.'));});}finally{db.close();}}
async function prepareStretchedBuffers(list,context,signal){
 if(list.some(clip=>Math.abs((clip.stretchRate??1)-1)>=.005)&&typeof MixoraWsola==='undefined')throw Error('WSOLA motoru yüklenemedi. Sayfayı yenile.');
 const prepared=new Map();
 for(const clip of list){if(signal?.aborted){const error=new Error('WSOLA işlemi iptal edildi.');error.name='AbortError';throw error;}const rate=clip.stretchRate??1;if(Math.abs(rate-1)<.005)continue;const track=tracks[clip.id];if(!track?.buffer)throw Error(clip.id+' kaynak sesi bulunamadı.');if(clip.end-clip.start>MixoraWsola.MAX_DURATION_SECONDS)throw Error('WSOLA tempo eşitlemesi en fazla 30 saniyelik kesitlerde kullanılabilir.');prepared.set(clip,await MixoraWsola.stretchAudioBufferAsync(track.buffer,clip.start,clip.end,rate,context,{signal}));}
 return prepared;
}
async function latestProject(){const db=await openDB('mixora-studio','projects');try{return await new Promise((resolve,reject)=>{const r=db.transaction('projects').objectStore('projects').get('latest');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
async function busy(id,fn){const button=$(id);if(button.disabled)return;button.disabled=true;try{await fn();}catch(e){note('İşlem tamamlanamadı: '+e.message);}finally{button.disabled=false;}}
function editorState(){
  return JSON.stringify({clips,fade:$('fade').value,name:$('projectName').value,
    ranges:['A','B'].map(id=>[$('start'+id).value,$('end'+id).value])});
}
const PROJECT_SOURCE_LIMIT=40*1024*1024;
const PROJECT_DURATION_LIMIT=420;
function validateProjectForSave(project,sources,sourceTracks){
  if(!Number.isFinite(project.fade)||project.fade<0||project.fade>5)
    throw Error('Proje geçiş süresi geri açma sınırını aşıyor (en fazla 5 saniye).');
  for(const id of ['A','B']){
    const file=sources[id],duration=sourceTracks[id]?.buffer?.duration,range=project.ranges[id];
    if(!(file instanceof Blob)||!Number.isSafeInteger(file.size)||file.size<=0||file.size>PROJECT_SOURCE_LIMIT)
      throw Error(id+' ses dosyası boş veya proje kaydı için 40 MB sınırını aşıyor.');
    if(!Number.isFinite(duration)||duration<.15||duration>PROJECT_DURATION_LIMIT)
      throw Error(id+' ses dosyası proje geri açma sınırlarına uymuyor (0,15–420 saniye).');
    if(!range||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||
      range.end>duration||range.end-range.start<.15)
      throw Error(id+' seçili ses aralığı geçersiz.');
    if(project.clips.some(clip=>clip.id===id&&clip.end>duration+.001))
      throw Error(id+' çizelgesinde mevcut ses dosyasını aşan eski bir kesit var. Kesiti yeniden seç.');
  }
}
$('saveProject').onclick=()=>busy('saveProject',async()=>{
  if(!tracks.A||!tracks.B||!clips.length)throw Error('İki parçayı yükle ve çizelge oluştur.');
  // Capture every mutable field and source object before the first asynchronous read.
  const sourceTracks={A:tracks.A,B:tracks.B};
  const sources={A:sourceTracks.A.file,B:sourceTracks.B.file};
  const project={id:'latest',name:$('projectName').value,files:{},clips:structuredClone(clips),
    fade:Number($('fade').value),ranges:{}};
  for(const id of ['A','B'])project.ranges[id]={start:Number($('start'+id).value),end:Number($('end'+id).value)};
  MixCore.plan(project.clips,project.fade);
  validateProjectForSave(project,sources,sourceTracks);
  MixCore.suggestions(sourceTracks.A.buffer.duration,sourceTracks.B.buffer.duration,project.ranges);
  for(const id of ['A','B']){
    const file=sources[id],bytes=await file.arrayBuffer();
    if(!bytes||!Number.isSafeInteger(bytes.byteLength)||bytes.byteLength!==file.size)
      throw Error(id+' ses dosyası eksik okundu; proje kaydedilmedi.');
    project.files[id]={name:file.name,type:file.type,bytes};
  }
  await writeDB('mixora-studio','projects',project);note('✓ Kaydet düğmesine bastığın andaki proje ve kaynak sesler bu cihazda saklandı.');
});
$('restoreProject').onclick=()=>busy('restoreProject',async()=>{
  resetTempoMatch('Kaydedilmiş proje açılıyor; projede saklanan tempo ayarı korunacak.');
  // Reserve both sources now, so an older pending upload cannot overwrite a restore.
  const versions={A:++loadVersions.A,B:++loadVersions.B},before=editorState();
  const unchanged=()=>{
    if(['A','B'].some(id=>loadVersions[id]!==versions[id])||editorState()!==before)
      throw Error('Proje açılırken düzenleme veya dosya seçimi değişti. Güncel çalışman korundu; istersen yeniden aç.');
  };
  const project=await latestProject();unchanged();if(!project)throw Error('Saklanmış proje yok.');
  if(!Array.isArray(project.clips)||!project.clips.length||typeof project.name!=='string'||
    !Number.isFinite(project.fade)||project.fade<0||project.fade>5)throw Error('Saklanan proje geçersiz.');
  MixCore.plan(project.clips,project.fade);
  const files={};
  for(const id of ['A','B']){
    const saved=project.files?.[id];
    const file=saved?.bytes instanceof ArrayBuffer?new File([saved.bytes],saved.name,{type:saved.type}):saved;
    if(!(file instanceof Blob)||!file.size||file.size>PROJECT_SOURCE_LIMIT)throw Error('Saklanan ses dosyası geçersiz veya 40 MB sınırını aşıyor.');
    files[id]=file;
  }
  // Decode and validate both sources before changing any part of the working project.
  const next={},ranges={};
  for(const id of ['A','B']){
    const file=files[id],buffer=await ctx.decodeAudioData(await file.arrayBuffer());unchanged();
    if(!Number.isFinite(buffer.duration)||buffer.duration<.15||buffer.duration>PROJECT_DURATION_LIMIT)throw Error('Saklanan ses en fazla 7 dakika olmalı.');
    next[id]={file,buffer};
    ranges[id]=project.ranges?.[id]||{start:0,end:buffer.duration};
  }
  MixCore.suggestions(next.A.buffer.duration,next.B.buffer.duration,ranges);
  for(const c of project.clips)if(c.end>next[c.id].buffer.duration+.001)throw Error('Proje kesitleri ses süresini aşıyor.');
  unchanged();stop();for(const id of ['A','B']){tracks[id]=next[id];$('file'+id).value='';$('name'+id).textContent=next[id].file.name;$('start'+id).value=ranges[id].start;$('end'+id).value=ranges[id].end;draw(id);}
  clips.splice(0,clips.length,...project.clips);$('fade').value=project.fade;$('fade').dispatchEvent(new Event('input'));$('projectName').value=project.name;render();note('✓ Proje açıldı.');
});
$('saveLocalMix').onclick=()=>busy('saveLocalMix',async()=>{
  if(!clips.length)throw Error('Önce çizelge oluştur.');
  const length=plan(clips).length;if(length>300)throw Error('Cihaz kütüphanesi için en fazla 5 dakika seç.');
  const title=$('projectName').value||'Yeni remix';
  note('Ses hazırlanıyor…');const engine=new OfflineAudioContext(2,Math.ceil((length+.2)*44100),44100);const prepared=await prepareStretchedBuffers(clips,engine);schedule(clips,engine,0,undefined,prepared);
  const rendered=await engine.startRendering();
  const peak=MixCore.applyPeakCeiling(rendered,-1);
  const file=new File([wav(rendered)],'MIXORA-remix.wav',{type:'audio/wav'});
  await writeDB('mixora-community-demo','posts',{id:crypto.randomUUID(),author:'Ben',title,description:'MIXORA Studio kaydı',fileBytes:await file.arrayBuffer(),fileName:file.name,fileType:file.type,created:Date.now(),likes:0,liked:false,comments:[]});
  note('✓ Remix kaydedildi. '+(peak.gain<1?'Örnek tepe seviyesi -1 dBFS sınırına indirildi. ':'Örnek tepe seviyesi -1 dBFS sınırına göre kontrol edildi. ')+'Cihazdaki kayıtlar sayfasından dinleyip ses dosyasını paylaşabilirsin.');
});
window.addEventListener('pagehide',()=>{stop();MixoraWsola.clearCache();});
