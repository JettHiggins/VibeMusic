async page=>await page.evaluate(async()=>{
 const {BrowserEngine}=await import('/src/engine/browser.ts');
 const {VoiceInput}=await import('/src/input/voice-input.ts');
 const {WebSocketAgent}=await import('/src/integration/agent.ts');
 const {SessionCoordinator}=await import('/src/integration/coordinator.ts');
 const engine=new BrowserEngine(),voice=new VoiceInput(engine),agent=new WebSocketAgent('ws://127.0.0.1:8766/ws');
 const coordinator=new SessionCoordinator(engine,agent,()=>agent.connected);
 const server=[],errors=[];let transport=null;
 voice.configureSpeechSender(m=>agent.send(m));coordinator.prepareCommand=c=>voice.prepareCommand(c);
 agent.onStatus=c=>{coordinator.connectionChanged(c);voice.setSpeechAvailable(c);};
 coordinator.onMessage=m=>{server.push(m);voice.handleServerMessage(m);if(m.type==='error')errors.push(m.message);};
 agent.onError=e=>errors.push(e.message);engine.onError=e=>errors.push(e.message);
 engine.subscribe(m=>{if(m.type==='transport')transport=m.transport;});
 const until=async(label,predicate,timeout=14000)=>{
  const deadline=performance.now()+timeout;
  while(!predicate()){if(performance.now()>deadline)throw new Error(label+': '+JSON.stringify({transport,state:voice.getState().speech,recorder:voice.recorder.status(),errors}));await new Promise(r=>setTimeout(r,20));}
 };
 try{
  await engine.initialize();await agent.connect();await until('clock',()=>transport!==null);
  const context=engine.getAudioContext(),rate=context.sampleRate,when=context.currentTime+.15;
  const buffer=context.createBuffer(1,10*rate,rate),samples=buffer.getChannelData(0);
  const hits=[3,3.5,4,5],word=6;
  for(const at of [...hits,word])for(let n=0;n<.2*rate;n++){
   const t=n/rate,index=Math.round(at*rate)+n;
   samples[index]+=.5*Math.sin(2*Math.PI*(60+100*Math.exp(-30*t))*t)*Math.exp(-14*t)*Math.min(1,t/.002)*Math.min(1,(.2-t)/.05);
  }
  const span={startFrame:Math.floor((when+word-.05)*rate),endFrame:Math.ceil((when+word+.3)*rate)};
  const response=await fetch('http://127.0.0.1:8766/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(span)});
  if(!response.ok)throw new Error('Start the explicit SCRIPTED test server on port 8766');
  await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);voice.setHandsFree(true);
  await until('scripted availability',()=>voice.getState().speech.status==='ready');
  engine.dispatch({id:'scripted-record',expectedRevision:engine.getSession().revision,boundary:'next-beat',operation:{type:'record',target:{trackId:'drums',lane:'kick'}}});
  await until('recording',()=>transport.recording);
  const origin=transport.recordingLoopStartFrame;
  await until('scripted stop-recording',()=>server.some(m=>m.type==='command'&&m.command.id==='SCRIPTED-stop:cmd'));
  await until('four committed hits',()=>engine.getSession().tracks[3].hits.length===4);
  const steps=engine.getSession().tracks[3].hits.map(h=>h.step).sort((a,b)=>a-b);
  const expected=hits.map(at=>Math.round(((when+at)*rate-origin)/(rate/8))%64).sort((a,b)=>a-b);
  if(JSON.stringify(steps)!==JSON.stringify(expected))throw new Error('Wrong captured steps '+JSON.stringify({steps,expected}));
  const exclusion=server.findIndex(m=>m.type==='command-span'),command=server.findIndex(m=>m.type==='command'&&m.command.id==='SCRIPTED-stop:cmd');
  const coverage=server.findIndex(m=>m.type==='speech-verified'&&m.throughFrame>=span.endFrame);
  if(exclusion<0||!(exclusion<command&&command<coverage))throw new Error('Command exclusion/stop/coverage ordering failed');
  if(transport.recording||!transport.playing||voice.recorder.status().lastError||errors.length)throw new Error('Stop/recording failure '+JSON.stringify({transport,errors,recorder:voice.recorder.status()}));
  return {steps,expected,committed:voice.recorder.status().committed,playing:transport.playing,recording:transport.recording,excludedWordHit:true,order:[exclusion,command,coverage],evidence:'actual browser capture/PCM worker/socket/gate/WASM with synthetic kicks and explicit SCRIPTED server spans/stop/coverage; NOT speech recognition or physical microphone acceptance'};
 }finally{coordinator.dispose();agent.dispose();voice.dispose();engine.dispose();}
})
