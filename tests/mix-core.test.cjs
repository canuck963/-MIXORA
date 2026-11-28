const {test}=require('node:test');const assert=require('node:assert/strict');const {plan,suggestions}=require('../assets/mix-core.js');
test('three distinct suggestions use both sources and fit their duration',()=>{
 for(const [a,b] of [[120,90],[.3,.4],[17,420]]){
  const variants=suggestions(a,b);assert.equal(variants.length,3);assert.equal(new Set(variants.map(x=>JSON.stringify(x.clips))).size,3);
  for(const variant of variants){for(const c of variant.clips){assert.ok(c.start>=0);assert.ok(c.end<=(c.id==='A'?a:b));}assert.ok(plan(variant.clips,variant.fade).length>0);}
 }
});
test('crossfade and overlay durations are shared between playback and export',()=>{
 const list=[{id:'A',start:0,end:20},{id:'B',start:0,end:30}];assert.equal(plan(list,5).length,45);
 list[1].overlay=true;list[1].delay=10;assert.equal(plan(list,5).length,40);
});
test('reject invalid times and missing audio',()=>{
 for(const d of [undefined,NaN,0,-1,Infinity])assert.throws(()=>suggestions(d,30));
 assert.throws(()=>plan([{id:'A',start:5,end:3}]));assert.throws(()=>plan([{id:'B',start:0,end:3,delay:Infinity}]));assert.throws(()=>plan([],NaN));
});
test('suggestions preserve selected phrases without adding synthetic effects',()=>{
 const ranges={A:{start:42,end:115},B:{start:19,end:88}};
 for(const s of suggestions(120,90,ranges))for(const c of s.clips){assert.equal(c.start,ranges[c.id].start);assert.equal(c.end,ranges[c.id].end);assert.equal(c.effect,'none');assert.equal(c.impact,0);}
 for(const A of [{start:-1,end:3},{start:2,end:121},{start:3,end:2},{start:NaN,end:3},{start:1,end:1.1}])assert.throws(()=>suggestions(120,90,{...ranges,A}));
 assert.throws(()=>suggestions(120,90,{}));
});

const {analyzeTempo, estimateTempo} = require('../assets/tempo.js');
function clickTrack(rate, times) {
  const left = new Float32Array(rate * 12);
  const right = new Float32Array(left.length);
  for (const t of times) right.fill(0.7, Math.round(t * rate), Math.round((t + 0.04) * rate));
  return {sampleRate: rate, length: left.length, numberOfChannels: 2,
    getChannelData: i => i === 0 ? left : right};
}
test('measures selected stereo pulse and safely flags half/double ambiguity at different sample rates', () => {
  for (const rate of [44100, 48000]) for (const bpm of [72, 100, 128, 160]) {
    const times = Array.from({length: 16}, (_, i) => 4.1 + i * 60 / bpm);
    const buffer = clickTrack(rate, times);
    const analysis = analyzeTempo(buffer, 4, 12);
    assert.ok(analysis);
    assert.equal(analysis.bpm, bpm);
    if (bpm === 72) {
      assert.equal(analysis.ambiguous, true);
      assert.ok(analysis.candidateBpms.includes(144));
      assert.equal(estimateTempo(buffer, 4, 12), null);
    } else {
      assert.equal(analysis.ambiguous, false);
      assert.ok(Math.abs(estimateTempo(buffer, 4, 12) - bpm) <= 1);
    }
    assert.equal(estimateTempo(buffer, 0, 4), null);
    assert.equal(estimateTempo(buffer, 4, 6), null);
  }
});
test('declines irregular transients and isolated attacks', () => {
  for (const times of [[1], [0.2, 0.57, 1.32, 1.55, 2.45, 3.01, 3.22, 4.06]]) {
    assert.equal(estimateTempo(clickTrack(44100, times), 0, 10), null);
  }
});

test('both studio pages bind the A and B controls to their selection and decoded audio', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  for (const [page, selector] of [['Remix.html', 'sel'], ['remix.html', 'selection']]) {
    const html = fs.readFileSync(page, 'utf8');
    const controls = Object.fromEntries([...html.matchAll(/<button[^>]+id="(tempo[AB])"/g)].map(m => [m[1], {}]));
    const buffer = clickTrack(44100, Array.from({length: 16}, (_, i) => 4.1 + i / 2));
    let message;
    const scope = vm.createContext({$: id => controls[id], tracks: {A: {buffer}, B: {buffer}},
      [selector]: id => id === 'A' ? {start: 4, end: 12} : {start: 0, end: 4}, note: value => {message = value;}});
    vm.runInContext(fs.readFileSync('assets/tempo.js', 'utf8'), scope);
    const binding = html.match(/<script src="assets\/tempo.js"><\/script><script>([^<]+)<\/script>/);
    vm.runInContext(binding[1], scope);
    controls.tempoA.onclick();
    assert.match(message, /^A .*120 BPM/);
    controls.tempoB.onclick();
    assert.match(message, /^B .*belirsiz/);
  }
});

