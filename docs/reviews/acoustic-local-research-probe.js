async page=>{
 // Generate the five __synthetic-*.wav clips with espeak-ng as documented in the WS1 handoff.
 // Real cached local Whisper/CLAP/SLOOP service on8001; no typed transcripts or model output mocks.
 await page.addInitScript(()=>{
  if(globalThis.__acousticHook)return;globalThis.__acousticHook=true;
  const Native=globalThis.WebSocket;globalThis.__acoustic={received:[],counts:{},previewAcks:[]};
  globalThis.WebSocket=class extends Native{
   constructor(url,protocols){super(String(url)==='ws://127.0.0.1:8000/ws'?'ws://127.0.0.1:8001/ws':url,protocols);this.addEventListener('message',e=>globalThis.__acoustic.received.push(JSON.parse(String(e.data))));}
   send(data){const m=JSON.parse(String(data));globalThis.__acoustic.counts[m.type]=(globalThis.__acoustic.counts[m.type]??0)+1;if(m.type==='preview-ack')globalThis.__acoustic.previewAcks.push(m);return super.send(data);}
  };
 });
 const base=page.url().split('/').slice(0,3).join('/');
 await page.goto(base);await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.getByRole('button',{name:/^Synth 1 /}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().revision>=1);
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,c=engine.getAudioContext(),out=c.createMediaStreamDestination();
  const quiet=c.createConstantSource();quiet.offset.value=0;quiet.connect(out);quiet.start();
  navigator.mediaDevices.getUserMedia=async()=>out.stream;
  globalThis.__acoustic.source=out;globalThis.__acoustic.quiet=quiet;
  // Prepare fixtures before enabling capture: decoding during a take can stall a loaded browser.
  const decoded=new Map();
  for(const file of ['instrument-request','cancel','audition','accept','undo']){
   const response=await fetch('/__synthetic-'+file+'.wav');if(!response.ok)throw new Error('Generate synthetic speech clip first: '+file);
   decoded.set('/__synthetic-'+file+'.wav',await c.decodeAudioData(await response.arrayBuffer()));
  }
  globalThis.__acoustic.speak=async file=>{
   const buffer=decoded.get(file);if(!buffer)throw new Error('Speech fixture not prepared: '+file);
   const s=c.createBufferSource();s.buffer=buffer;s.connect(out);s.start(c.currentTime+.2);
   return buffer.duration;
  };
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
 await page.waitForFunction(patch=>JSON.stringify(globalThis.__voicesynth.engine.getSession().tracks[0].patch)===JSON.stringify(patch),before.tracks[0].patch,{timeout:30000});
 const final=await page.evaluate(()=>({session:globalThis.__voicesynth.engine.getSession(),transport:globalThis.__acoustic.transport,counts:globalThis.__acoustic.counts,previewAcks:globalThis.__acoustic.previewAcks,errors:globalThis.__acoustic.received.filter(m=>m.type==='error'),contexts:globalThis.__acoustic.received.filter(m=>m.type==='research-context')}));
 if(final.counts.utterance||!final.counts['speech-audio'])throw new Error('Test bypassed actual acoustic speech transport');
 if(!final.transport.playing||JSON.stringify(final.session.tracks)!==JSON.stringify(before.tracks))throw new Error('Undo did not restore composition with playback');
 if(final.errors.length)throw new Error('Real pipeline errors: '+JSON.stringify(final.errors));
 await page.evaluate(()=>{globalThis.__voicesynth.voice.stopMicrophone();globalThis.__acoustic.quiet.stop();});
 return {firstCandidatesMs:Math.round(first.at-at),description:first.state.description,candidates:first.state.candidates.length,contexts:final.contexts,actualAudioPreview:true,acceptedExactPatch:true,undoRestoredMusic:true,playbackContinued:true,counts:final.counts,previewAcks:final.previewAcks,evidence:'espeak synthetic speech into actual browser MediaStream/capture/speech worker, actual local faster-whisper, parser, real cached CLAP/SLOOP and actual audio preview/accept/Undo; no typed transcripts, no LLM provider, not physical human speech or listening quality'};
}
