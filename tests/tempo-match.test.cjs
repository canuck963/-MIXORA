const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyzeTempo,estimateTempo,tempoMatch,snapRangeToBeats,energeticDropEntry}=require('../assets/tempo.js');
const {suggestions}=require('../assets/mix-core.js');

function pulseBuffer(rate,bpm,seconds=12,offbeatStrength=0){
  const length=rate*seconds, left=new Float32Array(length), right=new Float32Array(length);
  const pulse=(time,strength)=>{
    const from=Math.round(time*rate),to=Math.min(length,from+Math.round(.04*rate));
    right.fill(strength,from,to);
  };
  for(let t=1;t<seconds-0.2;t+=60/bpm){
    pulse(t,.7);
    if(offbeatStrength>0)pulse(t+30/bpm,offbeatStrength);
  }
  return {sampleRate:rate,length,numberOfChannels:2,getChannelData:i=>i?right:left};
}

function energyLiftBuffer(rate=48000,seconds=12,ambiguous=false){
  const length=rate*seconds,right=new Float32Array(length);
  const pulse=(time,strength)=>{
    const from=Math.round(time*rate),to=Math.min(length,from+Math.round(.04*rate));
    right.fill(strength,from,to);
  };
  for(let time=1;time<seconds-.2;time+=.5){
    const strength=time<4?.1:.7;
    pulse(time,strength);
    if(ambiguous)pulse(time+.25,strength);
  }
  return {sampleRate:rate,length,numberOfChannels:1,getChannelData:()=>right,duration:seconds};
}

test('energetic drop chooses a sustained lift only on a confident beat grid',()=>{
  const buffer=energyLiftBuffer();
  const result=energeticDropEntry(buffer,0,12);
  assert.ok(result);
  assert.equal(result.bpm,120);
  assert.ok(Math.abs(result.start-4)<.03);
  assert.ok(result.confidence>=.7);
  assert.ok(result.energyRatio>=1.5);
  assert.equal(energeticDropEntry(pulseBuffer(48000,120),0,12),null,
    'uniform energy must keep the original entry');
  assert.equal(energeticDropEntry(energyLiftBuffer(48000,12,true),0,12),null,
    'ambiguous beat/offbeat grids must not move the entry');
});

test('Energetic suggestion uses the sustained beat-aligned lift while other plans stay independent',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const source=fs.readFileSync('assets/studio.js','utf8');
  const select=source.slice(source.indexOf('function selectedSuggestion'),source.indexOf('for(let i=0;i<3;i++)'));
  const buffer=energyLiftBuffer();
  const values={startA:0,endA:12,startB:0,endB:12};
  const scope=vm.createContext({
    tracks:{A:{buffer},B:{buffer}},
    $:id=>({value:values[id]}),
    MixCore:{suggestions},
    ...require('../assets/tempo.js')
  });
  vm.runInContext(select,scope);
  const energetic=scope.selectedSuggestion(1);
  assert.ok(Math.abs(energetic.clips[1].start-4)<.03);
  assert.equal(energetic.clips[1].end,12);
  assert.match(energetic.description,/enerji yükselişi/);
  assert.match(energetic.description,/120 BPM/);
  assert.equal(scope.selectedSuggestion(0).clips[1].start,0);
  assert.equal(scope.selectedSuggestion(2).clips[1].start,0);
});

test('tempo analysis exposes a bounded confidence and regular beat positions',()=>{
  for(const rate of [44100,48000])for(const bpm of [72,100,128,160]){
    const analysis=analyzeTempo(pulseBuffer(rate,bpm),0,12);
    assert.ok(analysis);
    assert.equal(analysis.bpm,bpm);
    assert.ok(analysis.confidence>=.8&&analysis.confidence<=1);
    assert.ok(analysis.regularIntervals>=5);
    assert.ok(analysis.beats.length>=4);
    assert.ok(Math.abs(analysis.beats[1]-analysis.beats[0]-60/bpm)<.025);
  }
});

test('tempo match picks the closest usable half, normal or double-time grid',()=>{
  const direct=tempoMatch(120,100);
  assert.equal(direct.recommended.id,'normal');
  assert.equal(direct.recommended.rate,1.2);
  assert.equal(direct.hasInRange,true);

  const half=tempoMatch(128,90);
  assert.equal(half.recommended.id,'half');
  assert.ok(Math.abs(half.recommended.rate-128/180)<1e-12);
  assert.equal(half.recommended.targetBpm,64);

  const outside=tempoMatch(100,150);
  assert.equal(outside.hasInRange,false);
  assert.equal(outside.recommended.id,'double');
  assert.equal(outside.recommended.inRange,false);
});

test('tempo match rejects invalid BPM or rate boundaries',()=>{
  for(const [a,b,min,max] of [[0,100,.7,1.3],[181,100,.7,1.3],[100,NaN,.7,1.3],[100,Infinity,.7,1.3],[100,100,0,1],[100,100,1,.5]])
    assert.equal(tempoMatch(a,b,min,max),null);
});

