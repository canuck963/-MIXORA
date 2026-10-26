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
