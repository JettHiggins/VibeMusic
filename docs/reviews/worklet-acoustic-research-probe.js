async page=>{
 // Generate the five __synthetic-*.wav clips with espeak-ng as documented in the WS1 handoff.
 // Real cached local Whisper/CLAP/SLOOP service on8001; no typed transcripts or model output mocks.
 await page.addInitScript(()=>{
  if(globalThis.__workletAcousticHook)return;globalThis.__workletAcousticHook=true;
  const Native=globalThis.WebSocket;globalThis.__acoustic={received:[],counts:{},previewAcks:[],commandAcks:[],maxBuffered:0};
  globalThis.WebSocket=class extends Native{
   constructor(url,protocols){super(String(url)==='ws://127.0.0.1:8000/ws'?'ws://127.0.0.1:8001/ws':url,protocols);this.addEventListener('message',e=>globalThis.__acoustic.received.push(JSON.parse(String(e.data))));}
   send(data){globalThis.__acoustic.maxBuffered=Math.max(globalThis.__acoustic.maxBuffered,this.bufferedAmount);const m=JSON.parse(String(data));globalThis.__acoustic.counts[m.type]=(globalThis.__acoustic.counts[m.type]??0)+1;if(m.type==='preview-ack')globalThis.__acoustic.previewAcks.push(m);if(m.type==='ack')globalThis.__acoustic.commandAcks.push(m);return super.send(data);}
  };
 });
 const base=page.url().split('/').slice(0,3).join('/');
 await page.goto(base);await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.getByRole('button',{name:/^Synth 1 /}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().revision>=1);
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,c=engine.getAudioContext(),out=c.createMediaStreamDestination();
  const seeded=engine.getSession();seeded.tracks[0].notes=[{id:'acoustic-c',step:0,duration:2,midi:60,velocity:.8},{id:'acoustic-e',step:8,duration:2,midi:64,velocity:.8}];
  await new Promise((resolve,reject)=>{
   const id=crypto.randomUUID(),timer=setTimeout(()=>{off();reject(new Error('Seed composition failed'));},5000);
   const off=engine.subscribe(m=>{if(m.type==='ack'&&m.commandId===id&&m.status!=='queued'){clearTimeout(timer);off();m.status==='applied'?resolve():reject(new Error(m.reason));}});
   engine.dispatch({id,expectedRevision:engine.getSession().revision,boundary:'next-loop',operation:{type:'load-session',session:seeded}});
  });
  const code=`class SyntheticMic extends AudioWorkletProcessor{
   constructor(){super();this.seed=42;this.samples=new Float32Array(0);this.offset=0;this.stopped=false;this.port.onmessage=({data})=>{if(data.type==='stop')this.stopped=true;else{this.samples=data.samples;this.offset=0;}};}
   process(inputs,outputs){if(this.stopped)return false;for(let i=0;i<outputs[0][0].length;i++){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;const noise=(this.seed/4294967296-.5)*.00016;const sample=this.offset<this.samples.length?this.samples[this.offset++]:0;for(const channel of outputs[0])channel[i]=noise+sample;}return true;}
  }registerProcessor('synthetic-acoustic-mic',SyntheticMic);`;
  const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
  try{await c.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
  const source=new AudioWorkletNode(c,'synthetic-acoustic-mic',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});source.connect(out);
  const decoded=new Map();
  for(const file of ['instrument-request','cancel','audition','accept','undo']){
   const response=await fetch('/__synthetic-'+file+'.wav');if(!response.ok)throw new Error('Generate speech fixture: '+file);
   const clip=await c.decodeAudioData(await response.arrayBuffer());decoded.set('/__synthetic-'+file+'.wav',clip.getChannelData(0).slice());
  }
  globalThis.__acoustic.source=source;
  globalThis.__acoustic.speak=async file=>{const samples=decoded.get(file);if(!samples)throw new Error('Unprepared speech fixture');source.port.postMessage({samples});return samples.length/c.sampleRate;};
  navigator.mediaDevices.getUserMedia=async()=>out.stream;
  await voice.enableMicrophone();await voice.enableHandsFree();
  engine.subscribe(m=>{if(m.type==='transport')globalThis.__acoustic.transport=m.transport;});
 });
 await page.waitForFunction(()=>globalThis.__voicesynth.voice.getState().speech.status==='ready',{},{timeout:15000});
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__acoustic.transport?.playing);
 const before=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession());
 const at=await page.evaluate(()=>performance.now());
 await page.evaluate(()=>globalThis.__acoustic.speak('/__synthetic-instrument-request.wav'));
 await page.waitForFunction(()=>globalThis.__voicesynth.research.getSnapshot().candidates.length>=2,{},{timeout:180000});
 const first=await page.evaluate(()=>({state:globalThis.__voicesynth.research.getSnapshot(),at:performance.now()}));
 if(!first.state.candidates.every(c=>c.provenance.includes('LAION CLAP')&&c.provenance.includes('SLOOP WASM')))throw new Error('Candidates did not come from actual configured models');
 if(first.state.status!=='complete'){
  await page.evaluate(()=>globalThis.__acoustic.speak('/__synthetic-cancel.wav'));
  await page.waitForFunction(()=>['cancelled','complete'].includes(globalThis.__voicesynth.research.getSnapshot().status),{},{timeout:30000});
 }
 await page.evaluate(()=>globalThis.__acoustic.speak('/__synthetic-audition.wav'));
 await page.waitForFunction(()=>globalThis.__voicesynth.research.getSnapshot().preview?.status==='ended',{},{timeout:30000});
 const afterPreview=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession());
 if(JSON.stringify(afterPreview)!==JSON.stringify(before))throw new Error('Preview mutated the composition');
 const chosen=await page.evaluate(()=>globalThis.__voicesynth.research.getSnapshot().candidates[1].patch);
 await page.evaluate(()=>globalThis.__acoustic.speak('/__synthetic-accept.wav'));
 await page.waitForFunction(patch=>{const {engine,research}=globalThis.__voicesynth;return research.getSnapshot().acceptance?.status==='applied'&&JSON.stringify(engine.getSession().tracks[0].patch)===JSON.stringify(patch);},chosen,{timeout:30000});
 await page.evaluate(()=>globalThis.__acoustic.speak('/__synthetic-undo.wav'));
 await page.waitForFunction(patch=>{const a=globalThis.__acoustic,u=a.received.find(m=>m.type==='command'&&m.command.operation.type==='undo');return u&&a.commandAcks.some(m=>m.commandId===u.command.id&&m.status==='applied')&&JSON.stringify(globalThis.__voicesynth.engine.getSession().tracks[0].patch)===JSON.stringify(patch);},before.tracks[0].patch,{timeout:30000});
 const final=await page.evaluate(()=>({session:globalThis.__voicesynth.engine.getSession(),transport:globalThis.__acoustic.transport,counts:globalThis.__acoustic.counts,previewAcks:globalThis.__acoustic.previewAcks,speech:globalThis.__voicesynth.voice.getState().speech,maxBuffered:globalThis.__acoustic.maxBuffered,errors:globalThis.__acoustic.received.filter(m=>m.type==='error'),contexts:globalThis.__acoustic.received.filter(m=>m.type==='research-context')}));
 if(final.speech.status!=='ready')throw new Error('Speech did not stay healthy: '+JSON.stringify(final.speech));
 if(final.counts.utterance||!final.counts['speech-audio'])throw new Error('Test bypassed actual acoustic speech transport');
 if(!final.transport.playing||JSON.stringify(final.session.tracks)!==JSON.stringify(before.tracks))throw new Error('Undo did not restore composition with playback');
 if(final.errors.length)throw new Error('Real pipeline errors: '+JSON.stringify(final.errors));
 await page.evaluate(()=>{globalThis.__voicesynth.voice.stopMicrophone();globalThis.__acoustic.source.port.postMessage({type:'stop'});globalThis.__acoustic.source.disconnect();});
 return {firstCandidatesMs:Math.round(first.at-at),description:first.state.description,candidates:first.state.candidates.length,contexts:final.contexts,actualAudioPreview:true,acceptedExactPatch:true,undoRestoredMusic:true,playbackContinued:true,counts:final.counts,previewAcks:final.previewAcks,speech:final.speech,maxBuffered:final.maxBuffered,evidence:'continuous worklet-fed room tone/espeak speech into actual browser MediaStream/capture/speech worker, actual local faster-whisper, parser, real cached CLAP/SLOOP and actual audio preview/accept/Undo; no typed transcripts, no LLM provider, not physical human speech or listening quality'};
}
