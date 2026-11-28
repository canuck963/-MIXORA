const {test}=require('node:test');const assert=require('node:assert/strict');
const {stretchChannels,stretchChannelsAsync,stretchAudioBufferAsync,clearCache}=require('../assets/wsola.js');
function tone(sr,seconds,freq,amp=.4,phase=0){const x=new Float32Array(Math.round(sr*seconds));for(let i=0;i<x.length;i++)x[i]=amp*Math.sin(2*Math.PI*freq*i/sr+phase);return x;}
function freq(x,sr){let n=0;for(let i=1;i<x.length;i++)if(x[i-1]<=0&&x[i]>0)n++;return n/(x.length/sr);}
function fakeBuffer(channels,sr){return {sampleRate:sr,length:channels[0].length,duration:channels[0].length/sr,numberOfChannels:channels.length,getChannelData:i=>channels[i]};}
function context(){return {createBuffer(count,length,sr){return fakeBuffer(Array.from({length:count},()=>new Float32Array(length)),sr);}};}
test('WSOLA changes duration while retaining a 440 Hz tone pitch',()=>{const sr=48000,input=tone(sr,2,440);for(const rate of [.8,1.1,1.2,1.25]){const out=stretchChannels([input],sr,rate);assert.equal(out.length,Math.round(input.length/rate));assert.ok(Math.abs(out.duration-2/rate)<1/sr);assert.ok(Math.abs(freq(out.channels[0],sr)-440)<2);}});
test('WSOLA preserves stereo channel balance and asynchronous output shape',async()=>{const sr=44100,left=tone(sr,1.5,330,.4),right=tone(sr,1.5,330,.2),out=stretchChannels([left,right],sr,1.15);const rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);assert.ok(Math.abs(rms(out.channels[0])/rms(out.channels[1])-2)<.03);const asyncOut=await stretchChannelsAsync([left],sr,.9,{yieldEvery:3});assert.equal(asyncOut.length,Math.round(left.length/.9));assert.ok(Math.abs(freq(asyncOut.channels[0],sr)-330)<2);});
test('AudioBuffer adapter caches the same selected segment for preview and offline export',async()=>{clearCache();const sr=48000,buffer=fakeBuffer([tone(sr,2,440)],sr);const a=await stretchAudioBufferAsync(buffer,.25,1.75,1.2,context()),b=await stretchAudioBufferAsync(buffer,.25,1.75,1.2,context());assert.strictEqual(a,b);assert.ok(Math.abs(a.duration-1.5/1.2)<1/sr);clearCache();const c=await stretchAudioBufferAsync(buffer,.25,1.75,1.2,context());assert.notStrictEqual(a,c);});
test('WSOLA rejects invalid rates, mismatched channels, non-finite samples and long clips',()=>{const sr=48000,valid=tone(sr,.5,220);for(const rate of [.79,1.251,NaN,Infinity])assert.throws(()=>stretchChannels([valid],sr,rate));assert.throws(()=>stretchChannels([valid,new Float32Array(valid.length-1)],sr,1));const invalid=valid.slice();invalid[10]=NaN;assert.throws(()=>stretchChannels([invalid],sr,1));assert.throws(()=>stretchChannels([new Float32Array(sr*30.1)],sr,1.1));assert.throws(()=>stretchChannels([new Float32Array(sr*.1)],sr,1.1));});

test('async WSOLA yields during validation and aborts without returning a partial buffer',async()=>{
 const sr=48000,input=tone(sr,2,440),controller=new AbortController();
 const pending=stretchChannelsAsync([input],sr,1.2,{signal:controller.signal,validationChunkSize:1024});
 await new Promise(resolve=>setTimeout(resolve,5));controller.abort();
 await assert.rejects(pending,error=>error.name==='AbortError');
 const completed=await stretchChannelsAsync([input],sr,1.2);
 assert.equal(completed.length,Math.round(input.length/1.2));
 assert.ok(Math.abs(freq(completed.channels[0],sr)-440)<2);
});
test('AudioBuffer adapter never caches an aborted WSOLA render',async()=>{
 clearCache();const sr=48000,buffer=fakeBuffer([tone(sr,2,440)],sr),controller=new AbortController();
 const pending=stretchAudioBufferAsync(buffer,0,2,1.2,context(),{signal:controller.signal,validationChunkSize:1024});
 await new Promise(resolve=>setTimeout(resolve,5));controller.abort();
 await assert.rejects(pending,error=>error.name==='AbortError');
 const first=await stretchAudioBufferAsync(buffer,0,2,1.2,context());
 const second=await stretchAudioBufferAsync(buffer,0,2,1.2,context());
 assert.strictEqual(first,second);assert.ok(Math.abs(first.duration-2/1.2)<1/sr);
});
