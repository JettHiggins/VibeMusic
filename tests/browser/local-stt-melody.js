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
  while(!predicate()){if(performance.now()>deadline)throw new Error(label+': '+JSON.stringify({transport,state:voice.getState().speech,recorder:voice.recorder.status(),spans:server.filter(m=>m.type==='command-span'),errors}));await new Promise(r=>setTimeout(r,20));}
 };
 try{
  await engine.initialize();await agent.connect();await until('clock',()=>transport!==null);
  const context=engine.getAudioContext(),rate=context.sampleRate;
  const buffer=context.createBuffer(1,14*rate,rate),samples=buffer.getChannelData(0);
  // Use ?testStopAt=8 to exercise the short-pause singing/command exclusion regression.
  const tones=[[6,.375,60],[6.5,.375,64],[7,.5,67]],word=Number(new URL(location.href).searchParams.get('testStopAt')??10);
  for(const [at,duration,midi] of tones){
   let phase=0;
   for(let n=0;n<duration*rate;n++){
    const t=n/rate,index=Math.round(at*rate)+n;
    phase+=2*Math.PI*440*2**((midi-69+.1*Math.sin(2*Math.PI*5*t))/12)/rate;
    const envelope=Math.min(1,t/.015,(duration-t)/.015);
    for(let h=1;h<=4;h++)samples[index]+=.15*envelope*Math.sin(h*phase)/(h*h);
   }
  }
  const response=await fetch('/engine/synthetic-groove-stop.wav');
  if(!response.ok)throw new Error('Generate the synthetic espeak fixture as documented');
  const phrase=await context.decodeAudioData(await response.arrayBuffer());
  const startResponse=await fetch('/engine/synthetic-record-melody.wav');
  if(!startResponse.ok)throw new Error('Generate the synthetic Record melody fixture');
  const startPhrase=await context.decodeAudioData(await startResponse.arrayBuffer());
  samples.set(startPhrase.getChannelData(0),Math.round(.3*rate));
  samples.set(phrase.getChannelData(0),Math.round(word*rate));
  const when=context.currentTime+.3;
  await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);voice.setHandsFree(true);
  await until('real local STT availability',()=>voice.getState().speech.status==='ready');
  await until('recognized Record melody',()=>server.some(m=>m.type==='command'&&m.command.operation.type==='record'),20000);
  const record=server.find(m=>m.type==='command'&&m.command.operation.type==='record').command;
  if(record.boundary!=='next-beat'||record.operation.target.trackId!=='synth-1')throw new Error('Wrong recognized record operation');
  await until('recording',()=>transport.recording);
  const origin=transport.recordingLoopStartFrame;
  await until('recognized stop-recording',()=>server.some(m=>m.type==='command'&&m.command.operation.type==='stop-recording'),20000);
  await until('recognized stop applies on the audio thread',()=>transport.recording===false);
  await until('three committed melody notes',()=>engine.getSession().tracks[0].notes.length===3);
  const notes=engine.getSession().tracks[0].notes.map(n=>[n.step,n.duration,n.midi]).sort((a,b)=>a[0]-b[0]);
  const expected=tones.map(([at,duration,midi])=>[Math.round(((when+at)*rate-origin)/(rate/8))%64,Math.round(duration*8),midi]).sort((a,b)=>a[0]-b[0]);
  if(JSON.stringify(notes)!==JSON.stringify(expected))throw new Error('Wrong captured melody '+JSON.stringify({notes,expected}));
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
  return {notes,expected,committed:voice.recorder.status().committed,playing:transport.playing,recording:transport.recording,excludedSpeech:true,recordByRecognizedSpeech:true,order:[exclusion,command,coverage],provider,evidence:'actual browser capture/PCM/socket/gate/WASM and real faster-whisper with synthetic espeak speech and harmonic sung tones; reviewed local faster-whisper with declared speech dependencies; NOT human microphone acceptance'};
 }finally{coordinator.dispose();agent.dispose();voice.dispose();engine.dispose();}
})
