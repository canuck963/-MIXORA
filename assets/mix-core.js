/* Shared deterministic timeline logic, used by playback, export and tests. */
(function(root){
'use strict';
function plan(list, fade=1){
  if(!Number.isFinite(fade)||fade<0||fade>10)throw Error('Geçersiz geçiş süresi.');
  let end=0;const items=[];
  for(const c of list){
    if(!['A','B'].includes(c.id)||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end-c.start<.15)throw Error('Geçersiz ses bölümü.');
    const dur=c.end-c.start,prev=items.at(-1);
    const delay=c.delay??0;if(!Number.isFinite(delay)||delay<0||delay>420)throw Error('Geçersiz gecikme.');
    const at=!prev?0:c.overlay?prev.at+delay:Math.max(0,end-Math.min(fade,dur/2,prev.dur/2));
    items.push({c,dur,at});end=Math.max(end,at+dur);
  }
  return {items,length:end};
}
function suggestions(a,b,selections){
  if(![a,b].every(d=>Number.isFinite(d)&&d>=.15))throw Error('Önce iki geçerli ses dosyası yükle.');
  const ranges={};
  for(const [id,duration] of [['A',a],['B',b]]){
    const r=selections?selections[id]:{start:0,end:duration};
    if(!r||!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end>duration||r.end-r.start<.15)throw Error('Başlangıç ve bitiş saniyelerini kontrol et.');
    ranges[id]=r;
  }
  const clip=(id,extra={})=>({id,...ranges[id],volume:.85,effect:'none',impact:0,overlay:false,...extra});
  const ad=ranges.A.end-ranges.A.start;
  return [
    {name:'Duygusal',description:'Seçtiğin iki bölüm arasında yumuşak geçiş.',fade:5,clips:[clip('A'),clip('B')]},
    {name:'Enerjik',description:'Seçtiğin giriş noktalarında kısa geçiş; ek bas efekti yok.',fade:.25,clips:[clip('A',{volume:.95}),clip('B',{volume:.95})]},
    {name:'Sinematik',description:'B, A’nın üzerine girer; A’nın sesi azalır. Vokaller çakışabilir; dinleyerek kontrol et.',fade:2,clips:[clip('A'),clip('B',{overlay:true,delay:ad*.4,overVol:.8,duck:true})]}
  ];
}
const api={plan,suggestions};if(typeof module==='object')module.exports=api;else root.MixCore=api;
})(typeof globalThis==='object'?globalThis:this);
