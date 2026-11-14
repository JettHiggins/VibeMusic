async page=>{
 await page.goto('http://127.0.0.1:5173');
 const initial=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession());
 if(initial.tracks.some(t=>t.notes.length||t.hits.length))throw new Error('Fresh launch seeded a song');
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext();
  globalThis.__recordTransport=null;globalThis.__recordOff=engine.subscribe(m=>{if(m.type==='transport')globalThis.__recordTransport=m.transport;});
  await voice.enableTestSignal(context.createBuffer(1,context.sampleRate*30,context.sampleRate),context.currentTime+.05);voice.setLatencyFrames(0);
 });
 await page.getByRole('button',{name:'● Rec Kick',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__recordTransport?.recordingState==='armed');
 const deadline=await page.evaluate(()=>globalThis.__recordTransport.armedStartFrame);
 await page.waitForFunction(()=>globalThis.__recordTransport?.recording===true,{},{timeout:5000});
 const first=await page.evaluate(()=>({...globalThis.__recordTransport}));
 if(first.recordingStartFrame!==deadline)throw new Error('Recording did not start at its displayed clock deadline');
 if(first.armedStartFrame!==undefined||first.countInBeatsRemaining!==undefined)throw new Error('Count-in feedback remained after activation');
 await page.getByRole('button',{name:'■ Stop rec',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__recordTransport?.recording===false);
 await page.getByRole('button',{name:'Stop playback',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__recordTransport?.playing===false);
 await page.getByRole('button',{name:'● Rec Kick',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__recordTransport?.recording===true,{},{timeout:5000});
 const restarted=await page.evaluate(()=>({...globalThis.__recordTransport}));
 if(!restarted.metronomeEnabled)throw new Error('Playback/recording metronome did not default on');
 const revision=await page.evaluate(()=>{const engine=globalThis.__voicesynth.engine,revision=engine.getSession().revision;engine.dispatch({id:crypto.randomUUID(),expectedRevision:revision,boundary:'immediate',operation:{type:'metronome',enabled:false}});return revision;});
 await page.waitForFunction(()=>globalThis.__recordTransport?.metronomeEnabled===false);
 if(await page.evaluate(()=>globalThis.__voicesynth.engine.getSession().revision)!==revision)throw new Error('Metronome toggle changed musical revision');
 const data=await page.evaluate(()=>{globalThis.__recordOff();return {session:globalThis.__voicesynth.engine.getSession(),sampleRate:globalThis.__voicesynth.engine.getAudioContext().sampleRate};});
 if(data.session.tracks.some(t=>t.notes.length||t.hits.length))throw new Error('Silent test capture added musical events');
 return {emptyStartup:true,engineMetronomeMute:true,firstStart:first.recordingStartFrame,restartStart:restarted.recordingStartFrame,playing:restarted.playing,recording:restarted.recording,sampleRate:data.sampleRate,evidence:'actual UI and WASM worklet with synthetic silence, fresh Record without Play and stopped restart; not a physical microphone or human acceptance'};
}
