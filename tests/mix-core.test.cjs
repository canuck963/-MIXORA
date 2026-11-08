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

const {estimateTempo} = require('../assets/tempo.js');
function clickTrack(rate, times) {
  const left = new Float32Array(rate * 12);
  const right = new Float32Array(left.length);
  for (const t of times) right.fill(0.7, Math.round(t * rate), Math.round((t + 0.04) * rate));
  return {sampleRate: rate, length: left.length, numberOfChannels: 2,
    getChannelData: i => i === 0 ? left : right};
}
test('measures selected stereo pulse at different sample rates', () => {
  for (const rate of [44100, 48000]) for (const bpm of [72, 100, 128, 160]) {
    const times = Array.from({length: 16}, (_, i) => 4.1 + i * 60 / bpm);
    const buffer = clickTrack(rate, times);
    assert.ok(Math.abs(estimateTempo(buffer, 4, 12) - bpm) <= 1);
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

test('cinematic preview and apply use the same nearby observed beat or the original delay', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const studio = fs.readFileSync('assets/studio.js', 'utf8');
  const select = studio.slice(studio.indexOf('function selectedSuggestion'), studio.indexOf('for(let i=0;i<3;i++)'));
  const range = {startA: 2, endA: 12, startB: 1, endB: 9};
  for (const regular of [true, false]) {
    const times = regular ? Array.from({length: 20}, (_, i) => 2.16 + i / 2) : [];
    const buffer = {...clickTrack(48000, times), duration: 12};
    const context = vm.createContext({tracks: {A: {buffer}, B: {buffer}}, $: id => ({value: range[id]}),
      MixCore: {suggestions}, ...require('../assets/tempo.js')});
    vm.runInContext(select, context);
    const result = context.selectedSuggestion(2);
    assert.ok(Math.abs(result.clips[1].delay - (regular ? 4.16 : 4)) < 0.011);
    assert.match(result.description, regular ? /hizalandı/ : /varsayılan/);
    assert.deepEqual(result.clips, context.selectedSuggestion(2).clips);
    assert.equal(result.clips[0].start, 2);
    assert.equal(result.clips[1].start, 1);
    assert.deepEqual(context.selectedSuggestion(0).clips, suggestions(12, 12, {A:{start:2,end:12}, B:{start:1,end:9}})[0].clips);
  }
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
      ctx: {resume: () => new Promise(resolve => pending.push(resolve)), currentTime: 0,
        createBufferSource: () => ({connect: () => ({connect(){}}), start(){starts++;}, stop(){}}),
        createGain: () => ({gain})},
      $: () => ({style: {}, value: 1}), note(){}, clearTimeout(){}, setTimeout(){},
      performance: {now: () => 0}, schedule: () => {starts++; return 2;},
      fadeTime: () => 0, total: () => 2, sec: String, tracks: {A: {buffer: {}}}
    });
    vm.runInContext('let sources=[],active=[],timer=null,stopTimer=null,playbackVersion=0;\n' + stop + '\n' + play, scope);
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
