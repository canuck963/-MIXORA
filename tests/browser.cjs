const {chromium,webkit}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const fs=require('fs'),assert=require('node:assert/strict');
function wav(hz){const n=44100*2,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(88200,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*hz/44100)*8000),44+i*2);return b;}
(async()=>{for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
 let browser;try{browser=await type.launch({headless:true,args:name==='chromium'?['--no-sandbox']:[]});}catch(e){throw Error(name+' browser unavailable: '+e.message.split('\n')[0]);}
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8000/Remix.html');
 for(const id of ['A','B']){await page.locator('#file'+id).setInputFiles({name:id+'.wav',mimeType:'audio/wav',buffer:wav(id==='A'?220:440)});await page.waitForFunction(id=>document.getElementById('name'+id).textContent.includes('.wav'),id);}
 for(let i=0;i<3;i++){await page.locator('#threeSuggestions button').nth(i).click();await page.locator('#play').click();await page.waitForTimeout(150);await page.locator('#stop').click();assert.equal(await page.locator('#clips .clip').count(),2);}
 await page.locator('#saveProject').click();await page.waitForFunction(()=>!document.getElementById('saveProject').disabled);assert.match(await page.locator('#status').textContent(),/saklandı/);
 await page.locator('#clear').click();await page.locator('#restoreProject').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Proje açıldı'));
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;const path=await download.path();const out=fs.readFileSync(path);assert.equal(out.toString('ascii',0,4),'RIFF');assert.ok(out.length>10000);
 let energy=0;for(let i=44;i<out.length;i+=2)energy+=Math.abs(out.readInt16LE(i));assert.ok(energy>100000,'rendered audio is not silent');
 await page.locator('#saveLocalMix').click();await page.waitForFunction(()=>!document.getElementById('saveLocalMix').disabled);assert.match(await page.locator('#status').textContent(),/Remix kaydedildi/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/tmp/mixora-studio-'+name+'.png',fullPage:true});
 await page.goto('http://localhost:8000/local-community.html');await page.waitForSelector('#feed audio');
 await page.goto('http://localhost:8000/community.html');await page.locator('#email').fill('browser-'+name+'-'+Date.now()+'@example.com');await page.locator('#password').fill('browser-safe-password');await page.locator('#name').fill('DJ Browser');await page.locator('#register').click();await page.waitForSelector('#profile:not(.hidden)');
 await page.locator('#title').fill('Tarayıcı remix testi');await page.locator('#audioFile').setInputFiles({name:'mix.wav',mimeType:'audio/wav',buffer:out});await page.locator('#rights').check();await page.locator('#publishBtn').click();await page.waitForSelector('.post audio');
 await page.locator('.post button').filter({hasText:'♡'}).click();await page.waitForFunction(()=>document.querySelector('.post').textContent.includes('♥ 1'));
 await page.locator('summary').click();await page.locator('.post input').fill('Harika');await page.locator('.post button').filter({hasText:'Yorum ekle'}).click();await page.waitForSelector('.comment');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/mixora-community-'+name+'.png',fullPage:true});
 await page.goto('http://localhost:8000/index.html');await page.locator('#goStudio').click();await page.locator('#fileA').setInputFiles({name:'a.wav',mimeType:'audio/wav',buffer:wav(220)});await page.locator('#playBoth').click();await page.waitForTimeout(100);await page.locator('#pauseBoth').click();
 assert.deepEqual(errors,[]);console.log(name+': mobile studio, three previews, WAV export, project restore, local save, account, publish, like, comment, legacy live deck PASS');await browser.close();
}})().catch(e=>{console.error(e);process.exit(1);});