test('cinematic overlay aligns both source beat starts only when projected drift stays bounded', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const studio = fs.readFileSync('assets/studio.js', 'utf8');
  const select = studio.slice(studio.indexOf('function selectedSuggestion'), studio.indexOf('for(let i=0;i<3;i++)'));
  const values = {startA: 2, endA: 12, startB: 1.02, endB: 11.02};
  const aBuffer = {...clickTrack(48000, Array.from({length: 20}, (_, i) => 2.10 + i / 2)), duration: 12};
  const makeScope = bTimes => {
    const bBuffer = {...clickTrack(48000, bTimes), duration: 12};
    const scope = vm.createContext({tracks: {A: {buffer: aBuffer}, B: {buffer: bBuffer}},
      $: id => ({value: values[id]}), MixCore: {suggestions}, ...require('../assets/tempo.js')});
    vm.runInContext(select, scope);
    return scope;
  };

  const aligned = makeScope(Array.from({length: 20}, (_, i) => 1.07 + i / 2));
  const result = aligned.selectedSuggestion(2);
  assert.ok(Math.abs(result.clips[1].delay - 4.10) < 0.011);
  assert.ok(Math.abs(result.clips[1].start - 1.07) < 0.011);
  assert.match(result.description, /A\/B giriş vuruşları eşleştirildi/);
  assert.deepEqual(result.clips, aligned.selectedSuggestion(2).clips);
  assert.equal(result.clips[0].start, 2);
  assert.equal(result.clips[1].end, 11.02);

  const mismatched = makeScope(Array.from({length: 18}, (_, i) => 1.07 + i * 60 / 110));
  const fallback = mismatched.selectedSuggestion(2);
  assert.equal(fallback.clips[1].delay, 4);
  assert.equal(fallback.clips[1].start, 1.02);
  assert.match(fallback.description, /varsayılan giriş korundu/);

  assert.deepEqual(aligned.selectedSuggestion(0).clips,
    suggestions(12, 12, {A:{start:2,end:12}, B:{start:1.02,end:11.02}})[0].clips);
});

test('energetic trims only a silent lead-in inside B and keeps the original selection', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync('assets/studio.js', 'utf8');
  const select = source.slice(source.indexOf('function selectedSuggestion'), source.indexOf('for(let i=0;i<3;i++)'));
  for (const [at, length, gain, expected] of [
    [2.8, .3, .5, 2.77], [2.1, .3, .5, 2], [2.8, .02, .5, 2],
    [2.8, .3, .01, 2], [6.5, .3, .5, 2], [2.8, .3, 0, 2]
  ]) {
    const buffer = {...clickTrack(48000, [0.5]), duration: 12};
    buffer.getChannelData(1).fill(gain, Math.round(at * 48000), Math.round((at + length) * 48000));
    const values = {startA: 0, endA: 8, startB: 2, endB: 10};
    const scope = vm.createContext({tracks: {A: {buffer}, B: {buffer}}, $: id => ({value: values[id]}),
      MixCore: {suggestions}, ...require('../assets/tempo.js')});
    vm.runInContext(select, scope);
    const energetic = scope.selectedSuggestion(1);
    assert.ok(Math.abs(energetic.clips[1].start - expected) < 0.001);
    assert.equal(energetic.clips[1].end, 10);
    assert.equal(scope.selectedSuggestion(0).clips[1].start, 2);
    assert.deepEqual(scope.selectedSuggestion(1).clips, energetic.clips);
  }
});

