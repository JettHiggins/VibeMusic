async page=>{
 const base=page.url().startsWith('http://127.0.0.1:')?page.url().split('/').slice(0,3).join('/'):'http://127.0.0.1:5173';
 await page.goto(base);
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext();
  globalThis.__eraseTransport=null;engine.subscribe(m=>{if(m.type==='transport')globalThis.__eraseTransport=m.transport;});
  const session=structuredClone(engine.getSession());
  session.selected={trackId:'synth-1'};
  session.tracks[3].hits=[{id:'remove',lane:'kick',step:4,velocity:.8},{id:'keep',lane:'kick',step:12,velocity:.8},{id:'snare',lane:'snare',step:4,velocity:.8}];
  session.tracks[0].notes=[{id:'melody',step:4,duration:4,midi:68,velocity:.8}];
  session.tracks[1].notes=[{id:'other',step:0,duration:8,midi:64,velocity:.8}];
  await new Promise((resolve,reject)=>{
   const id=crypto.randomUUID(),timer=setTimeout(()=>{off();reject(new Error('Fixture load was not acknowledged'));},3000);
   const off=engine.subscribe(m=>{if(m.type==='ack'&&m.commandId===id&&m.status!=='queued'){clearTimeout(timer);off();m.status==='applied'?resolve():reject(new Error(m.reason));}});
   engine.dispatch({id,expectedRevision:engine.getSession().revision,boundary:'next-loop',operation:{type:'load-session',session}});
  });
  await voice.enableTestSignal(context.createBuffer(1,context.sampleRate*45,context.sampleRate),context.currentTime+.05);voice.setLatencyFrames(0);
 });
 const before=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession().tracks.map(t=>t.notes??t.hits));
 await page.getByRole('combobox',{name:'Key root',exact:true}).selectOption('0');
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().pitchSnap?.root===0);
 const selected=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession());
 if(JSON.stringify(selected.tracks.map(t=>t.notes??t.hits))!==JSON.stringify(before))throw new Error('Choosing key changed existing music');
 await page.getByRole('button',{name:'Snap existing notes',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().tracks[0].notes[0]?.midi===67);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().tracks[0].notes[0]?.midi===68);
 await page.getByRole('combobox',{name:'Key root',exact:true}).selectOption('off');
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().pitchSnap===null);
 if(!await page.getByRole('button',{name:'Snap existing notes',exact:true}).isDisabled())throw new Error('Snap remains enabled with key Off');
 const final=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession());
 if(JSON.stringify(final.tracks.map(t=>t.notes??t.hits))!==JSON.stringify(before))throw new Error('Snap/Undo disturbed music');
 return {visibleKeyControls:true,settingPreservesMusic:true,existingSnapUndo:true,offDisablesSnap:true,evidence:'actual browser controls and SLOOP; seeded music and synthetic silence, no physical microphone'};
}
