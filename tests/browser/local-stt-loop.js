async page=>await page.evaluate(async()=>{
 const {BrowserEngine}=await import('/src/engine/browser.ts');
 const {VoiceInput}=await import('/src/input/voice-input.ts');
 const {WebSocketAgent}=await import('/src/integration/agent.ts');
 const {SessionCoordinator}=await import('/src/integration/coordinator.ts');
 const engine=new BrowserEngine(),voice=new VoiceInput(engine),agent=new WebSocketAgent('ws://127.0.0.1:8767/ws');
 const coordinator=new SessionCoordinator(engine,agent,()=>agent.connected);
 const server=[],errors=[];let transport=null;
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
  const context=engine.getAudioContext(),rate=context.sampleRate;
  const buffer=context.createBuffer(1,14*rate,rate),samples=buffer.getChannelData(0);
  const hits=[6,6.5,7],word=8;
  for(const at of hits)for(let n=0;n<.2*rate;n++){
   const t=n/rate,index=Math.round(at*rate)+n;
   samples[index]+=.5*Math.sin(2*Math.PI*(60+100*Math.exp(-30*t))*t)*Math.exp(-14*t)*Math.min(1,t/.002)*Math.min(1,(.2-t)/.05);
  }
  const response=await fetch('/engine/synthetic-groove-stop.wav');
  if(!response.ok)throw new Error('Generate the synthetic espeak fixture as documented');
  const phrase=await context.decodeAudioData(await response.arrayBuffer());
  const startResponse=await fetch('/engine/synthetic-record-kick.wav');
  if(!startResponse.ok)throw new Error('Generate the synthetic Record kick fixture');
  const startPhrase=await context.decodeAudioData(await startResponse.arrayBuffer());
  samples.set(startPhrase.getChannelData(0),Math.round(.3*rate));
  samples.set(phrase.getChannelData(0),Math.round(word*rate));
  const when=context.currentTime+.3;
  await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);voice.setHandsFree(true);
  await until('real local STT availability',()=>voice.getState().speech.status==='ready');
  await until('recognized Record kick',()=>server.some(m=>m.type==='command'&&m.command.operation.type==='record'),20000);
  const record=server.find(m=>m.type==='command'&&m.command.operation.type==='record').command;
  if(record.boundary!=='next-beat'||record.operation.target.trackId!=='drums'||record.operation.target.lane!=='kick')throw new Error('Wrong recognized record operation');
  await until('recording',()=>transport.recording);
  const origin=transport.recordingLoopStartFrame;
  await until('recognized stop-recording',()=>server.some(m=>m.type==='command'&&m.command.operation.type==='stop-recording'),20000);
  await until('recognized stop applies on the audio thread',()=>transport.recording===false);
  await until('three committed hits',()=>engine.getSession().tracks[3].hits.length===3);
  const steps=engine.getSession().tracks[3].hits.map(h=>h.step).sort((a,b)=>a-b);
  const expected=hits.map(at=>Math.round(((when+at)*rate-origin)/(rate/8))%64).sort((a,b)=>a-b);
  if(JSON.stringify(steps)!==JSON.stringify(expected))throw new Error('Wrong captured steps '+JSON.stringify({steps,expected}));
  const exclusion=server.findIndex(m=>m.type==='command-span'),command=server.findIndex(m=>m.type==='command'&&m.command.operation.type==='stop-recording');
  const span=server[exclusion];
  const provider=server.find(m=>m.type==='speech-status')?.provider;
  if(!provider?.startsWith('local faster-whisper'))throw new Error('A real local faster-whisper service is required');
  // espeak appends sentence silence; evaluate measured speech against audible samples, not WAV padding.
  const audible=phrase.getChannelData(0);let firstAudible=0,lastAudible=audible.length-1;
  while(firstAudible<audible.length&&Math.abs(audible[firstAudible])<.005)firstAudible++;
  while(lastAudible>firstAudible&&Math.abs(audible[lastAudible])<.005)lastAudible--;
  if(!span||span.startFrame>(when+word)*rate+firstAudible+.1*rate||span.endFrame<(when+word)*rate+lastAudible-.1*rate)throw new Error('Recognized span does not cover audible synthetic speech');
  const coverage=server.findIndex(m=>m.type==='speech-verified'&&m.throughFrame>=span?.endFrame);
  if(exclusion<0||!(exclusion<command&&command<coverage))throw new Error('Command exclusion/stop/coverage ordering failed');
  if(transport.recording||!transport.playing||voice.recorder.status().lastError||errors.length)throw new Error('Stop/recording failure '+JSON.stringify({transport,errors,recorder:voice.recorder.status()}));
  return {steps,expected,committed:voice.recorder.status().committed,playing:transport.playing,recording:transport.recording,excludedWordHit:true,recordByRecognizedSpeech:true,order:[exclusion,command,coverage],provider,evidence:'actual browser capture/PCM/socket/gate/WASM and real faster-whisper with synthetic espeak speech/kicks; isolated unmerged PR #21 with manually added SciPy; NOT human microphone acceptance'};
 }finally{coordinator.dispose();agent.dispose();voice.dispose();engine.dispose();}
})
