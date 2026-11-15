async page=>{
 const base=page.url().split('/').slice(0,3).join('/');
 await page.goto(base);
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.getByRole('button',{name:'Not now',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.getByRole('button',{name:/^Synth 1 /}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().revision>=1);
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext(),rate=context.sampleRate;
  const wait=(predicate,ms=10000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(new Error('Engine event timed out'));},ms);const off=engine.subscribe(m=>{if(predicate(m)){clearTimeout(timer);off();resolve(m);}});});
  const dispatch=operation=>engine.dispatch({id:crypto.randomUUID(),expectedRevision:engine.getSession().revision,boundary:operation.type==='record'?'next-beat':'immediate',operation});
  const snapped=wait(m=>m.type==='session'&&m.session.pitchSnap?.scale==='major');
  dispatch({type:'set-pitch-snap',settings:{root:0,scale:'major'}});await snapped;
  const started=wait(m=>m.type==='transport'&&m.transport.recording);
  dispatch({type:'record',target:{trackId:'synth-1'}});
  const {transport}=await started,when=transport.recordingStartFrame/rate+.5;
  const buffer=context.createBuffer(1,3*rate,rate),samples=buffer.getChannelData(0);
  for(let n=0;n<2*rate;n++){const t=n/rate;samples[n]=.04*Math.min(1,t/.015,(2-t)/.015)*Math.sin(2*Math.PI*277.182631*t);}
  await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);
  Object.assign(globalThis,{__previewErase:{when,wait,dispatch}});
 });
 await page.waitForFunction(()=>globalThis.__voicesynth.voice.recorder.status().live?.event.midi===61);
 const preview=page.getByRole('button',{name:/^Erase provisional C4 step /});
 await preview.waitFor({state:'visible'});
 const before=await page.evaluate(()=>globalThis.__voicesynth.voice.recorder.status().live);
 await preview.click();
 await page.waitForFunction(()=>globalThis.__voicesynth.voice.recorder.status().live===null);
 return await page.evaluate(async before=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext(),{when,wait,dispatch}=globalThis.__previewErase;
  const samples=[];
  while(context.currentTime<when+2.35){samples.push(voice.recorder.status());await new Promise(r=>setTimeout(r,20));}
  if(samples.some(s=>s.live||s.provisional.length))throw new Error('Erased held preview returned or entered pending queue');
  const closed=wait(m=>m.type==='transport'&&!m.transport.recording);
  dispatch({type:'stop-recording'});await closed;
  if(engine.getSession().tracks[0].notes.length)throw new Error('Erased live note reached the composition');
  voice.stopMicrophone();delete globalThis.__previewErase;
  return {rawMidi:before.event.midi,displayedPitch:'C4',scale:'C major',erasedStep:before.step,noResurrection:true,musicEmpty:true,evidence:'actual app UI erase + key mapping, real capture/YIN/recorder/WASM, synthetic C#4 source; no physical microphone'};
 },before);
}
