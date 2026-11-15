async page=>{
 const base=page.url().startsWith('http://127.0.0.1:')?page.url().split('/').slice(0,3).join('/'):'http://127.0.0.1:5173';
 await page.goto(base);await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.getByRole('button',{name:'Not now',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 return await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,c=engine.getAudioContext();
  const buffer=c.createBuffer(1,c.sampleRate,c.sampleRate),samples=buffer.getChannelData(0);let seed=94;
  for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=(seed/4294967296*2-1)*Math.sqrt(3)*.001;}
  const source=c.createBufferSource(),gain=c.createGain(),destination=c.createMediaStreamDestination();
  source.buffer=buffer;source.loop=true;source.connect(gain).connect(destination);source.start();
  navigator.mediaDevices.getUserMedia=async()=>destination.stream;
  try{
   await voice.enableMicrophone();
   const initial=engine.getSession();
   const t=c.currentTime;gain.gain.setValueAtTime(100,t+.6);gain.gain.setValueAtTime(1,t+.85);
   const first=await voice.calibrateNoise(0),floor=voice.getState().calibration.noiseFloorDb;
   if(first.status!=='complete'||floor<-63||floor>-56)throw new Error('Brief burst spoiled the measured room: '+JSON.stringify({first,floor}));
   const before=voice.getState().calibration;
   const t2=c.currentTime;gain.gain.setValueAtTime(100,t2+.4);gain.gain.setValueAtTime(1,t2+1);
   const started=performance.now(),second=await voice.calibrateNoise(0),elapsedMs=performance.now()-started;
   if(second.status!=='rejected'||!/steady room noise/.test(second.text))throw new Error('Unstable room was not refused: '+JSON.stringify(second));
   if(voice.getState().calibration!==before)throw new Error('Failed calibration replaced the prior valid result');
   if(elapsedMs>5000||/No microphone audio arrived/.test(second.text))throw new Error('Active capture refusal looked like a missing microphone');
   if(JSON.stringify(engine.getSession())!==JSON.stringify(initial))throw new Error('Input calibration changed musical state');
   return {briefBurstIgnored:true,noiseFloorDb:floor,unstableMeasurementRefused:true,previousCalibrationPreserved:true,refusalMs:Math.round(elapsedMs),evidence:'real browser MediaStream/capture worklet/YIN worker/noise estimator/VoiceInput, synthetic controlled noise at the microphone boundary; no physical mic or human room evidence'};
  }finally{source.stop();voice.stopMicrophone();}
 });
}
