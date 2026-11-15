async page=>{
 await page.addInitScript(()=>{
  const Native=globalThis.WebSocket;globalThis.__serviceInput={sent:[],received:[]};
  globalThis.WebSocket=class extends Native{
   constructor(url,protocols){super(String(url)==='ws://127.0.0.1:8000/ws'?'ws://127.0.0.1:8001/ws':url,protocols);this.addEventListener('message',e=>{try{globalThis.__serviceInput.received.push(JSON.parse(String(e.data)));}catch{}});}
   send(data){try{const m=JSON.parse(String(data));if(m.type!=='speech-audio')globalThis.__serviceInput.sent.push(m);}catch{}return super.send(data);}
  };
 });
 const base=page.url().startsWith('http://127.0.0.1:')?page.url().split('/').slice(0,3).join('/'):'http://127.0.0.1:5173';
 await page.goto(base);await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.getByRole('button',{name:'Not now',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,c=engine.getAudioContext();
  const buffer=c.createBuffer(1,c.sampleRate,c.sampleRate),samples=buffer.getChannelData(0);let seed=42;
  for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[i]=(seed/4294967296-.5)*.00016;}
  globalThis.__serviceSources=[];
  navigator.mediaDevices.getUserMedia=async()=>{const s=c.createBufferSource(),out=c.createMediaStreamDestination();s.buffer=buffer;s.loop=true;s.connect(out);s.start();globalThis.__serviceSources.push(s);return out.stream;};
  await voice.enableMicrophone();
 });
 await page.evaluate(()=>globalThis.__voicesynth.coordinator.agent.connect());
 const say=text=>page.evaluate(t=>globalThis.__voicesynth.coordinator.submitTranscript(t),text);
 try{
  await say('key D minor');await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().pitchSnap?.root===2);
  const before=await page.evaluate(()=>globalThis.__voicesynth.engine.getSession());
  const action=async(phrase,type,predicate)=>{
   const from=await page.evaluate(()=>globalThis.__serviceInput.received.length);await say(phrase);
   await page.waitForFunction(({from,type})=>globalThis.__serviceInput.received.slice(from).some(m=>m.type==='browser-action'&&m.operation.type===type),{from,type});
   const id=await page.evaluate(({from,type})=>globalThis.__serviceInput.received.slice(from).find(m=>m.type==='browser-action'&&m.operation.type===type).id,{from,type});
   await page.waitForFunction(id=>globalThis.__serviceInput.sent.some(m=>m.type==='browser-action-ack'&&m.id===id&&m.status==='complete'),id,{timeout:12000});
   if(!await page.evaluate(predicate))throw new Error('Browser operation did not apply: '+phrase);
  };
  await action('music profile','set-input-profile',()=>globalThis.__voicesynth.voice.getState().processingProfile==='music');
  await action('set offset to 20 milliseconds','set-input-offset',()=>globalThis.__voicesynth.voice.getState().calibration.offsetAdjustMs===20);
  await action('calibrate noise','calibrate-input',()=>globalThis.__voicesynth.voice.getState().calibration.noiseSource==='measured');
  const result=await page.evaluate(()=>({received:globalThis.__serviceInput.received,sent:globalThis.__serviceInput.sent,session:globalThis.__voicesynth.engine.getSession()}));
  if(result.received.some(m=>m.type==='error'))throw new Error('Actual service errors: '+JSON.stringify(result.received.filter(m=>m.type==='error')));
  if(JSON.stringify(result.session)!==JSON.stringify(before))throw new Error('Input actions changed music or key setting');
  return {realServiceInputActions:3,keyCommand:true,statusMessages:result.sent.filter(m=>m.type==='browser-status').length,terminalAcks:result.sent.filter(m=>m.type==='browser-action-ack'&&m.status==='complete').length,unsupportedMessages:0,musicPreserved:true,evidence:'actual Python WebSocket/parser + browser router/executor/capture/analysis/WASM; synthetic MediaStream and typed transcripts, no STT/LLM/physical microphone'};
 }finally{await page.evaluate(()=>{globalThis.__serviceSources.forEach(s=>s.stop());globalThis.__voicesynth.voice.stopMicrophone();});}
}
