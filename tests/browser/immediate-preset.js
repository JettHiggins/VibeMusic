async page=>{
 const base=page.url().startsWith('http://127.0.0.1:')?page.url().split('/').slice(0,3).join('/'):'http://127.0.0.1:5173';
 await page.goto(base);
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext();
  globalThis.__eraseTransport=null;engine.subscribe(m=>{if(m.type==='transport')globalThis.__eraseTransport=m.transport;});
  const session=structuredClone(engine.getSession());
  session.selected={trackId:'synth-1'};
  session.tracks[3].hits=[{id:'remove',lane:'kick',step:4,velocity:.8},{id:'keep',lane:'kick',step:12,velocity:.8},{id:'snare',lane:'snare',step:4,velocity:.8}];
  session.tracks[0].notes=[{id:'melody',step:4,duration:4,midi:60,velocity:.8}];
  session.tracks[1].notes=[{id:'other',step:0,duration:8,midi:64,velocity:.8}];
  await new Promise((resolve,reject)=>{
   const id=crypto.randomUUID(),timer=setTimeout(()=>{off();reject(new Error('Fixture load was not acknowledged'));},3000);
   const off=engine.subscribe(m=>{if(m.type==='ack'&&m.commandId===id&&m.status!=='queued'){clearTimeout(timer);off();m.status==='applied'?resolve():reject(new Error(m.reason));}});
   engine.dispatch({id,expectedRevision:engine.getSession().revision,boundary:'next-loop',operation:{type:'load-session',session}});
  });
  await voice.enableTestSignal(context.createBuffer(1,context.sampleRate*45,context.sampleRate),context.currentTime+.05);voice.setLatencyFrames(0);
 });
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.getByRole('button',{name:'● Rec Synth 1',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__eraseTransport?.recording===true);
 const before=await page.evaluate(()=>({transport:structuredClone(globalThis.__eraseTransport),session:structuredClone(globalThis.__voicesynth.engine.getSession())}));
 const preset=before.session.tracks[0].patch.preset===1?2:1;
 const started=Date.now();
 await page.getByLabel(/^Preset/).selectOption(String(preset));
 await page.waitForFunction(p=>globalThis.__voicesynth.engine.getSession().tracks[0].patch.preset===p,preset,{timeout:1500});
 const elapsedMs=Date.now()-started;
 const after=await page.evaluate(()=>({transport:globalThis.__eraseTransport,session:globalThis.__voicesynth.engine.getSession()}));
 if(!after.transport.recording||!after.transport.playing||after.transport.recordingEpoch!==before.transport.recordingEpoch)throw new Error('Preset change interrupted capture/playback');
 for(let i=0;i<4;i++){
  const key=i===3?'hits':'notes';
  if(JSON.stringify(before.session.tracks[i][key])!==JSON.stringify(after.session.tracks[i][key]))throw new Error('Preset change disturbed music');
 }
 if(elapsedMs>1500)throw new Error('Preset still waits for the loop');
 return {immediatePresetDuringRecording:true,elapsedMs,musicPreserved:true,recordingEpochPreserved:true,evidence:'actual preset select and AudioWorklet/WASM with synthetic silence; no human hearing or acoustic timing claim'};
}