test('beat snapping aligns only nearby selection edges and preserves valid duration',()=>{
  const buffer=pulseBuffer(48000,120);
  const snapped=snapRangeToBeats(buffer,5.95,9.05);
  assert.ok(snapped);
  assert.equal(snapped.bpm,120);
  assert.equal(snapped.snappedStart,true);
  assert.equal(snapped.snappedEnd,true);
  assert.ok(Math.abs(snapped.start-6.0)<.011);
  assert.ok(Math.abs(snapped.end-9.0)<.011);
  assert.ok(snapped.end-snapped.start>=.15);
  assert.equal(snapRangeToBeats(buffer,4.2,9.8),null);
  const oneEdge=snapRangeToBeats(buffer,5.95,9.8);
  assert.ok(oneEdge);
  assert.equal(oneEdge.snappedStart,true);
  assert.equal(oneEdge.snappedEnd,false);
  assert.equal(oneEdge.end,9.8);
});

function mixedTempoBuffer(){
  const rate=48000,length=rate*30,right=new Float32Array(length);
  const pulse=time=>{
    const from=Math.round(time*rate),to=Math.min(length,from+Math.round(.04*rate));
    right.fill(.7,from,to);
  };
  for(let time=1;time<11;time+=60/72)pulse(time);
  for(let time=19;time<29;time+=.5)pulse(time);
  return {sampleRate:rate,length,numberOfChannels:1,getChannelData:()=>right};
}

test('beat snap reports the BPM of the edge it actually aligned when the other window is ambiguous',()=>{
  const result=snapRangeToBeats(mixedTempoBuffer(),6.04,24.04);
  assert.ok(result);
  assert.equal(result.snappedStart,false);
  assert.equal(result.snappedEnd,true);
  assert.equal(result.bpm,120);
  assert.ok(Math.abs(result.end-24)<.03);
});

test('beat snapping rejects invalid ranges, tolerance and quiet material',()=>{
  const buffer=pulseBuffer(48000,120);
  for(const args of [[buffer,-1,5],[buffer,2,1],[buffer,0,12.1],[buffer,0,0.1],[buffer,1,5,NaN],[buffer,1,5,-.1],[buffer,1,5,1.1]])
    assert.equal(snapRangeToBeats(...args),null);
  const quiet={sampleRate:48000,length:48000*8,numberOfChannels:1,getChannelData:()=>new Float32Array(48000*8)};
  assert.equal(snapRangeToBeats(quiet,1,7),null);
});
test('both studio pages expose opt-in beat snap buttons and bind their own range selector',()=>{
  const fs=require('node:fs');
  for(const [page,selector] of [['Remix.html','sel'],['remix.html','selection']]){
    const html=fs.readFileSync(page,'utf8');
    assert.match(html,/id="tempoA"/);assert.match(html,/id="tempoB"/);assert.match(html,/id="snapA"/);assert.match(html,/id="snapB"/);
    assert.ok(html.includes('bindBeatSnapControls('+selector+')'));
  }
});
test('beat snap UI updates only the chosen source and leaves it unchanged when no beat is found',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const controls={snapA:{},snapB:{},startA:{value:'5.95'},endA:{value:'9.05'},startB:{value:'4.2'},endB:{value:'9.8'}};
  let message='';
  const scope=vm.createContext({$:id=>controls[id],tracks:{A:{buffer:pulseBuffer(48000,120)},B:{buffer:pulseBuffer(48000,120)}},note:value=>message=value});
  vm.runInContext(fs.readFileSync('assets/tempo.js','utf8'),scope);
  vm.runInContext('bindBeatSnapControls(id=>({start:Number($("start"+id).value),end:Number($("end"+id).value)}))',scope);
  controls.snapA.onclick();
  assert.equal(controls.startA.value,'6.00');assert.equal(controls.endA.value,'9.00');
  controls.snapB.onclick();
  assert.equal(controls.startB.value,'4.2');assert.equal(controls.endB.value,'9.8');
  assert.match(message,/Kesit değişmedi/);
});


test('tempo estimator keeps the main pulse when quieter syncopated attacks are present',()=>{
  const buffer=pulseBuffer(48000,120,12,.15);
  const analysis=analyzeTempo(buffer,0,12);
  assert.ok(analysis);
  assert.equal(analysis.bpm,120);
  assert.equal(analysis.ambiguous,false);
  assert.ok(analysis.confidence>.75);
  assert.equal(estimateTempo(buffer,0,12),120);
});

test('tempo estimator reports half/double-time ambiguity instead of guessing',()=>{
  const buffer=pulseBuffer(48000,72);
  const analysis=analyzeTempo(buffer,0,12);
  assert.ok(analysis);
  assert.equal(analysis.bpm,72);
  assert.equal(analysis.ambiguous,true);
  assert.deepEqual(analysis.candidateBpms,[72,144]);
  assert.equal(estimateTempo(buffer,0,12),null);
  assert.equal(snapRangeToBeats(buffer,5.95,9.05),null,
    'ambiguous tempo must not silently move a selection edge');
});

