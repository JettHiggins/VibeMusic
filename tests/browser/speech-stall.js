async page=>await page.evaluate(async()=>{
 const {BrowserEngine}=await import('/src/engine/browser.ts');
 const {VoiceInput}=await import('/src/input/voice-input.ts');
 const {WebSocketAgent}=await import('/src/integration/agent.ts');
 const {SessionCoordinator}=await import('/src/integration/coordinator.ts');
 const engine=new BrowserEngine(),voice=new VoiceInput(engine),agent=new WebSocketAgent('ws://127.0.0.1:8766/ws');
 const coordinator=new SessionCoordinator(engine,agent,()=>agent.connected);
 const server=[],errors=[];let transport=null,sawBacklog=false;
 voice.onChange=state=>{if(state.speech.message?.includes('verification pending'))sawBacklog=true;};
 voice.configureSpeechSender(m=>agent.send(m),()=>agent.disconnect(),()=>agent.connect());coordinator.prepareCommand=c=>voice.prepareCommand(c);
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
  const response=await fetch('http://127.0.0.1:8766/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stall_verification:true})});
  if(!response.ok)throw new Error('Start the explicit SCRIPTED test server');
  await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);voice.setHandsFree(true);
  await until('scripted availability',()=>voice.getState().speech.status==='ready');
  engine.dispatch({id:'scripted-record',expectedRevision:engine.getSession().revision,boundary:'next-beat',operation:{type:'record',target:{trackId:'drums',lane:'kick'}}});
  await until('recording',()=>transport.recording);
  await until('stalled verification becomes unavailable',()=>voice.getState().speech.status==='unavailable',14000);
  await until('stalled take stops on audio thread',()=>!transport.recording);
  const state=voice.getState();
  if(agent.connected)throw new Error('Stalled connection can still deliver old commands');
  if(!state.speech.message?.includes('stalled')||state.recorder.mode!=='speech'||!transport.playing)throw new Error('Stall did not fail closed: '+JSON.stringify({speech:state.speech,recorder:state.recorder,transport}));
  if(engine.getSession().tracks[3].hits.length!==0||voice.recorder.status().provisional.length)throw new Error('Unverified input committed or survived stall');
  if(!sawBacklog)throw new Error('No recognition backlog feedback was shown');
  const oldStream=server.find(m=>m.type==='speech-status').streamId;
  await fetch('http://127.0.0.1:8766/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({startFrame:900000000,endFrame:900000001})});
  await voice.enableHandsFree();await until('explicit retry reconnects and detects a fresh stream',()=>voice.getState().speech.status==='ready');
  const statuses=server.filter(m=>m.type==='speech-status');
  if(!agent.connected||statuses.at(-1).streamId===oldStream||transport.recording||engine.getSession().tracks[3].hits.length)throw new Error('Retry replayed input or resumed old take');
  return {failedConnectionClosed:true,sawBacklog,retryConnected:agent.connected,freshStream:statuses.at(-1).streamId!==oldStream,speech:voice.getState().speech,playing:transport.playing,recording:transport.recording,hits:0,evidence:'SCRIPTED connected producer never verifies; actual browser PCM/socket/recorder/WASM; not real speech'};

 }finally{coordinator.dispose();agent.dispose();voice.dispose();engine.dispose();}
})
