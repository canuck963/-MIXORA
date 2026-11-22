/* Shared deterministic timeline logic, used by playback, export and tests. */
(function(root){
'use strict';
function plan(list, fade=1){
  if(!Number.isFinite(fade)||fade<0||fade>10)throw Error('Geçersiz geçiş süresi.');
  let end=0;const items=[];
  for(const c of list){
    if(!['A','B'].includes(c.id)||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end-c.start<.15)throw Error('Geçersiz ses bölümü.');
    for(const [key,max] of [['volume',1.3],['overVol',1],['impact',1]]){
      const value=c[key];
      if(value!=null&&(!Number.isFinite(value)||value<0||value>max))throw Error('Geçersiz ses ayarı.');
    }
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

function applyPeakCeiling(buffer, ceilingDb = -1) {
  if (!buffer || !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1 ||
      !Number.isInteger(buffer.length) || buffer.length < 1 ||
      !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0) {
    throw Error('Geçersiz ses tamponu.');
  }
  if (!Number.isFinite(ceilingDb) || ceilingDb < -12 || ceilingDb > -0.1) {
    throw Error('Tepe sınırı -12 ile -0.1 dBFS arasında olmalı.');
  }

  const ceiling = Math.pow(10, ceilingDb / 20);
  const channels = [];
  let peakBefore = 0;
  for (let index = 0; index < buffer.numberOfChannels; index++) {
    const samples = buffer.getChannelData(index);
    if (!samples || samples.length !== buffer.length) throw Error('Ses kanalı okunamadı.');
    channels.push(samples);
    for (let frame = 0; frame < samples.length; frame++) {
      const sample = samples[frame];
      if (!Number.isFinite(sample)) throw Error('Ses çıktısında geçersiz örnek var.');
      peakBefore = Math.max(peakBefore, Math.abs(sample));
    }
  }

  // Attenuation only: never amplify quiet mixes. Scale every channel by the
  // same factor so stereo balance and inter-channel phase are preserved.
  const gain = peakBefore > ceiling ? ceiling / peakBefore : 1;
  if (gain < 1) {
    for (const samples of channels) {
      for (let frame = 0; frame < samples.length; frame++) samples[frame] *= gain;
    }
  }
  return {
    gain,
    peakBefore,
    peakAfter: peakBefore * gain,
    ceiling,
    ceilingDb
  };
}

const api={plan,suggestions,applyPeakCeiling};if(typeof module==='object')module.exports=api;else root.MixCore=api;
})(typeof globalThis==='object'?globalThis:this);
