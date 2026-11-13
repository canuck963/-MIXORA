const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyzeTempo,tempoMatch,snapRangeToBeats}=require('../assets/tempo.js');

function pulseBuffer(rate,bpm,seconds=12){
  const length=rate*seconds, left=new Float32Array(length), right=new Float32Array(length);
  for(let t=1;t<seconds-0.2;t+=60/bpm){
    const from=Math.round(t*rate),to=Math.min(length,from+Math.round(.04*rate));
    right.fill(.7,from,to);
  }
  return {sampleRate:rate,length,numberOfChannels:2,getChannelData:i=>i?right:left};
}

test('tempo analysis exposes a bounded confidence and regular beat positions',()=>{
  for(const rate of [44100,48000])for(const bpm of [72,100,128,160]){
    const analysis=analyzeTempo(pulseBuffer(rate,bpm),0,12);
    assert.ok(analysis);
    assert.equal(analysis.bpm,bpm);
    assert.ok(analysis.confidence>=.8&&analysis.confidence<=1);
    assert.ok(analysis.regularIntervals>=5);
    assert.ok(analysis.beats.length>=4);
    assert.ok(Math.abs(analysis.beats[1]-analysis.beats[0]-60/bpm)<.025);
  }
});

test('tempo match picks the closest usable half, normal or double-time grid',()=>{
  const direct=tempoMatch(120,100);
  assert.equal(direct.recommended.id,'normal');
  assert.equal(direct.recommended.rate,1.2);
  assert.equal(direct.hasInRange,true);

  const half=tempoMatch(128,90);
  assert.equal(half.recommended.id,'half');
  assert.ok(Math.abs(half.recommended.rate-128/180)<1e-12);
  assert.equal(half.recommended.targetBpm,64);

  const outside=tempoMatch(100,150);
  assert.equal(outside.hasInRange,false);
  assert.equal(outside.recommended.id,'double');
  assert.equal(outside.recommended.inRange,false);
});

test('tempo match rejects invalid BPM or rate boundaries',()=>{
  for(const [a,b,min,max] of [[0,100,.7,1.3],[181,100,.7,1.3],[100,NaN,.7,1.3],[100,Infinity,.7,1.3],[100,100,0,1],[100,100,1,.5]])
    assert.equal(tempoMatch(a,b,min,max),null);
});

test('beat snapping aligns only nearby selection edges and preserves valid duration',()=>{
  const buffer=pulseBuffer(48000,120);
  const snapped=snapRangeToBeats(buffer,5.95,9.05);
  assert.ok(snapped);
  assert.equal(snapped.bpm,120);
  assert.equal(snapped.snappedStart,true);
  assert.equal(snapped.snappedEnd,true);
  assert.ok(Math.abs(snapped.start-6.0)<.011);
  assert.ok(Math.abs(snapped.end-9.0)<.011);
  assert.ok(snapped.end-snapped.start>=.15);
  assert.equal(snapRangeToBeats(buffer,4.2,9.8),null);
  const oneEdge=snapRangeToBeats(buffer,5.95,9.8);
  assert.ok(oneEdge);
  assert.equal(oneEdge.snappedStart,true);
  assert.equal(oneEdge.snappedEnd,false);
  assert.equal(oneEdge.end,9.8);
});
test('beat snapping rejects invalid ranges, tolerance and quiet material',()=>{
  const buffer=pulseBuffer(48000,120);
  for(const args of [[buffer,-1,5],[buffer,2,1],[buffer,0,12.1],[buffer,0,0.1],[buffer,1,5,NaN],[buffer,1,5,-.1],[buffer,1,5,1.1]])
    assert.equal(snapRangeToBeats(...args),null);
  const quiet={sampleRate:48000,length:48000*8,numberOfChannels:1,getChannelData:()=>new Float32Array(48000*8)};
  assert.equal(snapRangeToBeats(quiet,1,7),null);
});
test('both studio pages expose opt-in beat snap buttons and bind their own range selector',()=>{
  const fs=require('node:fs');
  for(const [page,selector] of [['Remix.html','sel'],['remix.html','selection']]){
    const html=fs.readFileSync(page,'utf8');
    assert.match(html,/id="tempoA"/);assert.match(html,/id="tempoB"/);assert.match(html,/id="snapA"/);assert.match(html,/id="snapB"/);
    assert.ok(html.includes('bindBeatSnapControls('+selector+')'));
  }
});
test('beat snap UI updates only the chosen source and leaves it unchanged when no beat is found',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const controls={snapA:{},snapB:{},startA:{value:'5.95'},endA:{value:'9.05'},startB:{value:'4.2'},endB:{value:'9.8'}};
  let message='';
  const scope=vm.createContext({$:id=>controls[id],tracks:{A:{buffer:pulseBuffer(48000,120)},B:{buffer:pulseBuffer(48000,120)}},note:value=>message=value});
  vm.runInContext(fs.readFileSync('assets/tempo.js','utf8'),scope);
  vm.runInContext('bindBeatSnapControls(id=>({start:Number($("start"+id).value),end:Number($("end"+id).value)}))',scope);
  controls.snapA.onclick();
  assert.equal(controls.startA.value,'6.00');assert.equal(controls.endA.value,'9.00');
  controls.snapB.onclick();
  assert.equal(controls.startB.value,'4.2');assert.equal(controls.endB.value,'9.8');
  assert.match(message,/kesit değişmedi/);
});
