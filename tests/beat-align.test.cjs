const {test}=require('node:test');
const assert=require('node:assert/strict');
const {nextBeatDelaySeconds,nextBeatTargetTimeSeconds,estimateBeatPhase,createBeatScheduler}=require('../assets/beat-align.js');

class FakeAudio extends EventTarget {
  constructor(src,currentTime=0,playbackRate=1,paused=true){
    super();this.src=src;this.currentTime=currentTime;this.playbackRate=playbackRate;this.paused=paused;this.plays=0;this.pauseCalls=0;this.rejectPlay=false;
  }
  async play(){this.plays++;if(this.rejectPlay)throw new Error('NotAllowedError');if(this.playDeferred)await this.playDeferred;this.paused=false;this.dispatchEvent(new Event('play'));}
  pause(){this.pauseCalls++;this.paused=true;this.dispatchEvent(new Event('pause'));}
}
function phaseBuffer(rate,bpm,offset=0.73,seconds=12,offbeatStrength=0){
  const length=rate*seconds,data=new Float32Array(length);
  const fillPulse=t=>{const from=Math.round(t*rate);data.fill(.7,from,Math.min(length,from+Math.round(.04*rate)));};
  for(let t=offset;t<seconds-0.1;t+=60/bpm){
    fillPulse(t);
    if(offbeatStrength>0){const from=Math.round((t+30/bpm)*rate);data.fill(offbeatStrength,from,Math.min(length,from+Math.round(.04*rate)));}
  }
  return {sampleRate:rate,length,numberOfChannels:1,getChannelData:()=>data};
}
function fakeClock(){
  let next=1;const jobs=new Map();
  return {jobs,setTimeoutFn(fn,ms){const id=next++;jobs.set(id,{fn,ms});return id;},
    clearTimeoutFn(id){jobs.delete(id);},
    async run(before){const first=jobs.entries().next();assert.equal(first.done,false,'timer should be queued');const [id,job]=first.value;jobs.delete(id);if(before)before(job);await job.fn();return job;}};
}

test('next beat delay follows A playback rate and track-zero phase',()=>{
  assert.ok(Math.abs(nextBeatDelaySeconds(1.25,120,1.25)-.2)<1e-12);
  assert.equal(nextBeatDelaySeconds(1,120,1),.5,'an exact grid point schedules the next full beat');
  assert.ok(Math.abs(nextBeatDelaySeconds(1.25,120,1)-.25)<1e-12);
  assert.ok(Math.abs(nextBeatDelaySeconds(1.25,120,1,.1)-.35)<1e-12,'phase offset shifts the next grid point');
});

test('next beat target exposes the exact media-time grid point',()=>{
  assert.equal(nextBeatTargetTimeSeconds(1.25,120),1.5);
  assert.ok(Math.abs(nextBeatTargetTimeSeconds(1.25,120,.1)-1.6)<1e-12);
  assert.equal(nextBeatTargetTimeSeconds(-1,120),null);
  assert.equal(nextBeatTargetTimeSeconds(1,241),null);
});

test('beat delay rejects invalid time, BPM and playback rate',()=>{
  for(const args of [[-1,120,1],[1,39,1],[1,241,1],[1,120,0],[1,120,Infinity],[NaN,120,1]])
    assert.equal(nextBeatDelaySeconds(...args),null);
});



test('DJ start estimates phase from the selected local A file and guards stale decode',()=>{
  const html=require('node:fs').readFileSync('index.html','utf8');
  assert.match(html,/window\.mixoraFiles\?\.A/);
  assert.match(html,/decodeAudioData\(await file\.arrayBuffer\(\)\)/);
  assert.match(html,/estimateBeatPhase\(decoded,bpm\)/);
  assert.match(html,/phase\.phaseMargin>=\.12/);
  assert.match(html,/alternatif faz ayrımı/);
  assert.match(html,/window\.mixoraFiles\?\.A!==file/);
  assert.match(html,/schedule\(audioA,audioB,bpm,message=>\{\$\('tempoAdvice'\)\.textContent=phaseNote\+message\},origin\)/);
});

test('phase estimator finds a non-zero local beat grid without uploading audio',()=>{
  const phase=estimateBeatPhase(phaseBuffer(48000,120,.73),120);
  assert.ok(phase);
  assert.ok(Math.abs(phase.beatOrigin-.23)<.025);
  assert.ok(phase.confidence>=.9);
  assert.ok(phase.phaseMargin>=.12);
  assert.ok(phase.detectedAttacks>=10);
  assert.equal(estimateBeatPhase(phaseBuffer(48000,120),90),null,'a mismatched tempo must not be presented as a reliable phase');
});

