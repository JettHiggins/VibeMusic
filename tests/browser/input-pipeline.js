async page => {
 return await page.evaluate(async()=>{
  const {BrowserEngine}=await import('/src/engine/browser.ts');
  const {VoiceInput}=await import('/src/input/voice-input.ts');
  const engine=new BrowserEngine(),voice=new VoiceInput(engine,'manual');
  let transport=null;
  engine.subscribe(message=>{if(message.type==='transport')transport=message.transport;});
  const waitFor=(predicate,timeout=12000)=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{off();reject(new Error('Timed out waiting for pipeline state'));},timeout);
   const off=engine.subscribe(message=>{if(predicate(message)){clearTimeout(timer);off();resolve(message);}});
  });
  const dispatch=operation=>engine.dispatch({id:crypto.randomUUID(),expectedRevision:engine.getSession().revision,boundary:operation.type==='record'?'next-loop':'immediate',operation});
  try{
   await engine.initialize();
   const started=waitFor(message=>message.type==='transport'&&message.transport.recording);
   dispatch({type:'record',target:{trackId:'drums',lane:'kick'}});
   const state=await started;
   const context=engine.getAudioContext(),rate=context.sampleRate,start=state.transport.recordingStartFrame;
   const when=start/rate+0.5;
   const buffer=context.createBuffer(1,3*rate,rate),samples=buffer.getChannelData(0);
   for(const at of [0,0.5,1,2])for(let n=0;n<0.2*rate;n++){
    const t=n/rate,index=Math.round(at*rate)+n;
    samples[index]+=0.5*Math.sin(2*Math.PI*(60+100*Math.exp(-30*t))*t)*Math.exp(-14*t)*Math.min(1,t/0.002)*Math.min(1,(0.2-t)/0.05);
   }
   await voice.enableTestSignal(buffer,when);
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,(when+2.5-context.currentTime)*1000)));
   const done=waitFor(message=>message.type==='session'&&message.session.tracks[3].hits.length>=4,Math.max(500,(start/rate+8.5-context.currentTime)*1000));
   dispatch({type:'stop-recording'});
   await done;
   const steps=engine.getSession().tracks[3].hits.map(hit=>hit.step).sort((a,b)=>a-b);
   if(JSON.stringify(steps)!==JSON.stringify([4,8,12,20]))throw new Error('Unexpected steps: '+steps);
   const p95=voice.getState().analysisP95Ms;
   if(p95===null||p95>=50)throw new Error('Analysis missed p95 target: '+p95);
   return {steps,committed:voice.recorder.status().committed,p95Ms:voice.getState().analysisP95Ms,playing:transport.playing,mode:'synthetic buffer through real browser worklet/worker/recorder/WASM; not physical microphone'};
  }finally{voice.dispose();engine.dispose();}
 });
}
