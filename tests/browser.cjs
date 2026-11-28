const {chromium,webkit}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const fs=require('fs'),assert=require('node:assert/strict');
function wav(hz,amplitude=8000){const n=44100*2,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(88200,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*hz/44100)*amplitude),44+i*2);return b;}
function pulseWav(bpm,seconds=10){const sr=44100,n=sr*seconds,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let beat=1;beat<seconds-.1;beat+=60/bpm){const start=Math.round(beat*sr),length=Math.round(.04*sr);for(let i=0;i<length&&start+i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/sr)*24000),44+(start+i)*2);}return b;}
function wavPeak(bytes){assert.equal(bytes.toString('ascii',0,4),'RIFF');let peak=0;for(let i=44;i+1<bytes.length;i+=2)peak=Math.max(peak,Math.abs(bytes.readInt16LE(i)/32768));return peak;}
(async()=>{for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
 let browser;try{browser=await type.launch({headless:true,args:name==='chromium'?['--no-sandbox']:[]});}catch(e){throw Error(name+' browser unavailable: '+e.message.split('\n')[0]);}
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));

 let confirmations=0;
 await page.route('**/api/verify-email',route=>{
  if(route.request().method()!=='POST')return route.continue();
  confirmations++;assert.equal(route.request().postDataJSON().token,'browser-token');
  if(confirmations===1)return route.abort();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
 });
 await page.goto('http://localhost:8000/api/verify-email?token=browser-token');
 assert.equal(confirmations,0);assert.equal(new URL(page.url()).search,'');
 await page.locator('#confirm').click();await page.waitForFunction(()=>document.getElementById('result').textContent.includes('Sunucuya ulaşılamadı'));
 assert.equal(await page.locator('#confirm').isEnabled(),true);
 await page.locator('#confirm').click();await page.waitForFunction(()=>document.getElementById('result').textContent.includes('E-posta doğrulandı'));
 assert.equal(confirmations,2);assert.equal(await page.locator('#confirm').isDisabled(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.goto('http://localhost:8000/api/verify-email');assert.equal(await page.locator('#confirm').isDisabled(),true);
 await page.unroute('**/api/verify-email');
 let resetRequests=0;
 await page.route('**/api/reset-password',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  resetRequests++;assert.equal(route.request().postDataJSON().token,'reset-browser-token');
  if(resetRequests===1)return route.abort();
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
 });
 await page.goto('http://localhost:8000/api/reset-password?token=reset-browser-token');
 assert.equal(resetRequests,0);assert.equal(new URL(page.url()).search,'');
 await page.getByLabel('Yeni şifre',{exact:true}).fill('new-browser-password');
 await page.locator('#confirm').click();await page.waitForFunction(()=>document.getElementById('result').textContent.includes('Yanıt alınamadı'));
 assert.equal(await page.locator('#confirm').isEnabled(),true);
 await page.locator('#confirm').click();await page.waitForFunction(()=>document.getElementById('result').textContent.includes('Şifren değiştirildi'));
 assert.equal(resetRequests,2);assert.equal(await page.locator('#confirm').isDisabled(),true);assert.equal(await page.locator('#password').inputValue(),'');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.goto('http://localhost:8000/api/reset-password');assert.equal(await page.locator('#confirm').isDisabled(),true);
 await page.unroute('**/api/reset-password');
 await page.goto('http://localhost:8000/Remix.html');
 for(const id of ['A','B']){await page.locator('#file'+id).setInputFiles({name:id+'.wav',mimeType:'audio/wav',buffer:pulseWav(id==='A'?120:100)});await page.waitForFunction(id=>document.getElementById('name'+id).textContent.includes('.wav'),id);}
 await page.locator('#startA').fill('0.25');await page.locator('#endA').fill('9.75');await page.locator('#startB').fill('0.5');await page.locator('#endB').fill('9.75');
 await page.locator('#analyzeTempoMatch').click();await page.waitForFunction(()=>document.getElementById('tempoMatchStatus').textContent.includes('A 120 BPM')&&document.getElementById('tempoMatchStatus').textContent.includes('B 100 BPM'));
 await page.locator('#applyTempoMatch').click();assert.ok(Math.abs(await page.evaluate(()=>window.MixoraTempoStretchRate)-1.2)<.01);
 for(let i=0;i<3;i++){
  const before=await page.evaluate(()=>JSON.stringify({clips,fade:document.getElementById('fade').value}));
  await page.locator('[data-preview="'+i+'"]').click();
  await page.waitForFunction(()=>/önizlemesi|Ses başlatılamadı/.test(document.getElementById('status').textContent),null,{timeout:20000});
  const previewStatus=await page.locator('#status').textContent();assert.match(previewStatus,/önizlemesi/,'suggestion '+i+' preview must finish before apply');
  assert.equal(await page.evaluate(()=>JSON.stringify({clips,fade:document.getElementById('fade').value})),before);
  await page.locator('[data-apply="'+i+'"]').click();
  const applied=await page.evaluate(()=>({clips:clips.map(c=>({id:c.id,start:c.start,end:c.end,stretchRate:c.stretchRate})),status:document.getElementById('status').textContent}));
  assert.equal(applied.clips.length,2,'suggestion '+i+' did not apply two clips: '+JSON.stringify(applied));
  assert.equal(applied.clips[0].start,.25,'suggestion '+i+' changed A range');
  assert.equal(applied.clips[1].start,.5,'suggestion '+i+' changed B range');
  assert.ok(Math.abs(applied.clips[1].stretchRate-1.2)<.01,'suggestion '+i+' lost WSOLA rate');
  await page.locator('#play').click();
  await page.waitForFunction(()=>/Remix oynatılıyor|Ses başlatılamadı/.test(document.getElementById('status').textContent),null,{timeout:20000});
  assert.match(await page.locator('#status').textContent(),/Remix oynatılıyor/,'suggestion '+i+' applied preview failed');
  await page.locator('#stop').click();assert.equal(await page.locator('#clips .clip').count(),2);
 }
 await page.locator('#saveProject').click();await page.waitForFunction(()=>/saklandı|İşlem tamamlanamadı/.test(document.getElementById('status').textContent));assert.match(await page.locator('#status').textContent(),/saklandı/);
 await page.locator('#clear').click();await page.locator('#restoreProject').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Proje açıldı'));
 assert.equal(await page.locator('#startA').inputValue(),'0.25');assert.equal(await page.locator('#startB').inputValue(),'0.5');assert.ok(Math.abs(await page.evaluate(()=>clips[1].stretchRate)-1.2)<.01,'saved project must retain WSOLA rate');
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;const path=await download.path();const out=fs.readFileSync(path);assert.equal(out.toString('ascii',0,4),'RIFF');assert.ok(out.length>10000);
 let energy=0,peak=0;for(let i=44;i<out.length;i+=2){const sample=out.readInt16LE(i)/32768;energy+=Math.abs(out.readInt16LE(i));peak=Math.max(peak,Math.abs(sample));}assert.ok(energy>100000,'rendered audio is not silent');assert.ok(peak<=Math.pow(10,-1/20)+1/32768,'WAV sample peak exceeds the -1 dBFS ceiling');
 await page.evaluate(()=>{window.__peakCalls=0;const apply=MixCore.applyPeakCeiling;MixCore.applyPeakCeiling=(buffer,ceiling)=>{window.__peakCalls++;return apply(buffer,ceiling);};});
 await page.locator('#saveLocalMix').click();await page.waitForFunction(()=>/Remix kaydedildi|İşlem tamamlanamadı/.test(document.getElementById('status').textContent));assert.match(await page.locator('#status').textContent(),/Remix kaydedildi/);
 assert.equal(await page.evaluate(()=>window.__peakCalls),1,'local library WAV must use the shared peak ceiling');
 const localWav=await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('mixora-community-demo',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const rows=await new Promise((resolve,reject)=>{const request=db.transaction('posts','readonly').objectStore('posts').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();const record=rows.sort((a,b)=>b.created-a.created)[0];if(!record||!(record.fileBytes instanceof ArrayBuffer))throw Error('saved local WAV was not found');const view=new DataView(record.fileBytes);let peak=0;for(let i=44;i+1<view.byteLength;i+=2)peak=Math.max(peak,Math.abs(view.getInt16(i,true)/32768));return {peak,fileName:record.fileName};});
 assert.ok(localWav.peak<=Math.pow(10,-1/20)+1/32768,'saved local WAV sample peak exceeds -1 dBFS');assert.ok(localWav.fileName.toLowerCase().endsWith('.wav'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/mixora-studio-'+name+'.png',fullPage:true});
 await page.goto('http://localhost:8000/remix.html');assert.equal(await page.evaluate(()=>typeof window.MixCore?.applyPeakCeiling),'function');
 await page.evaluate(()=>{window.__peakCalls=0;const apply=MixCore.applyPeakCeiling;MixCore.applyPeakCeiling=(buffer,ceiling)=>{window.__peakCalls++;return apply(buffer,ceiling);};});
 for(const id of ['A','B']){await page.locator('#file'+id).setInputFiles({name:id+'.wav',mimeType:'audio/wav',buffer:wav(id==='A'?220:440,30000)});await page.waitForFunction(id=>document.getElementById('name'+id).textContent.includes('.wav'),id);}
 await page.locator('#addA').click();await page.locator('#addB').click();const legacyDownloadPromise=page.waitForEvent('download');await page.locator('#export').click();const legacyDownload=await legacyDownloadPromise;const legacyBytes=fs.readFileSync(await legacyDownload.path());assert.equal(await page.evaluate(()=>window.__peakCalls),1,'legacy WAV export must use the shared peak ceiling');assert.ok(wavPeak(legacyBytes)<=Math.pow(10,-1/20)+1/32768,'legacy WAV sample peak exceeds -1 dBFS');
 await page.goto('http://localhost:8000/local-community.html');await page.waitForSelector('#feed audio');
 await page.goto('http://localhost:8000/community.html');await page.locator('#email').fill('browser-'+name+'-'+Date.now()+'@example.com');await page.locator('#password').fill('browser-safe-password');await page.locator('#name').fill('DJ Browser');await page.route('**/api/register',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:null,verification_required:true,message:'E-postanı doğrula.'})}));
 await page.locator('#register').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='E-postanı doğrula.');assert.equal(await page.locator('#profile').isVisible(),false);
 await page.unroute('**/api/register');
 for(const [id,path] of [['forgotPassword','forgot-password'],['resendVerification','request-verification']]){
  await page.route('**/api/'+path,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,message:path+' gönderildi'})}));
  await page.locator('#'+id).click();await page.waitForFunction(text=>document.getElementById('status').textContent===text,path+' gönderildi');await page.unroute('**/api/'+path);
 }
 await page.locator('#password').fill('browser-safe-password');await page.locator('#register').click();await page.waitForSelector('#profile:not(.hidden)');
  await page.locator('#title').fill('Tarayıcı remix testi');await page.locator('#audioFile').setInputFiles({name:'mix.wav',mimeType:'audio/wav',buffer:out});await page.locator('#rights').check();await page.locator('#publishBtn').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Remixin yayımlandı'));await page.waitForSelector('.post audio');
  const postId=new URL(page.url()).searchParams.get('post');assert.ok(postId,name+' published post URL is missing its id');
  const postCard=page.locator('#post-'+postId);await postCard.waitFor();
  const likeButton=postCard.locator('.actions button').first();
  assert.ok((await likeButton.textContent()).trim().startsWith('♡'),name+' new post should start unliked');
  const likeResponse=page.waitForResponse(r=>r.url().includes('/likes')&&['POST','DELETE'].includes(r.request().method()));
  await likeButton.click();const likeResult=await likeResponse;
  assert.equal(likeResult.status(),200,name+' like request failed: '+await likeResult.text());
  await page.waitForFunction(button=>button.textContent.trim().startsWith('♥'),await likeButton.elementHandle(),{timeout:10000});
 await page.locator('summary').click();await page.locator('.post input').fill('Harika');await page.locator('.post button').filter({hasText:'Yorum ekle'}).click();await page.waitForSelector('.comment');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/mixora-community-'+name+'.png',fullPage:true});
 await page.goto('http://localhost:8000/index.html');await page.locator('#goStudio').click();await page.locator('#fileA').setInputFiles({name:'a.wav',mimeType:'audio/wav',buffer:wav(220)});await page.locator('#playBoth').click();await page.waitForTimeout(100);await page.locator('#pauseBoth').click();
 assert.deepEqual(errors,[]);console.log(name+': mobile studio, three previews, WAV export, project restore, local save, account, publish, like, comment, legacy live deck PASS');await browser.close();
}})().catch(e=>{console.error(e);process.exit(1);});