test('phase estimator rejects equally strong beat and offbeat grids as ambiguous',()=>{
  const phase=estimateBeatPhase(phaseBuffer(48000,120,.73,12,.7),120);
  assert.equal(phase,null,'two equally strong half-beat grids must fall back instead of choosing arbitrarily');
});

test('phase estimator keeps a dominant beat grid when quieter syncopated attacks are present',()=>{
  const phase=estimateBeatPhase(phaseBuffer(48000,120,.73,12,.15),120);
  assert.ok(phase);
  assert.ok(Math.abs(phase.beatOrigin-.23)<.025);
  assert.ok(phase.phaseMargin>=.12);
});

test('scheduler uses the supplied beat phase when calculating its delay',()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock);
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  assert.equal(scheduler.schedule(a,b,120,()=>{},.1),true);
  assert.equal([...clock.jobs.values()][0].ms,350);
  scheduler.cancel();
});

test('scheduler rechecks an early timer and waits until the media clock reaches its target',async()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock);
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  scheduler.schedule(a,b,120,()=>{});
  assert.equal([...clock.jobs.values()][0].ms,250);
  await clock.run(()=>{a.currentTime=1.4;});
  assert.equal(b.plays,0,'an early callback must not start B before the target');
  assert.equal([...clock.jobs.values()][0].ms,100);
  await clock.run(()=>{a.currentTime=1.5;});
  assert.equal(b.plays,1);
});

test('scheduler skips a missed beat after a delayed callback instead of starting off-grid',async()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock),messages=[];
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  scheduler.schedule(a,b,120,message=>messages.push(message));
  await clock.run(()=>{a.currentTime=1.62;});
  assert.equal(b.plays,0,'a late callback must skip the stale beat');
  assert.equal([...clock.jobs.values()][0].ms,380,'the next grid point is 2.0 seconds');
  assert.match(messages.at(-1),/hedef vuruşu kaçırdı/);
  await clock.run(()=>{a.currentTime=2;});
  assert.equal(b.plays,1);
});

test('seeking A cancels a pending aligned B start',()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock);
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  scheduler.schedule(a,b,120,()=>{});
  a.dispatchEvent(new Event('seeking'));
  assert.equal(clock.jobs.size,0);
  assert.equal(b.plays,0);
});

test('pending B start is removed when the user cancels',async()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock);
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  assert.equal(scheduler.schedule(a,b,120,()=>{}),true);
  assert.equal(clock.jobs.size,1);
  scheduler.cancel();
  assert.equal(clock.jobs.size,0);
  assert.equal(b.plays,0);
});

test('pausing A cancels the scheduled B start',()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock);
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  scheduler.schedule(a,b,120,()=>{});
  a.pause();
  assert.equal(clock.jobs.size,0);
  assert.equal(b.plays,0);
});

test('changing A playback rate recalculates the pending delay',()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock);
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  scheduler.schedule(a,b,120,()=>{});
  assert.equal([...clock.jobs.values()][0].ms,250);
  a.playbackRate=2;a.dispatchEvent(new Event('ratechange'));
  assert.equal(clock.jobs.size,1);
  assert.equal([...clock.jobs.values()][0].ms,125);
});

test('a changed source cannot trigger stale B playback',async()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock);
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  scheduler.schedule(a,b,120,()=>{});
  b.src='blob:new';
  await clock.run();
  assert.equal(b.plays,0);
});

test('Safari play rejection is reported without an unhandled promise',async()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock),messages=[];
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');b.rejectPlay=true;
  scheduler.schedule(a,b,120,message=>messages.push(message));
  await clock.run(()=>{a.currentTime=1.5;});
  assert.match(messages.at(-1),/Safari/);
});

test('cancel during a pending iOS play permission promise pauses stale B again on resolution',async()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock);
  let resolvePlay;
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  b.playDeferred=new Promise(resolve=>{resolvePlay=resolve});
  scheduler.schedule(a,b,120,()=>{});
  const job=[...clock.jobs.values()][0];clock.jobs.clear();
  a.currentTime=1.5;
  const pending=job.fn();
  await Promise.resolve();
  assert.equal(b.plays,1);
  scheduler.cancel();
  assert.equal(b.pauseCalls,1);
  resolvePlay();
  await pending;
  assert.equal(b.pauseCalls,2,'late play resolution must not leave B audible');
  assert.equal(b.paused,true);
});


