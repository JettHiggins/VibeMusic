async page=>{
 // Bar/beat preparation and truthful take feedback in the actual app: count-in from stopped names the start
 // bar, recording opens there, and the take line moves live -> waiting -> saved, reports Undo restarts and
 // the recorder's own disconnect reason. Synthetic test signal; not a physical microphone.
 const base=page.url().split('/').slice(0,3).join('/');
 await page.goto(base);
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.getByRole('button',{name:/^Synth 1 /}).click();
 return await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,context=engine.getAudioContext(),rate=context.sampleRate;
  const dispatch=operation=>engine.dispatch({id:crypto.randomUUID(),expectedRevision:engine.getSession().revision,boundary:operation.type==='record'?'next-beat':'immediate',operation});
  const strip=()=>document.querySelector('.vs-phase'),line=()=>document.querySelector('[aria-label="Take"]')?.innerText.replace(/\n/g,' / ')??'';
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  await voice.enableTestSignal(context.createBuffer(1,rate,rate),context.currentTime+60);voice.setLatencyFrames(0);
  dispatch({type:'record',target:{trackId:'synth-1'}});
  const phases=[];let last='';const t0=performance.now();
  while(performance.now()-t0<3000){const s=strip().dataset.phase+' '+strip().innerText.split('\n')[0];if(s!==last){phases.push(s);last=s;}if(strip().dataset.phase==='recording')break;await wait(30);}
  const counts=phases.filter(p=>p.startsWith('armed')).map(p=>p.replace('armed ',''));
  if(counts.join()!=='Count-in 4,Count-in 3,Count-in 2,Count-in 1')throw new Error('Count-in not legible: '+JSON.stringify(phases));
  if(!/^recording ● Recording · bar 2, beat 1$/.test(last))throw new Error('Take did not open at the announced bar: '+last);
  const buffer=context.createBuffer(1,rate*5,rate),x=buffer.getChannelData(0);
  const tone=(at,dur,midi)=>{const f=440*2**((midi-69)/12);for(let n=0;n<dur*rate;n++){const s=n/rate;x[Math.floor(at*rate)+n]=.05*Math.min(1,s/.015,(dur-s)/.015)*Math.sin(2*Math.PI*f*s);}};
  tone(0,.4,60);tone(.6,.4,64);tone(1.2,2,67);
  const when=context.currentTime+.1;await voice.enableTestSignal(buffer,when);voice.setLatencyFrames(0);
  const lines=[];let undone=false;last='';
  while(context.currentTime<when+3.8){const t=context.currentTime-when;
   if(!undone&&t>2){undone=true;await page_undo();}
   const s=line();if(s!==last){lines.push(s);last=s;}await wait(30);}
  async function page_undo(){[...document.querySelectorAll('header button')].find(b=>b.textContent==='Undo').click();}
  if(!lines.some(l=>l.startsWith('Hearing C4')))throw new Error('Live note not reported: '+JSON.stringify(lines));
  if(!lines.some(l=>/waiting to be sent/.test(l)))throw new Error('Waiting notes not reported: '+JSON.stringify(lines));
  if(!lines.some(l=>/Undo\/Clear restarted capture/.test(l)))throw new Error('Undo restart not explained: '+JSON.stringify(lines));
  voice.recorder.setMode('speech');voice.recorder.setSpeechAvailable(true);
  const b2=context.createBuffer(1,rate*2,rate),y=b2.getChannelData(0);for(let n=0;n<.4*rate;n++){const s=n/rate;y[n]=.05*Math.min(1,s/.015,(.4-s)/.015)*Math.sin(2*Math.PI*329.6*s);}
  const w2=context.currentTime+.1;await voice.enableTestSignal(b2,w2);voice.setLatencyFrames(0);
  while(context.currentTime<w2+.9)await wait(30);
  const speechWaiting=line();
  if(!/waiting for speech check/.test(speechWaiting))throw new Error('Speech-mode waiting label missing: '+speechWaiting);
  voice.recorder.setSpeechAvailable(false);await wait(100);
  const disconnected=line();
  if(!/Speech recognition disconnected; unverified hits were discarded/.test(disconnected))throw new Error('Recorder reason not shown: '+disconnected);
  dispatch({type:'stop-recording'});voice.stopMicrophone();
  return {phases,lines,speechWaiting,disconnected,evidence:'actual app DOM, synthetic test signal through capture worklet/YIN/VoiceInput/recorder/SLOOP; disconnect via the recorder\'s own setSpeechAvailable; not a physical microphone'};
 });
}