test('emotional crossfade follows a sustained lift only within the playable overlap', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const studio = fs.readFileSync('assets/studio.js', 'utf8');
  const select = studio.slice(studio.indexOf('function selectedSuggestion'), studio.indexOf('for(let i=0;i<3;i++)'));
  for (const [intro, riseLength, endA, expected] of [
    [.025, 1, 10, 2.25], [.025, .25, 10, 5], [0, 1, 10, 5],
    [.4, 1, 10, 5], [.025, 1, 4, 5]
  ]) {
    const buffer = {...clickTrack(44100, []), duration: 12};
    const right = buffer.getChannelData(1);
    right.fill(.8, 0, 44100);
    right.fill(intro, 44100);
    right.fill(.4, Math.ceil(3.25 * 44100), Math.ceil((3.25 + riseLength) * 44100));
    const values = {startA: 0, endA, startB: 1, endB: 11};
    const scope = vm.createContext({tracks: {A: {buffer}, B: {buffer}}, $: id => ({value: values[id]}),
      MixCore: {suggestions}, ...require('../assets/tempo.js')});
    vm.runInContext(select, scope);
    const result = scope.selectedSuggestion(0);
    assert.equal(result.fade, expected);
    assert.deepEqual(result.clips.map(c => [c.start, c.end]), [[0, endA], [1, 11]]);
    assert.equal(plan(result.clips, result.fade).items[1].at, endA - Math.min(endA / 2, expected));
  }
});

test('stop and newer playback cancel pending audio resumes in both editors', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  for (const [page, name] of [['Remix.html', 'play'], ['remix.html', 'playSequence']]) {
    const html = fs.readFileSync(page, 'utf8');
    const stop = html.match(/function stop\(\).*$/m)[0];
    const play = html.match(new RegExp('async function ' + name + '\\(.*$', 'm'))[0];
    const pending = [];
    let starts = 0;
    const gain = {setValueAtTime(){}, linearRampToValueAtTime(){}};
    const scope = vm.createContext({
      AbortController,
      ctx: {resume: () => new Promise(resolve => pending.push(resolve)), currentTime: 0,
        createBufferSource: () => ({connect: () => ({connect(){}}), start(){starts++;}, stop(){}}),
        createGain: () => ({gain})},
      $: () => ({style: {}, value: 1}), note(){}, clearTimeout(){}, setTimeout(){},
      performance: {now: () => 0}, schedule: () => {starts++; return 2;},
      fadeTime: () => 0, total: () => 2, sec: String, tracks: {A: {buffer: {}}}
    });
    vm.runInContext('let sources=[],active=[],timer=null,stopTimer=null,playbackVersion=0,stretchAbortController=null;\n' + stop + '\n' + play, scope);
    const clips = [{id:'A', start:0, end:2}];
    const stopped = scope[name](clips);
    scope.stop();
    pending.shift()();
    const stoppedResult = await stopped;
    if(name === 'play')assert.equal(stoppedResult, false);
    assert.equal(starts, 0, page + ' must remain stopped after resume');

    const old = scope[name](clips);
    const latest = scope[name](clips);
    pending.pop()();
    const latestResult = await latest;
    if(name === 'play')assert.equal(latestResult, true);
    assert.equal(starts, 1, page + ' latest request starts once');
    pending.shift()();
    await old;
    assert.equal(starts, 1, page + ' stale request cannot start another source');

    const earlier = scope[name](clips);
    const newer = scope[name](clips);
    pending.shift()();
    await earlier;
    assert.equal(starts, 1, page + ' early stale resume stays cancelled');
    pending.shift()();
    await newer;
    assert.equal(starts, 2, page + ' newer request starts after stale resume');

    scope.stop();
    const next = scope[name](clips);
    pending.shift()();
    await next;
    assert.equal(starts, 3, page + ' can play again after stop');
  }
});

test('cancelled preview cannot overwrite the stop or newer preview message', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const studio = fs.readFileSync('assets/studio.js', 'utf8');
  const handler = studio.match(/preview.onclick=async.*$/m)[0];
  const pending = [];
  let message = 'stopped';
  let selection = 0;
  const scope = vm.createContext({
    preview: {}, i: 0,
    selectedSuggestion: () => ({name:'Preview ' + ++selection, clips:[], fade:2, description:'test'}),
    play: () => new Promise(resolve => pending.push(resolve)),
    note: text => {message = text;}
  });
  vm.runInContext(handler, scope);
  const old = scope.preview.onclick();
  const newer = scope.preview.onclick();
  pending[1](true);
  await newer;
  const current = message;
  pending[0](false);
  await old;
  assert.equal(message, current);
  const stopped = scope.preview.onclick();
  message = 'stopped';
  pending[2](false);
  await stopped;
  assert.equal(message, 'stopped');
});

