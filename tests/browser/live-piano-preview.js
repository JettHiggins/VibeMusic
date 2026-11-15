async page=>{
 const base=page.url().split('/').slice(0,3).join('/');
 await page.goto(base);
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.getByRole('button',{name:'Not now',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.getByRole('button',{name:/^Synth 1 /}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().revision>=1);
 return await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext(),rate=context.sampleRate;
  const dispatch=operation=>engine.dispatch({id:crypto.randomUUID(),expectedRevision:engine.getSession().revision,boundary:operation.type==='record'?'next-beat':'immediate',operation});
  const started=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(new Error('Recording failed to start'));},10000);const off=engine.subscribe(m=>{if(m.type==='transport'&&m.transport.recording){clearTimeout(timer);off();resolve(m.transport);}else if(m.type==='ack'&&m.status==='rejected'){clearTimeout(timer);off();reject(new Error(m.reason));}});});
  dispatch({type:'record',target:{trackId:'synth-1'}});
  const transport=await started,when=transport.recordingStartFrame/rate+.5;
  const buffer=context.createBuffer(1,3*rate,rate),samples=buffer.getChannelData(0);
  for(let n=0;n<2*rate;n++){
   const t=n/rate,envelope=Math.min(1,t/.015,(2-t)/.015);
   samples[n]=.04*envelope*Math.sin(2*Math.PI*261.625565*t);
  }
  await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);
  const frames=[];
  while(context.currentTime<when+2.35){
   const status=voice.recorder.status(),live=status.live;
   const roll=document.querySelector('[aria-label="Synth 1 notes"]');
   const buttons=[...(roll?.querySelectorAll('button[aria-label^="Erase provisional"]')??[])];
   frames.push({t:context.currentTime-when,live:live?{duration:live.duration,midi:live.event.midi}:null,pending:status.provisional.length,committed:engine.getSession().tracks[0].notes.length,width:buttons.reduce((n,b)=>n+b.getBoundingClientRect().width,0)});
   await new Promise(r=>setTimeout(r,16));
  }
  const first=frames.find(f=>f.width>0&&f.live),early=frames.find(f=>f.t>.2&&f.t<.7&&f.live&&f.width>0),late=frames.find(f=>f.t>1.5&&f.t<1.9&&f.live&&f.width>0);
  if(!first||first.t>.3||!early||!late||late.width<=early.width||late.live.duration<=early.live.duration)throw new Error('No immediate growing DOM preview: '+JSON.stringify({first,early,late}));
  if(frames.some(f=>f.t<1.9&&(f.pending||f.committed)))throw new Error('Unfinished held audio was queued or committed');
  const status=voice.recorder.status();
  if(status.live||status.provisional.length!==1)throw new Error('Release did not replace live preview with one final provisional note: '+JSON.stringify(status));
  dispatch({type:'stop-recording'});
  const until=performance.now()+10000;
  while(engine.getSession().tracks[0].notes.length!==1&&performance.now()<until)await new Promise(r=>setTimeout(r,30));
  const notes=engine.getSession().tracks[0].notes;
  if(notes.length!==1||notes[0].duration!==16)throw new Error('Final full-bar note failed: '+JSON.stringify(notes));
  const result={firstVisibleMs:Math.round(first.t*1000),early,late,notes:notes.map(n=>[n.step,n.duration,n.midi]),analysisP95Ms:voice.getState().analysisP95Ms,evidence:'actual app DOM, test signal through capture worklet/YIN worker/VoiceInput/recorder/SLOOP; no physical microphone, no live synth monitoring'};
  voice.stopMicrophone();return result;
 });
}
