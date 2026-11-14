async page => {
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const bar=page.getByRole('banner',{name:'Transport'});
 await bar.getByRole('button',{name:'Enable audio'}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext();
  await voice.enableTestSignal(context.createBuffer(1,context.sampleRate*60,context.sampleRate),context.currentTime+.05);
  voice.setLatencyFrames(0);
  globalThis.__testTransport=null;
  engine.subscribe(m=>{if(m.type==='transport')globalThis.__testTransport=m.transport;});
 });
 await page.waitForFunction(()=>globalThis.__testTransport!==null);
 const stoppedBefore=await page.evaluate(()=>globalThis.__testTransport.currentFrame);
 await bar.getByRole('button',{name:'● Rec Kick',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__testTransport?.recording,{timeout:4000});
 const start=await page.evaluate(()=>globalThis.__testTransport.recordingStartFrame);
 if(start-stoppedBefore<44100*1.9||start-stoppedBefore>44100*2.3)throw new Error('Unexpected stopped count-in '+start);
 await page.evaluate(()=>{
  const t=globalThis.__testTransport;
  globalThis.__voicesynth.voice.recorder.addOnsets([{frame:t.currentFrame-100,velocity:.8,confidence:1,levelDb:-12}],0,t.clockId,t.currentFrame);
 });
 await bar.getByRole('button',{name:'Undo',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__testTransport.recordingEpoch===2);
 const undo=await page.evaluate(()=>({revision:globalThis.__voicesynth.engine.getSession().revision,pending:globalThis.__voicesynth.voice.recorder.status().provisional.length,recording:globalThis.__testTransport.recording,playing:globalThis.__testTransport.playing}));
 if(undo.pending!==0||!undo.recording||!undo.playing)throw new Error('Undo stopped/discard failed '+JSON.stringify(undo));
 await bar.getByRole('button',{name:'Clear Kick',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__testTransport.recordingEpoch===3);
 const clear=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession().tracks[3].hits.filter(h=>h.lane==='kick').length);
 if(clear!==0)throw new Error('Clear failed');
 await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
 const bounds=await bar.boundingBox();if(!bounds||bounds.y<0)throw new Error('Transport left viewport');
 await bar.getByRole('button',{name:'Session ▾'}).click();
 await page.getByRole('dialog',{name:'Session',exact:true}).waitFor({state:'visible'});
 await page.keyboard.press('Escape');
 await bar.getByRole('button',{name:'■ Stop rec',exact:true}).click();
 await page.waitForFunction(()=>!globalThis.__testTransport.recording);
 const before=await page.evaluate(()=>globalThis.__testTransport.currentFrame);
 await bar.getByRole('button',{name:'● Rec Kick',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__testTransport.recording);
 const playingStart=await page.evaluate(()=>globalThis.__testTransport.recordingStartFrame);
 if(playingStart-before>44100*.7)throw new Error('Playback Record waited too long');
 await bar.getByRole('button',{name:'■ Stop rec',exact:true}).click();
 if(errors.length)throw new Error(errors.join('\n'));
 return {stoppedCountInFrame:start,undo,clearHits:clear,transportTop:bounds.y,nextBeatWaitFrames:playingStart-before,evidence:'real browser UI and WASM; injected provisional event, synthetic silent input; no human microphone acceptance'};
}
