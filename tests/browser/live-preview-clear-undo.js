async page=>{
 const base=page.url().split('/').slice(0,3).join('/'),results=[];
 for(const action of ['Undo','Clear Synth 1']){
  await page.goto(base);
  await page.getByRole('button',{name:'Enable audio',exact:true}).click();
  await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
  await page.getByRole('button',{name:/^Synth 1 /}).click();
  await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().revision>=1);
  await page.evaluate(async()=>{
   const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext(),rate=context.sampleRate;
   const wait=(predicate,ms=10000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(new Error('Engine event timed out'));},ms);const off=engine.subscribe(m=>{if(predicate(m)){clearTimeout(timer);off();resolve(m);}});});
   const dispatch=operation=>engine.dispatch({id:crypto.randomUUID(),expectedRevision:engine.getSession().revision,boundary:operation.type==='record'?'next-beat':'immediate',operation});
   const started=wait(m=>m.type==='transport'&&m.transport.recording);
   dispatch({type:'record',target:{trackId:'synth-1'}});
   const {transport}=await started,when=transport.recordingStartFrame/rate+.5;
   const buffer=context.createBuffer(1,3*rate,rate),samples=buffer.getChannelData(0);
   for(let n=0;n<2*rate;n++){const t=n/rate;samples[n]=.04*Math.min(1,t/.015,(2-t)/.015)*Math.sin(2*Math.PI*261.625565*t);}
   await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);
   const edit=wait(m=>m.type==='transport'&&m.transport.recordingEpoch>transport.recordingEpoch);
   Object.assign(globalThis,{__previewEdit:{when,wait,dispatch,edit}});
  });
  await page.waitForFunction(()=>!!globalThis.__voicesynth.voice.recorder.status().live);
  const before=await page.evaluate(()=>globalThis.__voicesynth.voice.recorder.status().live);
  await page.getByRole('button',{name:action,exact:true}).click();
  const cutoff=await page.evaluate(async()=>{const {transport}=await globalThis.__previewEdit.edit;return transport.captureStartFrame;});
  await page.waitForFunction(id=>{const p=globalThis.__voicesynth.voice.recorder.status().live;return p&&p.event.id!==id;},before.event.id);
  results.push(await page.evaluate(async({action,before,cutoff})=>{
   const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext(),{when,wait,dispatch}=globalThis.__previewEdit;
   const fresh=voice.recorder.status().live;
   if(fresh.event.captureFrame<cutoff||fresh.event.id===before.event.id)throw new Error('Pre-edit held preview returned');
   while(context.currentTime<when+2.35){
    const s=voice.recorder.status();
    if(s.live&&s.live.event.captureFrame<cutoff||s.provisional.some(p=>p.event.captureFrame<cutoff))throw new Error('Old capture returned after live edit');
    await new Promise(r=>setTimeout(r,20));
   }
   const pending=voice.recorder.status().provisional;
   if(pending.length!==1||pending[0].event.captureFrame<cutoff)throw new Error('Fresh post-edit singing did not survive');
   const closed=wait(m=>m.type==='transport'&&!m.transport.recording);
   dispatch({type:'stop-recording'});const final=await closed;
   voice.stopMicrophone();delete globalThis.__previewEdit;
   return {action,oldStart:before.event.captureFrame,cutoff,freshStart:fresh.event.captureFrame,playing:final.transport.playing,newCaptureSurvives:true};
  },{action,before,cutoff}));
 }
 return {results,evidence:'actual app Undo/Clear buttons during held synthetic tone, real capture/YIN/recorder/WASM; not physical singing'};
}