test('tempo estimator rejects an equally strong beat/offbeat grid as ambiguous',()=>{
  const buffer=pulseBuffer(48000,120,12,.7);
  const analysis=analyzeTempo(buffer,0,12);
  assert.ok(analysis);
  assert.equal(analysis.ambiguous,true);
  assert.ok(analysis.confidence<.58);
  assert.equal(estimateTempo(buffer,0,12),null);
});

test('DJ BPM control explains ambiguous half/double tempo and avoids auto confidence',()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const controls={tempoA:{},tempoB:{}};
  let message='';
  const buffer=pulseBuffer(48000,72);
  const scope=vm.createContext({
    $:id=>controls[id],
    tracks:{A:{buffer}},
    note:value=>{message=value;}
  });
  vm.runInContext(fs.readFileSync('assets/tempo.js','utf8'),scope);
  vm.runInContext('bindTempoControls(()=>({start:0,end:12}))',scope);
  controls.tempoA.onclick();
  assert.match(message,/belirsiz/i);
  assert.match(message,/144/);
  assert.match(message,/otomatik hizalama yapılmadı/i);
});

test('live DJ deck uses the shared confidence-aware tempo analyzer',()=>{
  const html=require('node:fs').readFileSync('index.html','utf8');
  assert.match(html,/<script src="assets\/tempo\.js"><\/script>/);
  assert.match(html,/function estimateDeckTempo\(buffer\)/);
  assert.match(html,/analyzeTempo\(buffer,0,Math\.min\(buffer\.duration,30\)\)/);
  assert.match(html,/tempo\??\.ambiguous/);
});


function steppedPulseBuffer(lifts = [], transientAt = null) {
  const rate = 48000, seconds = 12, length = rate * seconds;
  const right = new Float32Array(length);
  const pulse = (time, strength) => {
    const from = Math.round(time * rate);
    const to = Math.min(length, from + Math.round(.04 * rate));
    right.fill(strength, from, to);
  };
  for (let time = 1; time < seconds - .2; time += .5) {
    let strength = .1;
    for (const lift of lifts) if (time >= lift.at) strength = lift.level;
    pulse(time, strength);
  }
  if (transientAt !== null) pulse(transientAt, .95);
  return {sampleRate:rate,length,numberOfChannels:1,getChannelData:()=>right,duration:seconds};
}

test('energetic entry rejects a single loud transient without a sustained follow-through',()=>{
  const buffer=steppedPulseBuffer([],3);
  assert.equal(energeticDropEntry(buffer,0,12),null);
});

test('energetic entry skips an isolated transient and finds the later sustained lift',()=>{
  const result=energeticDropEntry(steppedPulseBuffer([{at:6,level:.7}],3),0,12);
  assert.ok(result);
  assert.ok(Math.abs(result.start-6)<.03);
  assert.ok(result.confirmationRatio>=1.5);
});

test('energetic entry chooses the first sustained rise instead of a louder later section',()=>{
  const result=energeticDropEntry(steppedPulseBuffer([
    {at:4,level:.4},{at:8,level:.8}
  ]),0,12);
  assert.ok(result);
  assert.ok(Math.abs(result.start-4)<.03);
});

test('applied WSOLA tempo rate attaches only to B clips in all three suggestions',()=>{const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('assets/studio.js','utf8');const select=source.slice(source.indexOf('function selectedSuggestion'),source.indexOf('for(let i=0;i<3;i++)')),buffer=energyLiftBuffer(),values={startA:0,endA:12,startB:0,endB:12};const scope=vm.createContext({tracks:{A:{buffer},B:{buffer}},$:id=>({value:values[id]}),MixCore:{suggestions},MixoraWsola:{MAX_DURATION_SECONDS:30},appliedTempoRate:1.2,...require('../assets/tempo.js')});vm.runInContext(select,scope);for(let i=0;i<3;i++){const s=scope.selectedSuggestion(i);assert.equal(s.clips.find(c=>c.id==='B').stretchRate,1.2);assert.equal(s.clips.find(c=>c.id==='A').stretchRate,undefined);}});
test('Remix Studio exposes opt-in WSOLA controls and prepared preview/export buffers',()=>{const fs=require('node:fs'),html=fs.readFileSync('Remix.html','utf8'),studio=fs.readFileSync('assets/studio.js','utf8');assert.match(html,/assets\/wsola\.js/);assert.match(html,/prepareStretchedBuffers\(list,ctx(?:,controller\?\.signal)?\)/);assert.match(html,/prepareStretchedBuffers\(clips,off\)/);assert.match(studio,/id="analyzeTempoMatch"/);assert.match(studio,/id="applyTempoMatch"/);assert.match(studio,/stretchAudioBufferAsync/);});
