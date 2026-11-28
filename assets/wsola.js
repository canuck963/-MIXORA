/* Bounded WSOLA time-scale modification for local remix previews and exports. */
(function(root){
'use strict';
const MAX_DURATION_SECONDS=30;
let bufferCache=new WeakMap();
function validateChannels(channels,sampleRate,rate,maxDuration=MAX_DURATION_SECONDS){
 if(!Array.isArray(channels)||channels.length<1||channels.length>2||!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>96000||!Number.isFinite(rate)||rate<.8||rate>1.25||!Number.isFinite(maxDuration)||maxDuration<.15||maxDuration>MAX_DURATION_SECONDS)throw Error('WSOLA ayarları geçersiz.');
 const length=channels[0]?.length;
 if(!Number.isSafeInteger(length)||length<Math.ceil(sampleRate*.15)||length>sampleRate*maxDuration)throw Error('Perde koruyan tempo eşitleme için kesit 0,15–30 saniye olmalı.');
 for(const channel of channels){if(!channel||!Number.isSafeInteger(channel.length)||channel.length!==length)throw Error('Ses kanalları aynı uzunlukta olmalı.');for(let i=0;i<length;i++)if(!Number.isFinite(channel[i]))throw Error('Ses kaynağında geçersiz örnek var.');}
 return length;
}
function createJob(channels,sampleRate,rate,options={}){
 const inputLength=validateChannels(channels,sampleRate,rate,options.maxDurationSeconds??MAX_DURATION_SECONDS);
 const frameLength=Math.min(inputLength,Math.max(256,Math.round(sampleRate*(options.frameSeconds??.02))));
 const overlap=Math.max(1,Math.floor(frameLength/2)),hop=frameLength-overlap,outputLength=Math.max(1,Math.round(inputLength/rate));
 if(outputLength>sampleRate*38)throw Error('Tempo eşitleme çıktısı çok uzun.');
 const output=channels.map(()=>new Float32Array(outputLength)),firstLength=Math.min(frameLength,outputLength,inputLength);
 for(let ch=0;ch<channels.length;ch++)output[ch].set(channels[ch].subarray(0,firstLength),0);
 const searchRadius=Math.max(1,Math.round(sampleRate*(options.searchSeconds??.006))),candidateStep=Math.max(1,Math.round(sampleRate/6000)),correlationStride=Math.max(1,Math.round(sampleRate/6000)),reference=new Float32Array(overlap);
 let outputStart=hop,processed=0;
 function processNext(){
  if(outputStart>=outputLength)return false;
  const count=Math.min(frameLength,outputLength-outputStart),overlapCount=Math.min(overlap,count);let referencePower=0;
  for(let j=0;j<overlapCount;j+=correlationStride){let mono=0;for(let ch=0;ch<output.length;ch++)mono+=output[ch][outputStart+j];mono/=output.length;reference[j]=mono;referencePower+=mono*mono;}
  const maxCandidate=Math.max(0,inputLength-count),expected=Math.round(outputStart*rate),center=Math.min(maxCandidate,Math.max(0,expected)),low=Math.max(0,center-searchRadius),high=Math.min(maxCandidate,center+searchRadius);
  let bestStart=center,bestScore=-Infinity,bestDistance=Math.abs(center-expected);
  if(referencePower>1e-12){
   for(let candidate=low;candidate<=high;candidate+=candidateStep){
    let dot=0,inputPower=0;
    for(let j=0;j<overlapCount;j+=correlationStride){let mono=0;for(let ch=0;ch<channels.length;ch++)mono+=channels[ch][candidate+j];mono/=channels.length;dot+=reference[j]*mono;inputPower+=mono*mono;}
    if(inputPower<=1e-12)continue;
    const score=dot/Math.sqrt(referencePower*inputPower),distance=Math.abs(candidate-expected);
    if(score>bestScore+1e-7||(Math.abs(score-bestScore)<=1e-7&&distance<bestDistance)){bestScore=score;bestStart=candidate;bestDistance=distance;}
   }
   if(high>low&&((high-low)%candidateStep)!==0){
    const candidate=high;let dot=0,inputPower=0;
    for(let j=0;j<overlapCount;j+=correlationStride){let mono=0;for(let ch=0;ch<channels.length;ch++)mono+=channels[ch][candidate+j];mono/=channels.length;dot+=reference[j]*mono;inputPower+=mono*mono;}
    if(inputPower>1e-12){const score=dot/Math.sqrt(referencePower*inputPower),distance=Math.abs(candidate-expected);if(score>bestScore+1e-7||(Math.abs(score-bestScore)<=1e-7&&distance<bestDistance))bestStart=candidate;}
   }
  }
  for(let ch=0;ch<channels.length;ch++){const source=channels[ch],target=output[ch];for(let j=0;j<count;j++){const sample=source[bestStart+j];if(j<overlapCount){const weight=.5-.5*Math.cos(Math.PI*(j+1)/(overlapCount+1));target[outputStart+j]=target[outputStart+j]*(1-weight)+sample*weight;}else target[outputStart+j]=sample;}}
  outputStart+=hop;processed++;return true;
 }
 return {output,outputLength,sampleRate,processed:()=>processed,processNext};
}
function resultOf(job){return {channels:job.output,length:job.outputLength,sampleRate:job.sampleRate,duration:job.outputLength/job.sampleRate};}
function stretchChannels(channels,sampleRate,rate,options={}){const job=createJob(channels,sampleRate,rate,options);while(job.processNext()){}return resultOf(job);}
async function stretchChannelsAsync(channels,sampleRate,rate,options={}){const job=createJob(channels,sampleRate,rate,options),yieldEvery=Math.max(1,Math.floor(options.yieldEvery??24));while(job.processNext())if(job.processed()%yieldEvery===0)await new Promise(resolve=>setTimeout(resolve,0));return resultOf(job);}
async function stretchAudioBufferAsync(buffer,start,end,rate,context){
 if(!buffer||!context||typeof context.createBuffer!=='function'||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||!Number.isFinite(rate)||rate<.8||rate>1.25||end>buffer.duration+.001)throw Error('Tempo eşitleme için ses kesiti geçersiz.');
 const sampleRate=buffer.sampleRate,startFrame=Math.max(0,Math.floor(start*sampleRate)),endFrame=Math.min(buffer.length,Math.ceil(end*sampleRate));
 if(endFrame<=startFrame)throw Error('Tempo eşitleme için ses kesiti boş.');
 const key=startFrame+':'+endFrame+':'+rate.toFixed(5);let entries=bufferCache.get(buffer);if(!entries){entries=new Map();bufferCache.set(buffer,entries);}if(entries.has(key))return entries.get(key);
 const promise=(async()=>{const channels=Array.from({length:buffer.numberOfChannels},(_,index)=>buffer.getChannelData(index).subarray(startFrame,endFrame));const result=await stretchChannelsAsync(channels,sampleRate,rate);const output=context.createBuffer(result.channels.length,result.length,sampleRate);result.channels.forEach((channel,index)=>output.getChannelData(index).set(channel));return output;})();
 entries.set(key,promise);while(entries.size>3)entries.delete(entries.keys().next().value);
 try{return await promise;}catch(error){entries.delete(key);throw error;}
}
function clearCache(){bufferCache=new WeakMap();}
const api={MAX_DURATION_SECONDS,stretchChannels,stretchChannelsAsync,stretchAudioBufferAsync,clearCache};
if(typeof module==='object')module.exports=api;else root.MixoraWsola=api;
})(typeof globalThis==='object'?globalThis:this);
