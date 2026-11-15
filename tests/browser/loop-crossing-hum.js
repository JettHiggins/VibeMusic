async page => {
 const results=[];
 for(const trackIndex of [0,1,2])results.push(await page.evaluate(async(trackIndex)=>{
  const target=`synth-${trackIndex+1}`;
  const {BrowserEngine}=await import('/src/engine/browser.ts');
  const {VoiceInput}=await import('/src/input/voice-input.ts');
  const engine=new BrowserEngine(),voice=new VoiceInput(engine,'manual');
  let transport=null;
  const off=engine.subscribe(m=>{if(m.type==='transport')transport=m.transport;});
  const waitFor=(predicate,timeout=16000)=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{unsubscribe();reject(new Error('Timed out waiting for melody pipeline'));},timeout);
   const unsubscribe=engine.subscribe(m=>{if(predicate(m)){clearTimeout(timer);unsubscribe();resolve(m);}});
  });
  const dispatch=operation=>engine.dispatch({id:crypto.randomUUID(),expectedRevision:engine.getSession().revision,boundary:operation.type==='record'?'next-beat':'immediate',operation});
  try{
   await engine.initialize();
   const started=waitFor(m=>m.type==='transport'&&m.transport.recording);
   dispatch({type:'record',target:{trackId:target}});
   const state=await started;
   const context=engine.getAudioContext(),rate=context.sampleRate,start=state.transport.recordingStartFrame;
   const origin=state.transport.recordingLoopStartFrame;
   const when=origin/rate+7.5;
   const buffer=context.createBuffer(1,3*rate,rate),samples=buffer.getChannelData(0);
   for(const [at,duration,midi] of [[0,2,60]]){
    let phase=0;
    for(let n=0;n<duration*rate;n++){
     const t=n/rate,index=Math.round(at*rate)+n;
     phase+=2*Math.PI*440*2**((midi-69+.1*Math.sin(2*Math.PI*5*t))/12)/rate;
     const envelope=Math.min(1,t/.015,(duration-t)/.015);
     for(let harmonic=1;harmonic<=4;harmonic++)samples[index]+=.025*envelope*10**((-6+6*Math.cos(2*Math.PI*t*1.5))/20)*Math.sin(harmonic*phase)/(harmonic*harmonic);
    }
   }
   await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,(when+2.4-context.currentTime)*1000)));
   const pending=voice.recorder.status();
   if(pending.provisional.length!==1)throw new Error('Expected one full-bar extracted hum: '+JSON.stringify(pending));
   const done=waitFor(m=>m.type==='session'&&m.session.tracks[trackIndex].notes.length===1);
   dispatch({type:'stop-recording'});await done;
   const notes=engine.getSession().tracks[trackIndex].notes.map(n=>[n.step,n.duration,n.midi]).sort((a,b)=>a[0]-b[0]);
   const stepFrames=rate*60/(120*4);
   const firstStep=Math.round((when*rate-origin)/stepFrames)%64;
   const expected=[[firstStep,16,60]].map(([step,duration,midi])=>[step%64,duration,midi]).sort((a,b)=>a[0]-b[0]);
   if(JSON.stringify(notes)!==JSON.stringify(expected))throw new Error('Unexpected melody: '+JSON.stringify({notes,expected}));
   if(voice.getState().message||voice.recorder.status().lastError)throw new Error(voice.getState().message||voice.recorder.status().lastError);
   return {target,loopCrossingHum:true,notes,committed:voice.recorder.status().committed,playing:transport.playing,analysisP95Ms:voice.getState().analysisP95Ms,evidence:'synthetic sung tones through real browser capture worklet, YIN worker, recorder and SLOOP WASM; not a physical microphone or human voice'};
  }finally{off();voice.dispose();engine.dispose();}
 },trackIndex));
 return results;
}