test('an already-playing B deck is not reported as a beat-aligned start',()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock),messages=[];
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  b.paused=false;
  assert.equal(scheduler.schedule(a,b,120,message=>messages.push(message)),false);
  assert.equal(clock.jobs.size,0);
  assert.equal(b.plays,0);
  assert.match(messages.at(-1),/B zaten çalıyor/);
});

test('manual B playback during the countdown cancels the pending aligned start',()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock),messages=[];
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  assert.equal(scheduler.schedule(a,b,120,message=>messages.push(message)),true);
  assert.equal(clock.jobs.size,1);
  b.paused=false;
  b.dispatchEvent(new Event('play'));
  assert.equal(clock.jobs.size,0);
  assert.equal(b.plays,0);
  assert.match(messages.at(-1),/B elle başlatıldı/);
});

test('scheduler-owned B play event does not cancel its own aligned start',async()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock),messages=[];
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  assert.equal(scheduler.schedule(a,b,120,message=>messages.push(message)),true);
  await clock.run(()=>{a.currentTime=1.5;});
  assert.equal(b.plays,1);
  assert.match(messages.at(-1),/B tahmini vuruşta başlatıldı/);
});

test('a stale iOS play resolution cannot pause a newer scheduler-owned B attempt',async()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock);
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  const resolvePlays=[];
  b.play=()=>{b.plays++;return new Promise(resolve=>resolvePlays.push(()=>{
    b.paused=false;b.dispatchEvent(new Event('play'));resolve();
  }));};

  scheduler.schedule(a,b,120,()=>{});
  const firstJob=[...clock.jobs.values()][0];clock.jobs.clear();
  a.currentTime=1.5;
  const firstRun=firstJob.fn();
  await Promise.resolve();
  assert.equal(b.plays,1,'the first beat attempt should be waiting on the iOS play promise');

  // A rate change cancels that attempt and queues the next beat.
  a.playbackRate=2;a.dispatchEvent(new Event('ratechange'));
  assert.equal(b.pauseCalls,1,'cancelling the first attempt pauses B once');
  assert.equal(clock.jobs.size,1);

  // The new attempt reaches its own target and now owns the same B element.
  const secondJob=[...clock.jobs.values()][0];clock.jobs.clear();
  a.currentTime=2;
  const secondRun=secondJob.fn();
  await Promise.resolve();
  assert.equal(b.plays,2);

  // The newer scheduler attempt completes first. The old permission prompt
  // then resolves after the new playback has already taken ownership.
  resolvePlays[1]();
  await secondRun;
  assert.equal(b.paused,false);

  resolvePlays[0]();
  await firstRun;
  assert.equal(b.pauseCalls,1,'the stale promise must not pause completed newer playback');
  assert.equal(b.paused,false);
});

test('a cancelled play event does not look like manual B playback while the next beat is queued',async()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock),resolvePlays=[];
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  b.play=()=>{b.plays++;return new Promise(resolve=>resolvePlays.push(()=>{
    b.paused=false;b.dispatchEvent(new Event('play'));resolve();
  }));};

  scheduler.schedule(a,b,120,()=>{});
  const firstJob=[...clock.jobs.values()][0];clock.jobs.clear();
  a.currentTime=1.5;
  const firstRun=firstJob.fn();
  await Promise.resolve();
  assert.equal(b.plays,1);

  // A rate change cancels the pending permission-gated play and queues a
  // fresh target. The old promise can still dispatch a play event on B.
  a.playbackRate=2;a.dispatchEvent(new Event('ratechange'));
  assert.equal(clock.jobs.size,1);
  assert.equal(b.pauseCalls,1);

  resolvePlays[0]();
  await firstRun;
  assert.equal(clock.jobs.size,1,'the stale play event must not cancel the new beat timer');
  assert.equal(b.pauseCalls,2,'the stale start is paused after its promise resolves');
  assert.equal(b.paused,true);

  const secondJob=[...clock.jobs.values()][0];clock.jobs.clear();
  a.currentTime=2;
  const secondRun=secondJob.fn();
  await Promise.resolve();
  assert.equal(b.plays,2);
  resolvePlays[1]();
  await secondRun;
  assert.equal(b.paused,false);
  assert.equal(b.pauseCalls,2);
});
