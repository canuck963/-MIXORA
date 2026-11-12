const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyzeTempo,tempoMatch}=require('../assets/tempo.js');

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
