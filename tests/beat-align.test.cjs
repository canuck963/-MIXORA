const {test}=require('node:test');
const assert=require('node:assert/strict');
const {nextBeatDelaySeconds,createBeatScheduler}=require('../assets/beat-align.js');

class FakeAudio extends EventTarget {
  constructor(src,currentTime=0,playbackRate=1,paused=false){
    super();this.src=src;this.currentTime=currentTime;this.playbackRate=playbackRate;this.paused=paused;this.plays=0;this.pauseCalls=0;this.rejectPlay=false;
  }
  async play(){this.plays++;if(this.rejectPlay)throw new Error('NotAllowedError');if(this.playDeferred)await this.playDeferred;this.paused=false;}
  pause(){this.pauseCalls++;this.paused=true;this.dispatchEvent(new Event('pause'));}
}
function fakeClock(){
  let next=1;const jobs=new Map();
  return {jobs,setTimeoutFn(fn,ms){const id=next++;jobs.set(id,{fn,ms});return id;},
    clearTimeoutFn(id){jobs.delete(id);},
    async run(){const first=jobs.entries().next();assert.equal(first.done,false,'timer should be queued');const [id,job]=first.value;jobs.delete(id);await job.fn();return job;}};
}

test('next beat delay follows A playback rate and track-zero phase',()=>{
  assert.ok(Math.abs(nextBeatDelaySeconds(1.25,120,1.25)-.2)<1e-12);
  assert.equal(nextBeatDelaySeconds(1,120,1),.5,'an exact grid point schedules the next full beat');
  assert.ok(Math.abs(nextBeatDelaySeconds(1.25,120,1)-.25)<1e-12);
});

test('beat delay rejects invalid time, BPM and playback rate',()=>{
  for(const args of [[-1,120,1],[1,39,1],[1,241,1],[1,120,0],[1,120,Infinity],[NaN,120,1]])
    assert.equal(nextBeatDelaySeconds(...args),null);
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
  await clock.run();
  assert.match(messages.at(-1),/Safari/);
});

test('cancel during a pending iOS play permission promise pauses stale B again on resolution',async()=>{
  const clock=fakeClock(),scheduler=createBeatScheduler(clock);
  let resolvePlay;
  const a=new FakeAudio('blob:a',1.25,1,false),b=new FakeAudio('blob:b');
  b.playDeferred=new Promise(resolve=>{resolvePlay=resolve});
  scheduler.schedule(a,b,120,()=>{});
  const job=[...clock.jobs.values()][0];clock.jobs.clear();
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
