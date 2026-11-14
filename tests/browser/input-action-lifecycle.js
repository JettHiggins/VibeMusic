async page=>{
 const base=page.url().startsWith('http://127.0.0.1:')?page.url().split('/').slice(0,3).join('/'):'http://127.0.0.1:5173';
 await page.goto(base);
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext();
  const buffer=context.createBuffer(1,context.sampleRate,context.sampleRate),samples=buffer.getChannelData(0);
  let seed=42;for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=(seed/4294967296-.5)*.00016;}
  // Replace only the physical source/permission boundary. Actual MediaStream capture,
  // AudioWorklets, analysis worker, measurement, router and UI remain real.
  const sources=[];
  navigator.mediaDevices.getUserMedia=async()=>{
   const source=context.createBufferSource(),destination=context.createMediaStreamDestination();
   source.buffer=buffer;source.loop=true;source.connect(destination);source.start();sources.push(source);
   return destination.stream;
  };
  await voice.enableMicrophone();
  const {BrowserActionRouter}=await import('/src/integration/browser-actions.ts');
  const messages=[],errors=[];
  let transport=null;const off=engine.subscribe(m=>{if(m.type==='transport')transport=m.transport;});
  while(!transport)await new Promise(r=>setTimeout(r,20));
  const router=new BrowserActionRouter(m=>messages.push(m),()=>true,()=>transport.clockId,e=>errors.push(String(e)));
  router.setAdapter(voice);router.connectionChanged(true);
  let n=0;
  globalThis.__inputActionTest={messages,errors,router,sources,off,revision:engine.getSession().revision,
   start:mode=>{const id='browser-input-'+(++n),s=voice.getBrowserStatus();router.handle({type:'browser-action',id,clockId:s.clockId,expectedInputRevision:s.inputRevision,operation:{type:'calibrate-input',mode}});return id;}};
 });
 try{
  const first=await page.evaluate(()=>globalThis.__inputActionTest.start('noise'));
  await page.waitForFunction(()=>globalThis.__voicesynth.voice.getState().inputActionRunning);
  if(!await page.getByRole('button',{name:'Measure silence',exact:true}).isDisabled())throw new Error('Manual calibration was not locked');
  await page.waitForFunction(id=>globalThis.__inputActionTest.messages.some(m=>m.type==='browser-action-ack'&&m.id===id&&m.status==='complete'),first,{timeout:10000});
  const floor=await page.evaluate(()=>globalThis.__voicesynth.voice.getState().calibration.noiseFloorDb);
  if(!Number.isFinite(floor)||floor>-65)throw new Error('Actual quiet-noise measurement failed: '+floor);
  if(!await page.evaluate(()=>globalThis.__voicesynth.engine.getSession().revision===globalThis.__inputActionTest.revision))throw new Error('Noise calibration changed musical revision');
  for(const mode of ['noise','timing']){
   const id=await page.evaluate(mode=>globalThis.__inputActionTest.start(mode),mode);
   await page.waitForFunction(()=>globalThis.__voicesynth.voice.getState().inputActionRunning);
   await page.getByRole('button',{name:'Play',exact:true}).click();
   await page.waitForFunction(id=>globalThis.__inputActionTest.messages.some(m=>m.type==='browser-action-ack'&&m.id===id&&m.status==='cancelled'),id);
   const kept=await page.evaluate(()=>globalThis.__voicesynth.voice.getState().calibration.noiseFloorDb);
   if(kept!==floor)throw new Error('Cancelled calibration overwrote valid settings');
   await page.getByRole('button',{name:'Stop playback',exact:true}).click();
   await page.getByRole('button',{name:'Play',exact:true}).waitFor();
   await page.waitForFunction(()=>!globalThis.__voicesynth.voice.getState().inputActionRunning);
  }
  await page.getByRole('button',{name:'Measure silence',exact:true}).click();
  await page.waitForFunction(()=>globalThis.__voicesynth.voice.getState().silenceRun?.phase==='countdown');
  await page.evaluate(()=>globalThis.__inputActionTest.router.connectionChanged(false));
  if(!await page.evaluate(()=>globalThis.__voicesynth.voice.getState().calibrating==='noise'))throw new Error('Disconnect cancelled screen-owned calibration');
  await page.evaluate(()=>globalThis.__voicesynth.voice.cancelCalibration());
  const result=await page.evaluate(()=>({messages:globalThis.__inputActionTest.messages,errors:globalThis.__inputActionTest.errors,revision:globalThis.__voicesynth.engine.getSession().revision,originalRevision:globalThis.__inputActionTest.revision}));
  if(result.errors.length)throw new Error(result.errors.join('; '));
  // Each explicit Play/Stop advances the engine revision without adding musical history.
  // Exactly these four user transport commands, and no calibration action, may change it.
  if(result.revision!==result.originalRevision+4)throw new Error('Input calibration changed musical revision');
  return {noiseFloorDb:floor,actualWorkerCalibration:true,manualControlsLocked:true,playCancelsNoiseAndTiming:true,disconnectPreservesManual:true,acks:result.messages.filter(m=>m.type==='browser-action-ack').map(m=>[m.id,m.status]),evidence:'real browser UI/router/capture/analysis and SLOOP with synthetic MediaStream at microphone boundary; not physical microphone, STT, LLM or human calibration'};
 }finally{
  await page.evaluate(()=>{const t=globalThis.__inputActionTest;t.router.dispose();t.off();t.sources.forEach(s=>s.stop());globalThis.__voicesynth.voice.cancelCalibration();globalThis.__voicesynth.voice.stopMicrophone();});
 }
}