test('audio errors stop partial playback, allow retry, and stale failures stay silent', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  for (const [page, name] of [['Remix.html','play'],['remix.html','playSequence']]) {
    const html = fs.readFileSync(page,'utf8');
    let message = '', stopped = 0;
    const pending = [];
    const ctx = {resume: () => new Promise((resolve,reject) => pending.push({resolve,reject})),
      createBufferSource(){throw Error('audio failed');}};
    const scope = vm.createContext({AbortController,ctx, $:()=>({style:{},value:1}), note:s=>{message=s;},
      clearTimeout(){}, setTimeout(){}, performance:{now:()=>0}, fadeTime:()=>0,
      schedule(){throw Error('audio failed');}});
    vm.runInContext('let playbackVersion=0,sources=[],active=[],timer=null,stopTimer=null,stretchAbortController=null;\n'+
      html.match(/function stop\(\).*$/m)[0]+'\n'+
      html.match(new RegExp('async function '+name+'\\(.*$','m'))[0],scope);
    const list=[{id:'A',start:0,end:2}];
    const failed=scope[name](list);
    scope.partial={stop(){stopped++;}};
    vm.runInContext((name==='play'?'sources':'active')+'.push(partial)',scope);
    pending.shift().resolve();
    assert.equal(await failed,false);
    assert.equal(stopped,1);
    assert.match(message,/Ses başlatılamadı/);

    const older=scope[name](list);
    const newer=scope[name](list);
    message='new request';
    pending.shift().reject(Error('old permission failure'));
    await older;
    assert.equal(message,'new request');
    pending.shift().reject(Error('permission failure'));
    assert.equal(await newer,false);
    assert.match(message,/permission failure/);
    assert.equal(vm.runInContext('sources.length+active.length',scope),0);
  }
});

test('rejects corrupt gain controls while accepting legacy defaults and supported limits', () => {
  const clip={id:'A',start:0,end:2};
  for(const [key,max] of [['volume',1.3],['overVol',1],['impact',1]]) {
    for(const value of [-.01,NaN,Infinity,'0.5',max+.01]) {
      assert.throws(()=>plan([{...clip,[key]:value}]),/ses ayarı/);
    }
    for(const value of [0,max,null,undefined]) {
      assert.equal(plan([{...clip,[key]:value}]).length,2);
    }
  }
  assert.equal(plan([clip]).length,2);
});


test('WAV peak ceiling attenuates every channel to -1 dBFS without boosting quiet mixes', () => {
  const channels = [
    Float32Array.from([0.5, -0.4, 1.5]),
    Float32Array.from([-1.2, 0.2, 0])
  ];
  const buffer = {numberOfChannels:2,length:3,sampleRate:44100,getChannelData:i=>channels[i]};
  const result = require('../assets/mix-core.js').applyPeakCeiling(buffer, -1);
  const ceiling = Math.pow(10, -1 / 20);
  assert.ok(result.gain < 1);
  assert.ok(Math.abs(result.peakAfter - ceiling) < 1e-6);
  for (const channel of channels) for (const sample of channel) assert.ok(Math.abs(sample) <= ceiling + 1e-6);

  const quiet = Float32Array.from([0.1, -0.2, 0.05]);
  const quietBuffer = {numberOfChannels:1,length:3,sampleRate:44100,getChannelData:()=>quiet};
  const quietResult = require('../assets/mix-core.js').applyPeakCeiling(quietBuffer, -1);
  assert.equal(quietResult.gain, 1);
  const quietBefore = [...quiet];
  assert.deepEqual([...quiet], quietBefore);

  const silent = new Float32Array(3);
  const silentResult = require('../assets/mix-core.js').applyPeakCeiling(
    {numberOfChannels:1,length:3,sampleRate:44100,getChannelData:()=>silent}, -1);
  assert.equal(silentResult.gain, 1);
  assert.equal(silentResult.peakAfter, 0);
});

test('WAV peak ceiling rejects malformed buffers and non-finite samples before mutation', () => {
  const apply = require('../assets/mix-core.js').applyPeakCeiling;
  assert.throws(() => apply(null), /ses tamponu/);
  assert.throws(() => apply({numberOfChannels:1,length:1,sampleRate:44100,getChannelData:()=>new Float32Array(1)}, 0), /Tepe sınırı/);
  const loud = Float32Array.from([1.5]);
  const invalid = Float32Array.from([NaN]);
  assert.throws(() => apply({numberOfChannels:2,length:1,sampleRate:44100,getChannelData:i=>i===0?loud:invalid}), /geçersiz örnek/);
  assert.equal(loud[0], 1.5, 'validation must finish before any channel is modified');
  assert.throws(() => apply({numberOfChannels:1,length:1,sampleRate:44100,getChannelData:()=>new Float32Array(1)}, -13), /Tepe sınırı/);
});


