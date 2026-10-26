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
function suggestions(a,b){
  if(![a,b].every(d=>Number.isFinite(d)&&d>=.3))throw Error('Önce iki geçerli ses dosyası yükle.');
  const clip=(id,start,end,extra={})=>({id,start,end,volume:.85,effect:'none',impact:0,overlay:false,...extra});
  const ad=Math.min(a,60),bd=Math.min(b,60);
  return [
    {name:'Akıcı geçiş',description:'A’dan B’ye uzun, yumuşak çapraz geçiş.',fade:5,clips:[clip('A',0,ad),clip('B',0,bd)]},
    {name:'Enerjik DROP',description:'A’nın ardından B’ye kısa geçiş ve bas vurgusu.',fade:.25,clips:[clip('A',0,Math.min(ad,32)),clip('B',0,bd,{effect:'hard',impact:.65})]},
    {name:'Sinematik katman',description:'B, A’nın üzerine yavaşça girer; A’nın sesi azalır.',fade:2,clips:[clip('A',0,ad,{effect:'emotional',impact:.5}),clip('B',0,bd,{overlay:true,delay:ad*.4,overVol:.8,duck:true,effect:'cinematic',impact:.5})]}
  ];
}
const api={plan,suggestions};if(typeof module==='object')module.exports=api;else root.MixCore=api;
})(typeof globalThis==='object'?globalThis:this);
