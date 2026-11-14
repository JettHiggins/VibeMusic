async page=>{
 // Actual service/CLAP/SLOOP on port 8001. Only the socket destination is redirected;
 // no response, candidate, preview audio, model output or engine operation is mocked.
 await page.addInitScript(()=>{
  const NativeSocket=globalThis.WebSocket;
  globalThis.__livePreviewAcks=[];
  globalThis.WebSocket=class extends NativeSocket{
   constructor(url,protocols){super(String(url)==='ws://127.0.0.1:8000/ws'?'ws://127.0.0.1:8001/ws':url,protocols);}
   send(data){try{const m=JSON.parse(String(data));if(m.type==='preview-ack')globalThis.__livePreviewAcks.push(m);}catch{}return super.send(data);}
  };
 });
 await page.goto('http://127.0.0.1:5174');
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth?.engine.metadata!==null);
 await page.evaluate(async()=>{
  const engine=globalThis.__voicesynth.engine,session=engine.getSession();session.selected={trackId:'synth-1'};
  session.tracks[0].notes=[{id:'live-c',step:0,duration:2,midi:60,velocity:.8},{id:'live-e',step:8,duration:2,midi:64,velocity:.8},{id:'live-g',step:16,duration:4,midi:67,velocity:.8}];
  await new Promise((resolve,reject)=>{
   const id=crypto.randomUUID(),timer=setTimeout(()=>{off();reject(new Error('Initial live test session was not loaded'));},5000);
   const off=engine.subscribe(m=>{if(m.type==='ack'&&m.commandId===id&&m.status!=='queued'){clearTimeout(timer);off();m.status==='applied'?resolve():reject(new Error(m.reason));}});
   engine.dispatch({id,expectedRevision:engine.getSession().revision,boundary:'next-loop',operation:{type:'load-session',session}});
  });
  globalThis.__liveResearchTransport=null;engine.subscribe(m=>{if(m.type==='transport')globalThis.__liveResearchTransport=m.transport;});
 });
 await page.locator('summary').filter({hasText:/^Agent$/}).click();
 await page.getByRole('button',{name:'Connect agent',exact:true}).click();
 await page.getByText('Agent connected',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__liveResearchTransport?.playing===true);
 const before=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession());
 const text=async value=>page.evaluate(t=>globalThis.__voicesynth.coordinator.submitTranscript(t),value);
 const started=await page.evaluate(()=>performance.now());await text('I want an 80s electric piano');
 await page.waitForFunction(()=>globalThis.__voicesynth.research.getSnapshot().candidates.length>0,{},{timeout:180000});
 const first=await page.evaluate(()=>({state:globalThis.__voicesynth.research.getSnapshot(),at:performance.now()}));
 if(!first.state.candidates.every(c=>c.provenance.includes('LAION CLAP')&&c.provenance.includes('SLOOP WASM')))throw new Error('Live candidates are not from the real configured model/renderer');
 await text('audition candidate two');
 await page.waitForFunction(()=>globalThis.__voicesynth.research.getSnapshot().preview?.status==='ended',{},{timeout:30000});
 const afterPreview=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession());
 if(JSON.stringify(afterPreview)!==JSON.stringify(before))throw new Error('Real preview changed the musical session');
 await text('make it warmer');
 await page.waitForFunction(old=>{const s=globalThis.__voicesynth.research.getSnapshot();return s.jobId!==old&&s.candidates.length>0&&s.progress>.2;},first.state.jobId,{timeout:180000});
 await text('cancel');
 await page.waitForFunction(()=>globalThis.__voicesynth.research.getSnapshot().status==='cancelled',{},{timeout:30000});
 const refined=await page.evaluate(()=>globalThis.__voicesynth.research.getSnapshot());
 if(!refined.description.includes('warmer')||!refined.candidates.length)throw new Error('Refined real candidates were not retained after stopping optimization');
 await text('audition candidate one');
 await page.waitForFunction(()=>globalThis.__voicesynth.research.getSnapshot().preview?.status==='ended',{},{timeout:30000});
 const chosen=refined.candidates[0].patch;
 await text('use candidate one');
 await page.waitForFunction(patch=>{const {engine,research}=globalThis.__voicesynth;return research.getSnapshot().acceptance?.status==='applied'&&JSON.stringify(engine.getSession().tracks[0].patch)===JSON.stringify(patch);},chosen,{timeout:15000});
 const accepted=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession());
 if(JSON.stringify(accepted.tracks.map(t=>t.notes))!==JSON.stringify(before.tracks.map(t=>t.notes)))throw new Error('Accepting a real candidate changed notes');
 await text('undo');
 await page.waitForFunction(patch=>JSON.stringify(globalThis.__voicesynth.engine.getSession().tracks[0].patch)===JSON.stringify(patch),before.tracks[0].patch,{timeout:5000});
 const final=await page.evaluate(()=>({session:globalThis.__voicesynth.engine.getSession(),transport:globalThis.__liveResearchTransport,acks:globalThis.__livePreviewAcks}));
 if(!final.transport.playing||JSON.stringify(final.session.tracks)!==JSON.stringify(before.tracks))throw new Error('Undo did not restore music while playback continued');
 if(final.acks.filter(a=>a.status==='started').length<2||final.acks.filter(a=>a.status==='ended').length<2)throw new Error('Actual preview lifecycle was not acknowledged');
 return {firstCandidatesMs:Math.round(first.at-started),realCandidates:first.state.candidates.length,refinementProducedCandidates:true,actualAudioPreviews:2,acceptedExactPatch:true,undoRestoredMusic:true,playbackContinued:true,evidence:'actual browser Audio/AudioWorklet/WASM, Python service and cached real CLAP music weights; typed transcripts, NOT acoustic STT/LLM/human hearing or sound-quality acceptance'};
}