test('all remix WAV output paths apply the shared sample peak ceiling', () => {
  const fs = require('node:fs');
  const advanced = fs.readFileSync('Remix.html', 'utf8');
  const legacy = fs.readFileSync('remix.html', 'utf8');
  const local = fs.readFileSync('assets/studio.js', 'utf8');
  assert.ok(advanced.includes('MixCore.applyPeakCeiling(b,-1)'));
  assert.ok(local.includes('MixCore.applyPeakCeiling(rendered,-1)'));
  assert.ok(legacy.includes('<script src="assets/mix-core.js"></script>'));
  assert.ok(legacy.includes('MixCore.applyPeakCeiling(result,-1)'));
});

test('advanced Remix Studio reuses one preview compressor bus across auditions', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const html = fs.readFileSync('Remix.html', 'utf8');
  const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline, 'advanced editor inline script exists');
  const source = inline[1];
  const start = source.indexOf('function masterBus');
  const end = source.indexOf('async function play', start);
  assert.ok(start >= 0 && end > start, 'master bus and scheduler are present');
  const engine = () => {
    const state = {compressors: 0, connections: 0, sources: 0, lastMaster: null};
    const context = {
      destination: {},
      createDynamicsCompressor() {
        state.compressors++;
        state.lastMaster = {
          threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
          connect() { state.connections++; },
          disconnect() { state.disconnected = true; }
        };
        return state.lastMaster;
      },
      createBufferSource() {
        return {connect(){}, start(){state.sources++;}};
      },
      createGain() {
        return {connect(){}, gain:{setValueCurveAtTime(){}}};
      }
    };
    return {context, state};
  };
  const preview = engine();
  const scope = vm.createContext({
    ctx: preview.context, previewMaster: null, sources: [],
    tracks: {A:{buffer:{duration:4}}}, MixCore: {plan},
    $: () => ({value:'0.5'})
  });
  vm.runInContext(source.slice(start, end), scope);
  const clips = [{id:'A',start:0,end:2}];
  scope.schedule(clips, preview.context, 0, 0.5);
  const firstBus = scope.previewMaster;
  scope.schedule(clips, preview.context, 0, 0.5);
  assert.equal(preview.state.compressors, 1, 'preview must create only one compressor');
  assert.equal(preview.state.connections, 1, 'preview master must connect once');
  assert.equal(preview.state.sources, 2, 'each audition still schedules its own source');
  assert.equal(scope.previewMaster, firstBus, 'repeated audition must reuse the same bus');

  const offline = engine();
  scope.schedule(clips, offline.context, 0, 0.5);
  assert.equal(offline.state.compressors, 1, 'offline export gets its own context-local bus');
  assert.notEqual(offline.state.lastMaster, firstBus, 'offline render must not reuse the live output bus');
});

test('timeline accounts for pitch-preserving stretch without changing source ranges',()=>{
 const list=[{id:'A',start:0,end:10},{id:'B',start:5,end:15,stretchRate:1.25}],result=plan(list,2);
 assert.equal(result.items[1].dur,8);assert.equal(result.items[1].c.start,5);assert.equal(result.items[1].c.end,15);assert.equal(result.length,16);
 for(const rate of [.79,1.251,NaN,Infinity,'1.1'])assert.throws(()=>plan([{id:'B',start:0,end:10,stretchRate:rate}]));
});

test('stopping an in-flight WSOLA preparation aborts it before scheduling audio',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),html=fs.readFileSync('Remix.html','utf8');
 const stop=html.match(/function stop\(\).*$/m)[0],play=html.match(/async function play\(.*$/m)[0];
 let preparedSignal=null,resolvePrepared=null,scheduled=0;
 const scope=vm.createContext({
  AbortController,
  ctx:{resume:()=>Promise.resolve(),currentTime:0},
  prepareStretchedBuffers:(list,context,signal)=>{preparedSignal=signal;return new Promise(resolve=>{resolvePrepared=resolve;});},
  schedule:()=>{scheduled++;return 2;},
  $:()=>({style:{},value:1}),note(){},clearTimeout(){},setTimeout(){},performance:{now:()=>0}
 });
 vm.runInContext('let sources=[],timer=null,playbackVersion=0,previewMaster=null,stretchAbortController=null;\n'+stop+'\n'+play,scope);
 const pending=scope.play([{id:'B',start:0,end:2,stretchRate:1.2}]);
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.ok(preparedSignal,'WSOLA preparation received an AbortSignal');
 scope.stop();assert.equal(preparedSignal.aborted,true);
 resolvePrepared(new Map());
 assert.equal(await pending,false);assert.equal(scheduled,0);
});
