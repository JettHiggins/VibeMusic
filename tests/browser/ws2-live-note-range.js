async page=>{
 // Low/high live notes stay visible in the piano roll: following by octaves, edge markers for notes out
 // of view, and manual Oct navigation is not overridden. Test signal through the real capture/YIN/recorder.
 const base=page.url().split('/').slice(0,3).join('/');
 await page.goto(base);
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.getByRole('button',{name:/^Synth 1 /}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().revision>=1);
 const run=(tones,manual)=>page.evaluate(async([tones,manual])=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext(),rate=context.sampleRate;
  const dispatch=operation=>engine.dispatch({id:crypto.randomUUID(),expectedRevision:engine.getSession().revision,boundary:operation.type==='record'?'next-beat':'immediate',operation});
  const started=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(new Error('Recording failed to start'));},10000);const off=engine.subscribe(m=>{if(m.type==='transport'&&m.transport.recording){clearTimeout(timer);off();resolve(m.transport);}else if(m.type==='ack'&&m.status==='rejected'){clearTimeout(timer);off();reject(new Error(m.reason));}});});
  dispatch({type:'record',target:{trackId:'synth-1'}});
  const when=(await started).recordingStartFrame/rate+.3,total=tones.reduce((n,t)=>n+t.dur+.3,0)+.3;
  const buffer=context.createBuffer(1,Math.ceil(total*rate),rate),x=buffer.getChannelData(0);
  let at=0;for(const t of tones){const f=440*2**((t.midi-69)/12);for(let n=0;n<t.dur*rate;n++){const s=n/rate;x[Math.floor(at*rate)+n]=.05*Math.min(1,s/.015,(t.dur-s)/.015)*Math.sin(2*Math.PI*f*s);}t.start=at;at+=t.dur+.3;}
  await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);
  const frames=[];let pressed=false;
  while(context.currentTime<when+total){
   const t=context.currentTime-when,grid=document.querySelector('[aria-label="Synth 1 notes"]'),g=grid.getBoundingClientRect();
   if(manual&&!pressed&&t>manual.at){pressed=true;document.querySelector(`[aria-label="${manual.button}"]`).click();}
   frames.push({t,range:document.querySelector('[aria-label="Visible range"]').textContent,
    live:[...grid.querySelectorAll('button[data-live="live"]')].map(b=>{const r=b.getBoundingClientRect();return{label:b.getAttribute('aria-label'),inside:r.width>0&&r.top>=g.top-1&&r.bottom<=g.bottom+1};}),
    edges:[...grid.querySelectorAll('button[data-edge]')].map(b=>b.getAttribute('aria-label'))});
   await new Promise(r=>setTimeout(r,40));
  }
  dispatch({type:'stop-recording'});
  await new Promise(r=>setTimeout(r,2500));
  return {tones,frames};
 },[tones,manual]);
 // 1) G2 then C6 from the default C3–C5 view: each live note is drawn inside the grid while held.
 const first=await run([{midi:43,dur:1.2},{midi:84,dur:1.2}]);
 for(const tone of first.tones){
  const held=first.frames.filter(f=>f.t>tone.start+.3&&f.t<tone.start+tone.dur-.1);
  const name=tone.midi===43?'G2':'C6';
  if(!held.length||!held.every(f=>f.live.some(l=>l.label.includes(` ${name} `)&&l.inside)))throw new Error(`${name} live note not visible: `+JSON.stringify(held.slice(0,3)));
 }
 const last=first.frames[first.frames.length-1];
 if(!last.edges.some(e=>e.startsWith('Show G2')))throw new Error('Off-view G2 has no edge marker: '+JSON.stringify(last));
 // 2) Manual Oct during a held low note is not overridden; the note is marked at the bottom edge instead.
 const second=await run([{midi:43,dur:2}],{at:.8,button:'Octave up'});
 const after=second.frames.filter(f=>f.t>1.1&&f.t<1.9);
 const moved=new Set(after.map(f=>f.range));
 if(moved.size!==1||!after.every(f=>f.edges.some(e=>e.startsWith('Show G2'))))throw new Error('Follow fought manual navigation: '+JSON.stringify(after.slice(0,3)));
 await page.locator('button[data-edge="below"]').click();
 const range=await page.locator('[aria-label="Visible range"]').textContent();
 await page.evaluate(()=>globalThis.__voicesynth.voice.stopMicrophone());
 return {followedRanges:[...new Set(first.frames.map(f=>f.range))],manualRange:[...moved][0],afterShow:range,
  evidence:'actual app DOM, synthetic G2/C6 test signal through capture worklet/YIN/VoiceInput/recorder/SLOOP; not a physical microphone'};
}
