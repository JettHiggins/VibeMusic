async page=>{
 // Explicitly SCRIPTED WebSocket peer. Actual UI/Audio/WASM, no backend/STT/LLM evidence.
 const acks=[];let snapshot=null;
 const makeCandidate=()=>({id:'fixture-candidate',patch:snapshot.tracks[0].patch,score:0,previewUrl:'http://127.0.0.1:5173/engine/synthetic-groove-stop.wav',provenance:'SCRIPTED browser fixture, not a researched sound'});
 await page.routeWebSocket('ws://127.0.0.1:8000/ws',socket=>{
  socket.onMessage(data=>{
   const message=JSON.parse(String(data));
   if(message.type==='session')snapshot=message.session;
   if(message.type==='preview-ack')acks.push(message);
   if(message.type!=='utterance')return;
   const send=m=>socket.send(JSON.stringify(m));
   if(message.text==='fixture-search'){
    send({type:'research-context',requestId:'fixture-speech',jobId:'fixture-job',trackId:'synth-1',description:'Voice-started fixture piano',origin:'voice'});
    send({type:'research',jobId:'fixture-job',status:'complete',progress:1,candidates:[makeCandidate()]});
   }else if(message.text==='fixture-preview')send({type:'candidate-preview',id:'fixture-preview',jobId:'fixture-job',candidateId:'fixture-candidate'});
   else if(message.text==='fixture-stale')send({type:'candidate-preview',id:'stale-preview',jobId:'old-job',candidateId:'fixture-candidate'});
   else if(message.text==='fixture-replace'){
    send({type:'research-context',requestId:'new-fixture-speech',jobId:'new-fixture-job',trackId:'synth-2',description:'Replacement fixture sound',origin:'voice'});
    send({type:'research',jobId:'new-fixture-job',status:'complete',progress:1,candidates:[{...makeCandidate(),id:'replacement-candidate'}]});
   }
  });
 });
 await page.goto('http://127.0.0.1:5173');
 await page.getByRole('button',{name:'Enable audio',exact:true}).click();
 await page.getByRole('button',{name:'Not now',exact:true}).click();
 await page.evaluate(()=>globalThis.__voicesynth.coordinator.agent.connect());
 await page.waitForFunction(()=>globalThis.__voicesynth.research!==undefined);
 await page.evaluate(()=>{globalThis.__previewOff=globalThis.__voicesynth.engine.subscribe(m=>{if(m.type==='transport')globalThis.__previewTransport=m.transport;});});
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__previewTransport?.playing===true);
 const text=async value=>await page.evaluate(text=>globalThis.__voicesynth.coordinator.submitTranscript(text),value);
 await text('fixture-search');
 const panel=page.getByRole('region',{name:'Sound research'});
 await page.getByText('Voice-started fixture piano',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'Preview candidate 1',exact:true}).waitFor();
 const before=await page.evaluate(()=>structuredClone(globalThis.__voicesynth.engine.getSession()));
 await text('fixture-preview');
 await page.waitForFunction(()=>globalThis.__voicesynth.research.getSnapshot().preview?.status==='ended');
 const valid=acks.filter(a=>a.id==='fixture-preview');
 if(JSON.stringify(valid.map(a=>a.status))!==JSON.stringify(['started','ended']))throw new Error('Real audio lifecycle failed '+JSON.stringify(acks));
 await text('fixture-stale');await panel.getByText(/Candidate is no longer displayed/).waitFor();
 if(!acks.some(a=>a.id==='stale-preview'&&a.status==='rejected'))throw new Error('Stale request was not rejected');
 await panel.getByRole('button',{name:'Preview candidate 1',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.research.getSnapshot().preview?.status==='playing');
 await panel.getByRole('button',{name:'Stop preview',exact:true}).click();
 await page.waitForFunction(()=>globalThis.__voicesynth.research.getSnapshot().preview?.status==='stopped');
 await text('fixture-preview'); // completed request ID must not replay sound
 await page.waitForTimeout(100);
 if(await page.evaluate(()=>globalThis.__voicesynth.research.getSnapshot().preview?.status==='playing'))throw new Error('Duplicate preview restarted');
 await text('fixture-replace');await panel.getByText('Replacement fixture sound',{exact:true}).waitFor();
 const result=await page.evaluate(before=>{
  const {engine,research}=globalThis.__voicesynth;
  if(JSON.stringify(engine.getSession())!==JSON.stringify(before))throw new Error('Preview mutated composition');
  if(!globalThis.__previewTransport?.playing)throw new Error('Preview stopped groove playback');
  globalThis.__previewOff();
  return {playing:globalThis.__previewTransport.playing,jobId:research.getSnapshot().jobId,trackId:research.getSnapshot().trackId,preview:research.getSnapshot().preview,revision:engine.getSession().revision};
 },before);
 // WebSocketAgent.send validates every outbound acknowledgment against ClientMessage.
 return {...result,acks,evidence:'SCRIPTED WebSocket peer; real app panel, HTMLAudioElement play/end, manual stop and SLOOP state. NOT backend, recognizer, model, human hearing or sound-quality acceptance'};
}
