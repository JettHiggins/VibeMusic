async page => {
 return await page.evaluate(async()=>{
  const {BrowserEngine}=await import('/src/engine/browser.ts');
  const {VoiceInput}=await import('/src/input/voice-input.ts');
  const engine=new BrowserEngine(),voice=new VoiceInput(engine,'manual');
  let transport=null;
  engine.subscribe(m=>{if(m.type==='transport')transport=m.transport;});
  const waitFor=(predicate,timeout=18000)=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{off();reject(new Error('Timed out waiting for melody state: '+JSON.stringify({transport,notes:engine.getSession().tracks[0].notes,recorder:voice.recorder.status()})));},timeout);
   const off=engine.subscribe(m=>{if(predicate(m)){clearTimeout(timer);off();resolve(m);}});
  });
  const dispatch=operation=>engine.dispatch({id:crypto.randomUUID(),expectedRevision:engine.getSession().revision,boundary:operation.type==='record'?'next-loop':'immediate',operation});
  const notes=()=>engine.getSession().tracks[0].notes.map(n=>[n.step,n.duration,n.midi]).sort((a,b)=>a[0]-b[0]);
  try{
   await engine.initialize();
   const context=engine.getAudioContext(),rate=context.sampleRate;
   const take=async(phrase,expected)=>{
    const started=waitFor(m=>m.type==='transport'&&m.transport.recording);
    dispatch({type:'record',target:{trackId:'synth-1'}});
    const {transport:t}=await started,start=t.recordingStartFrame,origin=start/rate,when=origin+0.5;
    const buffer=context.createBuffer(1,8*rate,rate),samples=buffer.getChannelData(0);
    for(const [step,duration,midi] of phrase){
     const from=Math.round((step-4)*rate/8),length=Math.round(duration*rate/8);
     let phase=0;
     for(let n=0;n<length;n++){
      const sec=n/rate,env=Math.min(1,sec/0.02,(length-n)/rate/0.02);
      const hz=440*2**((midi-69+0.3*Math.sin(2*Math.PI*5.5*sec))/12);
      phase+=2*Math.PI*hz/rate;
      for(let h=1;h<=5;h++)samples[from+n]+=0.15*env*Math.sin(h*phase)/(h*h);
     }
    }
    await voice.enableTestSignal(buffer,when);
    await new Promise(r=>setTimeout(r,Math.max(0,(origin+7.9-context.currentTime)*1000)));
    const applied=waitFor(m=>m.type==='session'&&JSON.stringify(notes())===JSON.stringify(expected),Math.max(500,(origin+8.5-context.currentTime)*1000));
    dispatch({type:'stop-recording'});
    await applied;
   };
   const melody=[60,62,64,67,65,64,62,60].map((midi,i)=>[4+i*8,2,midi]);
   await take(melody,melody);
   const corrected=melody.map(n=>n[0]===36?[36,2,69]:n);
   await take([[36,2,69]],corrected);
   const p95=voice.getState().analysisP95Ms;
   if(p95===null||p95>=50)throw new Error('Pitch analysis missed p95 target: '+p95);
   if(!transport.playing)throw new Error('Playback stopped with recording');
   return {notes:notes(),committed:voice.recorder.status().committed,p95Ms:p95,playing:transport.playing,mode:'synthetic singing through browser capture/analysis workers and real SLOOP; not acoustic input'};
  }finally{voice.dispose();engine.dispose();}
 });
}
