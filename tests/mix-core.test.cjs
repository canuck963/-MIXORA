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
