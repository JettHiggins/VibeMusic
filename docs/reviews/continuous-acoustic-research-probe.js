async page=>{
 // Generate the five __synthetic-*.wav clips with espeak-ng as documented in the WS1 handoff.
 // Real cached local Whisper/CLAP/SLOOP service on8001; no typed transcripts or model output mocks.
 await page.addInitScript(()=>{
  if(globalThis.__continuousAcousticHook)return;globalThis.__continuousAcousticHook=true;
  const Native=globalThis.WebSocket;globalThis.__acoustic={received:[],counts:{},previewAcks:[],commandAcks:[],maxBuffered:0};
  globalThis.WebSocket=class extends Native{
   constructor(url,protocols){super(String(url)==='ws://127.0.0.1:8000/ws'?'ws://127.0.0.1:8001/ws':url,protocols);this.addEventListener('message',e=>globalThis.__acoustic.received.push(JSON.parse(String(e.data))));}
   send(data){globalThis.__acoustic.maxBuffered=Math.max(globalThis.__acoustic.maxBuffered,this.bufferedAmount);const m=JSON.parse(String(data));globalThis.__acoustic.counts[m.type]=(globalThis.__acoustic.counts[m.type]??0)+1;if(m.type==='preview-ack')globalThis.__acoustic.previewAcks.push(m);if(m.type==='ack')globalThis.__acoustic.commandAcks.push(m);return super.send(data);}
  };
 });
 const base=page.url().split('/').slice(0,3).join('/');
 await page.goto(base);await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.metadata!==null);
 await page.getByRole('button',{name:/^Synth 1 /}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.engine.getSession().revision>=1);
 await page.evaluate(async()=>{
  const {engine,voice}=globalThis.__voicesynth,c=engine.getAudioContext(),out=c.createMediaStreamDestination();
  const seeded=engine.getSession();seeded.tracks[0].notes=[{id:'acoustic-c',step:0,duration:2,midi:60,velocity:.8},{id:'acoustic-e',step:8,duration:2,midi:64,velocity:.8}];
  await new Promise((resolve,reject)=>{
   const id=crypto.randomUUID(),timer=setTimeout(()=>{off();reject(new Error('Seed composition failed'));},5000);
   const off=engine.subscribe(m=>{if(m.type==='ack'&&m.commandId===id&&m.status!=='queued'){clearTimeout(timer);off();m.status==='applied'?resolve():reject(new Error(m.reason));}});
   engine.dispatch({id,expectedRevision:engine.getSession().revision,boundary:'next-loop',operation:{type:'load-session',session:seeded}});
  });
  const take=c.createBuffer(1,42*c.sampleRate,c.sampleRate),samples=take.getChannelData(0);
  let seed=42;for(let n=0;n<samples.length;n++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;samples[n]=(seed/4294967296-.5)*.00016;}
  const schedule=[['instrument-request',1],['cancel',11],['audition',17],['accept',25],['undo',33]];
  for(const [file,seconds] of schedule){
   const response=await fetch('/__synthetic-'+file+'.wav');if(!response.ok)throw new Error('Generate speech fixture: '+file);
   const clip=await c.decodeAudioData(await response.arrayBuffer()),data=clip.getChannelData(0),offset=Math.round(seconds*c.sampleRate);
   for(let i=0;i<data.length;i++)samples[offset+i]+=data[i];
  }
  const source=c.createBufferSource();source.buffer=take;source.connect(out);
  // One graph, prepared once, with continuous room tone. No decoding/source insertion during capture.
  globalThis.__acoustic.source=source;
  navigator.mediaDevices.getUserMedia=async()=>out.stream;
  await voice.enableMicrophone();await voice.enableHandsFree();
  engine.subscribe(m=>{if(m.type==='transport')globalThis.__acoustic.transport=m.transport;});
 });
 await page.waitForFunction(()=>globalThis.__voicesynth.voice.getState().speech.status==='ready',{},{timeout:15000});
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__acoustic.transport?.playing);
 return await page.evaluate(async()=>{
  const {engine,voice,research}=globalThis.__voicesynth,c=engine.getAudioContext(),a=globalThis.__acoustic;
  const before=engine.getSession(),start=c.currentTime+.2;
  a.source.start(start);
  let first=null,chosen=null,accepted=false,restored=false,previewCompleted=false;
  try{
   while(c.currentTime<start+41){
    const t=c.currentTime-start,s=research.getSnapshot(),session=engine.getSession(),speech=voice.getState().speech;
    if(speech.status==='unavailable')throw new Error('Speech failed at '+t.toFixed(2)+'s: '+speech.message);
    if(!first&&s.candidates.length>=2){
     first={at:t,description:s.description,count:s.candidates.length};
     if(!s.candidates.every(p=>p.provenance.includes('LAION CLAP')&&p.provenance.includes('SLOOP WASM')))throw new Error('Non-real candidates');
    }
    if(t>16&&!chosen&&['cancelled','complete'].includes(s.status)&&s.candidates.length>=2)chosen=structuredClone(s.candidates[1].patch);
    if(s.preview?.status==='ended')previewCompleted=true;
    if(!accepted&&s.acceptance?.status==='applied'){
     if(!chosen||JSON.stringify(session.tracks[0].patch)!==JSON.stringify(chosen))throw new Error('Accepted patch differs from chosen candidate');
     if(JSON.stringify(session.tracks.map(p=>p.notes))!==JSON.stringify(before.tracks.map(p=>p.notes)))throw new Error('Accept changed notes');
     accepted=true;
    }
    const undo=a.received.find(m=>m.type==='command'&&m.command.operation.type==='undo');
    if(accepted&&undo&&a.commandAcks.some(m=>m.commandId===undo.command.id&&m.status==='applied')&&JSON.stringify(session.tracks)===JSON.stringify(before.tracks))restored=true;
    if(restored)break;
    await new Promise(r=>setTimeout(r,25));
   }
   const report={first,previewCompleted,accepted,restored,counts:a.counts,maxBuffered:a.maxBuffered,previewAcks:a.previewAcks,errors:a.received.filter(m=>m.type==='error'),speech:voice.getState().speech,playing:a.transport?.playing};
   a.report=report;
   if(!first||!previewCompleted||!accepted||!restored||!report.playing||report.errors.length||a.counts.utterance||!a.counts['speech-audio'])throw new Error('Incomplete acoustic sequence: '+JSON.stringify(report));
   return {...report,evidence:'one continuous room-tone/espeak buffer -> real browser MediaStream/capture/speech workers -> actual cached faster-whisper/CLAP/SLOOP -> actual preview/accept/Undo; no typed transcript/LLM/mocks, not human speech/hearing'};
  }catch(e){
   a.failure={message:String(e),at:c.currentTime-start,first,chosen,accepted,restored,previewCompleted,counts:a.counts,maxBuffered:a.maxBuffered,previewAcks:a.previewAcks,errors:a.received.filter(m=>m.type==='error'),commands:a.received.filter(m=>m.type==='command').map(m=>m.command.operation.type),speech:voice.getState().speech};
   throw new Error(JSON.stringify(a.failure));
  }finally{voice.stopMicrophone();a.source.stop();}
 });
}
