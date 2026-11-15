async page=>{
 const base=page.url().startsWith('http://127.0.0.1:')?page.url().split('/').slice(0,3).join('/'):'http://127.0.0.1:5173';
 await page.goto(base);
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.getByRole('button',{name:'Not now',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext();
  globalThis.__eraseTransport=null;engine.subscribe(m=>{if(m.type==='transport')globalThis.__eraseTransport=m.transport;});
  const session=structuredClone(engine.getSession());
  session.selected={trackId:'drums',lane:'kick'};
  session.tracks[3].hits=[{id:'remove',lane:'kick',step:4,velocity:.8},{id:'keep',lane:'kick',step:12,velocity:.8},{id:'snare',lane:'snare',step:4,velocity:.8}];
  session.tracks[0].notes=[{id:'melody',step:4,duration:4,midi:60,velocity:.8}];
  session.tracks[1].notes=[{id:'other',step:0,duration:8,midi:64,velocity:.8}];
  await new Promise((resolve,reject)=>{
   const id=crypto.randomUUID(),timer=setTimeout(()=>{off();reject(new Error('Fixture load was not acknowledged'));},3000);
   const off=engine.subscribe(m=>{if(m.type==='ack'&&m.commandId===id&&m.status!=='queued'){clearTimeout(timer);off();m.status==='applied'?resolve():reject(new Error(m.reason));}});
   engine.dispatch({id,expectedRevision:engine.getSession().revision,boundary:'next-loop',operation:{type:'load-session',session}});
  });
  await voice.enableTestSignal(context.createBuffer(1,context.sampleRate*45,context.sampleRate),context.currentTime+.05);voice.setLatencyFrames(0);
 });
 await page.getByRole('button',{name:'Record Kick',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__eraseTransport?.recording===true);
 const epoch=await page.evaluate(()=>globalThis.__eraseTransport.recordingEpoch);
 await page.getByRole('gridcell',{name:'Erase Kick step 5',exact:true}).click();
 await page.waitForFunction(()=>!globalThis.__voicesynth.engine.getSession().tracks[3].hits.some(h=>h.id==='remove'));
 const drums=await page.evaluate(()=>({hits:globalThis.__voicesynth.engine.getSession().tracks[3].hits,transport:globalThis.__eraseTransport}));
 if(drums.hits.length!==2||!drums.hits.some(h=>h.id==='snare')||!drums.hits.some(h=>h.id==='keep')||!drums.transport.recording||drums.transport.recordingEpoch!==epoch)throw new Error('Drum mouse erase disturbed unrelated input or capture');
 await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await page.waitForFunction(()=>!globalThis.__eraseTransport?.recording);
 await page.getByRole('button',{name:/^Synth 1 /}).click();
 await page.getByRole('button',{name:'Record Synth 1',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__eraseTransport?.recording===true);
 const melody=page.getByRole('gridcell',{name:'C4 step 5 length 4',exact:true});
 await melody.click();await page.keyboard.press('Delete');
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().tracks[0].notes.length===0);
 const final=await page.evaluate(()=>({session:globalThis.__voicesynth.engine.getSession(),transport:globalThis.__eraseTransport}));
 if(final.session.tracks[1].notes[0]?.id!=='other'||final.session.tracks[3].hits.length!==2||!final.transport.recording||!final.transport.playing)throw new Error('Melody mouse erase disturbed unrelated music or transport');
 return {drumMouseErase:true,pianoRollDelete:true,otherMusicPreserved:true,playbackAndRecordingContinue:true,evidence:'real UI and AudioWorklet/WASM with seeded music and synthetic silence; not acoustic timing, foreground/background discrimination or human acceptance'};
}
