async page => {
 return await page.evaluate(async()=>{
  const {BrowserEngine}=await import('/src/engine/browser.ts');
  const {VoiceInput}=await import('/src/input/voice-input.ts');
  const engine=new BrowserEngine(),commands=[];
  const nativeDispatch=engine.dispatch.bind(engine);
  engine.dispatch=command=>{commands.push(structuredClone(command));return nativeDispatch(command);};
  const voice=new VoiceInput(engine,'manual');
  let transport=null;
  const off=engine.subscribe(m=>{if(m.type==='transport')transport=m.transport;});
  const until=async(label,predicate,timeout=12000)=>{
   const deadline=performance.now()+timeout;
   while(!predicate()){
    if(performance.now()>deadline)throw new Error(label+': '+JSON.stringify({transport,recorder:voice.recorder.status(),input:voice.getState().message}));
    await new Promise(resolve=>setTimeout(resolve,20));
   }
  };
  const dispatch=operation=>engine.dispatch(voice.prepareCommand({id:crypto.randomUUID(),expectedRevision:engine.getSession().revision,boundary:operation.type==='record'?'next-beat':'immediate',operation}));
  try{
   await engine.initialize();
   dispatch({type:'record',target:{trackId:'synth-1'}});
   await until('recording starts',()=>transport?.recording);
   const context=engine.getAudioContext(),rate=context.sampleRate,when=transport.recordingStartFrame/rate+.5;
   const buffer=context.createBuffer(1,5*rate,rate),samples=buffer.getChannelData(0);
   for(const [at,duration,midi] of [[0,2,60],[2.5,1.5,64]]){
    let phase=0;
    for(let n=0;n<duration*rate;n++){
     const t=n/rate,index=Math.round(at*rate)+n;
     phase+=2*Math.PI*440*2**((midi-69)/12)/rate;
     const envelope=Math.min(1,t/.015,(duration-t)/.015);
     for(let h=1;h<=4;h++)samples[index]+=.15*envelope*Math.sin(h*phase)/(h*h);
    }
   }
   await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);
   const at=async time=>{await new Promise(resolve=>setTimeout(resolve,Math.max(0,(time-context.currentTime)*1000)));};
   await at(when+.5);
   await until('C4 held in worker',()=>voice.getState().micCheck?.pitch?.holding===true);
   if(voice.recorder.hasPendingCapture)throw new Error('First note must still be held, not completed');
   const beforeUndo=engine.getSession().revision,firstEpoch=transport.recordingEpoch;
   dispatch({type:'undo'});
   await until('held-note Undo reset',()=>transport.recordingEpoch===firstEpoch+1);
   const undo=commands.find(c=>c.operation.type==='undo');
   if(!undo?.operation.discardCaptureOnly||engine.getSession().revision!==beforeUndo)throw new Error('Held-note Undo consumed musical history');
   if(!transport.recording||!transport.playing)throw new Error('Undo stopped capture/playback');
   await at(when+2.9);
   if(!voice.recorder.hasPendingCapture)throw new Error('Expected completed C4 input before Clear');
   dispatch({type:'clear',target:{trackId:'synth-1'}});
   await until('live Clear reset',()=>transport.recordingEpoch===firstEpoch+2);
   const epoch=transport.recordingEpoch,cutoff=transport.captureStartFrame;
   if(!transport.recording||!transport.playing)throw new Error('Clear stopped capture/playback');
   if(voice.recorder.status().provisional.length)throw new Error('Old provisional input survived Clear');
   await at(when+4.3);
   const fresh=voice.recorder.status().provisional;
   if(!fresh.length||fresh.some(p=>p.event.kind!=='note'||p.event.midi!==64||p.event.captureFrame<cutoff))throw new Error('Held pre-edit note returned: '+JSON.stringify({fresh,cutoff}));
   dispatch({type:'stop-recording'});
   await until('fresh input commits',()=>engine.getSession().tracks[0].notes.length>0);
   const notes=engine.getSession().tracks[0].notes;
   if(notes.some(n=>n.midi!==64))throw new Error('Cleared C4 returned: '+JSON.stringify(notes));
   const batches=commands.filter(c=>c.operation.type==='commit-performance');
   if(!batches.length||batches.some(c=>c.operation.recordingEpoch!==epoch||c.operation.events.some(e=>e.captureFrame<cutoff)))throw new Error('Old epoch/capture submitted after reset');
   if(voice.recorder.status().lastError||voice.getState().message)throw new Error(voice.recorder.status().lastError||voice.getState().message);
   return {notes:notes.map(n=>[n.step,n.duration,n.midi]),epoch,cutoff,undoDiscardOnly:undo.operation.discardCaptureOnly,playing:transport.playing,analysisP95Ms:voice.getState().analysisP95Ms,evidence:'synthetic sustained tones through actual capture/analysis workers, held-note Undo, live Clear, recorder and WASM; not human microphone acceptance'};
  }finally{off();voice.dispose();engine.dispose();}
 });
}
