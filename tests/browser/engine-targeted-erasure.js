async page=>{
 await page.goto('http://127.0.0.1:5174');
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.getByRole('button',{name:'Not now',exact:true}).click();
 return await page.evaluate(async()=>{
  const {BrowserEngine}=await import('/src/engine/browser.ts');
  const initial=structuredClone(globalThis.__voicesynth.engine.getSession());
  initial.revision=0;for(const t of initial.tracks){t.notes=[];t.hits=[];}
  initial.tracks[0].notes=[{id:'erase-note',step:0,duration:8,midi:60,velocity:.8}];
  initial.tracks[1].notes=[{id:'other-track',step:0,duration:16,midi:64,velocity:.8}];
  initial.tracks[3].hits=[{id:'keep-kick',step:0,lane:'kick',velocity:.8},{id:'keep-snare',step:0,lane:'snare',velocity:.8}];
  const engine=new BrowserEngine(initial),acks=new Map(),errors=[];let transport=null;
  engine.onError=e=>errors.push(e.message);
  const off=engine.subscribe(m=>{if(m.type==='transport')transport=m.transport;if(m.type==='ack')acks.set(m.commandId,m);});
  const until=async(label,predicate,timeout=16000)=>{const end=performance.now()+timeout;while(!predicate()){if(performance.now()>end)throw new Error(label+': '+JSON.stringify({transport,session:engine.getSession(),errors,acks:[...acks.values()]}));await new Promise(r=>setTimeout(r,20));}};
  const send=async(operation,boundary='immediate',status='applied')=>{
   const id=crypto.randomUUID();engine.dispatch({id,expectedRevision:engine.getSession().revision,boundary,operation});
   await until('engine ack',()=>acks.get(id)?.status===status||acks.get(id)?.status==='rejected');
   if(acks.get(id)?.status==='rejected')throw new Error(JSON.stringify(acks.get(id)));
   if(status==='applied')await until('authoritative session',()=>engine.getSession().revision>=acks.get(id).revision);
   return id;
  };
  try{
   await engine.initialize();await until('clock',()=>transport!==null);await send({type:'play',playing:true});
   const target={trackId:'drums',lane:'kick'};await send({type:'record',target},'next-beat','queued');
   await until('recording',()=>transport.recording);
   const epoch=transport.recordingEpoch,origin=transport.recordingLoopStartFrame,rate=transport.sampleRate,unit=rate/8;
   const first=transport.currentFrame+256,second=Math.round(first+unit);
   await until('captured source frames received',()=>transport.currentFrame>second);
   const events=[first,second].map((captureFrame,i)=>({kind:'onset',id:i?'survivor':'removed',target,captureFrame,clockId:transport.clockId,confidence:1,velocity:.9}));
   const queued=await send({type:'commit-performance',events,excludedSpans:[],verifiedThroughFrame:transport.currentFrame,recordingEpoch:epoch},'next-loop','queued');
   const step=((Math.round((first-origin)/unit)%64)+64)%64;
   await send({type:'erase-event',target,step});
   await until('capture fence',()=>transport.captureErasure?.step===step);
   if(transport.recordingEpoch!==epoch)throw new Error('Erase reset unrelated capture');
   await until('surviving queued capture applies',()=>engine.getSession().tracks[3].hits.some(h=>h.id==='survivor'));
   if(acks.get(queued)?.status!=='applied')throw new Error('Survivor was not applied under its original command ID');
   if(engine.getSession().tracks[3].hits.some(h=>h.id==='removed'))throw new Error('Erased queued input returned');
   await send({type:'erase-event',target:{trackId:'synth-1'},step:1});
   const state=engine.getSession();
   if(state.tracks[0].notes.length||state.tracks[1].notes[0]?.id!=='other-track')throw new Error('Melody erasure changed unrelated track');
   if(!state.tracks[3].hits.some(h=>h.id==='keep-snare')||!transport.playing||!transport.recording||errors.length)throw new Error('Capture/playback preservation failed');
   return {survivorCommandIdPreserved:true,erasedQueuedHitAbsent:true,epochPreserved:true,wholeMelodicNoteRemoved:true,otherTrackPreserved:true,playing:transport.playing,recording:transport.recording,evidence:'real browser AudioWorklet/WASM with directly submitted synthetic performance events; NOT microphone, speech verification, UI eraser or human acceptance'};
  }finally{off();engine.dispose();}
 });
}
