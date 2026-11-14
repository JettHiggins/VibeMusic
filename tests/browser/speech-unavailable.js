async page=>{
 const sent=[];
 page.on('websocket',socket=>socket.on('framesent',event=>{try{const m=JSON.parse(String(event.payload));if(m.type==='speech-audio')sent.push({seq:m.seq,streamId:m.streamId,clockId:m.clockId,startFrame:m.startFrame,endFrame:m.endFrame,sampleRate:m.sampleRate,bytes:m.data.length*3/4-(m.data.endsWith('==')?2:m.data.endsWith('=')?1:0)});}catch{}}));
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext();
  await voice.enableTestSignal(context.createBuffer(1,context.sampleRate*20,context.sampleRate),context.currentTime+.05);
  voice.setLatencyFrames(0);
  globalThis.__speechTestTransport=null;engine.subscribe(m=>{if(m.type==='transport')globalThis.__speechTestTransport=m.transport;});
 });
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.getByRole('checkbox',{name:'Hands-free commands (local service)'}).check();
 await page.waitForFunction(()=>globalThis.__voicesynth.voice.getState().speech.status==='unavailable');
 const state=await page.evaluate(()=>({speech:globalThis.__voicesynth.voice.getState().speech,mode:globalThis.__voicesynth.voice.getState().recorder.mode,playing:globalThis.__speechTestTransport.playing}));
 if(!sent.length||sent[0].seq!==0||sent[0].sampleRate!==44100||sent[0].bytes!==2*(sent[0].endFrame-sent[0].startFrame))throw new Error('Invalid actual socket PCM: '+JSON.stringify(sent));
 if(state.mode!=='speech'||!state.playing)throw new Error('Unavailable fell back or stopped playback: '+JSON.stringify(state));
 if(!await page.getByRole('button',{name:'● Rec Kick',exact:true}).isDisabled())throw new Error('Unavailable speech allowed Record');
 await page.getByRole('checkbox',{name:'Hands-free commands (local service)'}).uncheck();
 const manual=await page.evaluate(()=>globalThis.__voicesynth.voice.getState().recorder.mode);
 if(manual!=='manual')throw new Error('Explicit manual opt-out failed');
 return {chunks:sent.length,firstChunk:sent[0],state,manual,evidence:'synthetic silence through real browser capture/PCM worker/WebSocket and real unavailable service; not real recognition'};
}
