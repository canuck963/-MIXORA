const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {File,Blob}=require('node:buffer');
const MixCore=require('../assets/mix-core.js');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(){
 const elements=new Map();
 function el(id){if(!elements.has(id))elements.set(id,{value:'',disabled:false,textContent:'',dataset:{},append(){},after(){},setAttribute(){},dispatchEvent(){}});return elements.get(id);}
 const track=name=>({file:new File(['audio'],name,{type:'audio/wav'}),buffer:{duration:10}});
 const context=vm.createContext({document:{createElement:()=>el(Symbol()),getElementById:el,querySelector:()=>el('main')},window:{addEventListener(){}},$:el,
  tracks:{A:track('A.wav'),B:track('B.wav')},clips:[{id:'A',start:1,end:5},{id:'B',start:2,end:6}],loadVersions:{A:0,B:0},
  ctx:{decodeAudioData:async()=>({duration:10})},MixCore,File,Blob,ArrayBuffer,structuredClone,Event:class{},stop(){},draw(){},render(){},note:message=>el('status').textContent=message});
 vm.runInContext(fs.readFileSync('assets/studio.js','utf8'),context);
 el('fade').value='1';el('projectName').value='Original';
 for(const id of ['A','B']){el('start'+id).value='1';el('end'+id).value='8';}
 vm.runInContext('writeDB=async (...args)=>{globalThis.written=args[2]}; latestProject=async()=>globalThis.saved;',context);
 const project=()=>({id:'latest',name:'Saved',files:{A:new File(['A'],'saved-A.wav'),B:new File(['B'],'saved-B.wav')},clips:[{id:'A',start:0,end:4},{id:'B',start:0,end:3}],fade:2});
 context.saved=project();return {context,el,track};
}
test('save snapshots both source files, title, selections and timeline before awaiting',async()=>{
 const {context:c,el,track}=setup(),gate=deferred();c.tracks.A.file.arrayBuffer=()=>gate.promise;
 const saving=el('saveProject').onclick();c.tracks.B=track('replacement.wav');c.clips[0].end=9;el('fade').value='5';el('projectName').value='Changed';el('startA').value='3';
 gate.resolve(new ArrayBuffer(4));await saving;
 assert.equal(c.written.files.B.name,'B.wav');assert.equal(c.written.clips[0].end,5);assert.equal(c.written.name,'Original');assert.equal(c.written.fade,1);assert.equal(c.written.ranges.A.start,1);
});
test('restore preserves edits made while reading storage and releases button',async()=>{
 const {context:c,el}=setup(),gate=deferred();c.gate=gate.promise;vm.runInContext('latestProject=()=>gate',c);
 const restoring=el('restoreProject').onclick();c.clips[0].end=7;gate.resolve(c.saved);await restoring;
 assert.equal(c.clips[0].end,7);assert.equal(c.tracks.A.file.name,'A.wav');assert.match(el('status').textContent,/korundu/);assert.equal(el('restoreProject').disabled,false);
});
test('new file selection during decoding cancels restore without overwriting sources',async()=>{
 const {context:c,el,track}=setup(),gate=deferred();c.ctx.decodeAudioData=()=>gate.promise;
 const restoring=el('restoreProject').onclick();await new Promise(setImmediate);
 c.loadVersions.B++;c.tracks.B=track('new.wav');gate.resolve({duration:10});await restoring;
 assert.equal(c.tracks.B.file.name,'new.wav');assert.equal(c.tracks.A.file.name,'A.wav');assert.match(el('status').textContent,/korundu/);
});
test('restore reserves upload generations immediately and restores legacy projects',async()=>{
 const {context:c,el}=setup();c.loadVersions.A=4;const restoring=el('restoreProject').onclick();assert.equal(c.loadVersions.A,5);await restoring;
 assert.equal(c.tracks.A.file.name,'saved-A.wav');assert.equal(el('endB').value,10);assert.equal(el('fade').value,2);assert.equal(el('projectName').value,'Saved');
});
test('new project source bytes and selected ranges survive restore',async()=>{
 const {context:c,el}=setup();await el('saveProject').onclick();c.saved=c.written;el('startA').value='0';el('endA').value='10';await el('restoreProject').onclick();
 assert.equal(el('startA').value,1);assert.equal(el('endA').value,8);assert.equal(c.tracks.A.file.name,'A.wav');
});
test('invalid or oversized source and overlong decoded audio leave project intact',async()=>{
 for(const kind of ['missing','oversize','duration','clips','fade']){
  const {context:c,el}=setup();if(kind==='missing')delete c.saved.files.B;
  if(kind==='oversize')Object.defineProperty(c.saved.files.B,'size',{value:41*1024*1024});
  if(kind==='duration')c.ctx.decodeAudioData=async()=>({duration:421});
  if(kind==='clips')c.saved.clips[1].end=12;
  if(kind==='fade')c.saved.fade=6;
  await el('restoreProject').onclick();assert.equal(c.tracks.A.file.name,'A.wav',kind);assert.equal(c.clips[0].start,1,kind);assert.match(el('status').textContent,/tamamlanamadı/,kind);
 }
});
test('failure decoding second file never partially replaces first track',async()=>{
 const {context:c,el}=setup();let count=0;c.ctx.decodeAudioData=async()=>{if(++count===2)throw Error('decode failed');return {duration:10};};
 await el('restoreProject').onclick();assert.equal(c.tracks.A.file.name,'A.wav');assert.equal(c.tracks.B.file.name,'B.wav');assert.match(el('status').textContent,/decode failed/);
});
test('duplicate save calls do not race storage writes',async()=>{
 const {context:c,el}=setup(),gate=deferred();let count=0;c.tracks.A.file.arrayBuffer=()=>{count++;return gate.promise;};
 const first=el('saveProject').onclick();await el('saveProject').onclick();assert.equal(count,1);gate.resolve(new ArrayBuffer(4));await first;assert.equal(el('saveProject').disabled,false);
});
test('local rendered remix keeps the title captured when recording started',async()=>{
 const {context:c,el}=setup(),gate=deferred();c.plan=list=>MixCore.plan(list,1);c.schedule=()=>{};
 c.OfflineAudioContext=class{startRendering(){return gate.promise;}};c.wav=()=>new Blob(['wave']);c.crypto={randomUUID:()=> 'test-mix'};
 const saving=el('saveLocalMix').onclick();el('projectName').value='Different remix';gate.resolve({});await saving;
 assert.equal(c.written.title,'Original');assert.equal(c.written.fileName,'MIXORA-remix.wav');
});
