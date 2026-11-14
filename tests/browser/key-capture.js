async page => {
 const results=[];
 for(const settings of [null,{root:0,scale:'major'}])results.push(await page.evaluate(async(settings)=>{
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
   if(settings){const changed=waitFor(m=>m.type==='session'&&JSON.stringify(m.session.pitchSnap)===JSON.stringify(settings));dispatch({type:'set-pitch-snap',settings});await changed;}
   const started=waitFor(m=>m.type==='transport'&&m.transport.recording);
   dispatch({type:'record',target:{trackId:'synth-1'}});
   const state=await started;
   const context=engine.getAudioContext(),rate=context.sampleRate,start=state.transport.recordingStartFrame;
   const when=start/rate+.5;
   const buffer=context.createBuffer(1,3*rate,rate),samples=buffer.getChannelData(0);
   for(const [at,duration,midi] of [[0,.375,60],[.5,.375,61],[1,.5,68]]){
    let phase=0;
    for(let n=0;n<duration*rate;n++){
     const t=n/rate,index=Math.round(at*rate)+n;
     phase+=2*Math.PI*440*2**((midi-69+.1*Math.sin(2*Math.PI*5*t))/12)/rate;
     const envelope=Math.min(1,t/.015,(duration-t)/.015);
     for(let harmonic=1;harmonic<=4;harmonic++)samples[index]+=.15*envelope*Math.sin(harmonic*phase)/(harmonic*harmonic);
    }
   }
   await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,(when+2-context.currentTime)*1000)));
   const pending=voice.recorder.status();
   if(pending.provisional.length!==3)throw new Error('Expected three extracted notes: '+JSON.stringify(pending));
   const raw=pending.provisional.map(n=>n.event.midi);
   if(JSON.stringify(raw)!==JSON.stringify([60,61,68]))throw new Error('Capture did not retain raw detected pitches: '+JSON.stringify(raw));
   const done=waitFor(m=>m.type==='session'&&m.session.tracks[0].notes.length===3);
   dispatch({type:'stop-recording'});await done;
   const notes=engine.getSession().tracks[0].notes.map(n=>[n.step,n.duration,n.midi]).sort((a,b)=>a[0]-b[0]);
   const origin=state.transport.recordingLoopStartFrame,stepFrames=rate*60/(120*4);
   const firstStep=Math.round((start+.5*rate-origin)/stepFrames)%64;
   const pitches=settings?[60,60,67]:[60,61,68];
   const expected=[[firstStep,3,pitches[0]],[firstStep+4,3,pitches[1]],[firstStep+8,4,pitches[2]]].map(([step,duration,midi])=>[step%64,duration,midi]).sort((a,b)=>a[0]-b[0]);
   if(JSON.stringify(notes)!==JSON.stringify(expected))throw new Error('Unexpected melody: '+JSON.stringify({notes,expected}));
   if(voice.getState().message||voice.recorder.status().lastError)throw new Error(voice.getState().message||voice.recorder.status().lastError);
   return {settings,raw,notes,committed:voice.recorder.status().committed,playing:transport.playing,analysisP95Ms:voice.getState().analysisP95Ms,evidence:'synthetic sung tones through real browser capture worklet, YIN worker, recorder and SLOOP WASM; not a physical microphone or human voice'};
  }finally{off();voice.dispose();engine.dispose();}
 },settings));
 return results;
}
