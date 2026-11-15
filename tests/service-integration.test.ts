import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSession,type EngineAdapter,type ClientMessage,type SessionCommand} from '../packages/contracts/src/index.ts';
import {EngineCore} from '../apps/web/src/engine/core.ts';
import {WebSocketAgent} from '../apps/web/src/integration/agent.ts';
import {SessionCoordinator} from '../apps/web/src/integration/coordinator.ts';
const enabled=process.env.VOICESYNTH_INTEGRATION==='1';
test('live Python WebSocket proposals apply to real WASM and return authoritative snapshots', {skip:!enabled,timeout:20000},async()=>{
 const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));
 const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
 const child=spawn(process.env.VOICESYNTH_PYTHON??'python3',['-m','uvicorn','groove_agent.app:app','--app-dir','services/agent','--host','127.0.0.1','--port',String(port)],{stdio:['ignore','ignore','pipe'],env:{...process.env,GROOVE_LLM:'',OPENROUTER_API_KEY:'',GROOVE_STT:'',GROOVE_RESEARCH:'',GROOVE_VOICE_RESEARCH:'0'}});
 let logs='';let coordinator:SessionCoordinator|undefined;let agent:WebSocketAgent|undefined;
 try{
  await new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Service startup timeout: '+logs)),10000);
   const done=()=>clearTimeout(timeout);
   child.once('error',e=>{done();reject(e);});child.once('exit',code=>{done();reject(new Error(`Service exited ${code}: ${logs}`));});
   child.stderr.on('data',data=>{logs=(logs+data.toString()).slice(-4000);if(logs.includes('Uvicorn running')){done();resolve();}});
  });
  const health=await (await fetch(`http://127.0.0.1:${port}/healthz`)).json() as {language:string;speech:string;research:string;voiceResearch:boolean};
  assert.equal(health.language,'parser');assert.equal(health.speech,'not configured');assert.equal(health.research,'not configured');
  assert.equal(health.voiceResearch,false);
  const dir='apps/web/public/engine';
  const module=await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
  const {FirmwareAudio}=await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
  const listeners=new Set<(m:ClientMessage)=>void>();
  const dsp=new FirmwareAudio(module);
  const core=new EngineCore(dsp,JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8')),createSession(),'integration-clock',m=>listeners.forEach(fn=>fn(m)));
  const engine:EngineAdapter={initialize:async()=>{},getSession:()=>core.getSession(),dispatch:c=>core.dispatch(c),subscribe:fn=>{listeners.add(fn);return ()=>{listeners.delete(fn);};},dispose:()=>listeners.clear()};
  agent=new WebSocketAgent(`ws://127.0.0.1:${port}/ws`);const socket=agent;
  coordinator=new SessionCoordinator(engine,socket,()=>socket.connected);const bridge=coordinator;
  socket.onStatus=connected=>bridge.connectionChanged(connected);
  const errors:string[]=[];bridge.onError=e=>errors.push(e.message);bridge.onMessage=m=>{if(m.type==='error')errors.push(m.message);};
  await socket.connect();
  let frame=0;
  const render=(count:number)=>{core.render(new Float32Array(count),new Float32Array(count),frame);frame+=count;listeners.forEach(fn=>fn({type:'transport',transport:core.transport()}));};
  render(128);
  async function transcript(text:string,predicate:(m:ClientMessage)=>boolean){
   await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{off();reject(new Error('No expected engine acknowledgment: '+errors.join(';')));},3000);
    const off=engine.subscribe(m=>{if(predicate(m)){clearTimeout(timer);off();resolve();}});
    bridge.submitTranscript(text);
   });
  }
  await transcript('select snare',m=>m.type==='session'&&m.session.selected.lane==='snare');
  assert.equal(core.getSession().revision,1);
  core.dispatch({id:'play',expectedRevision:1,boundary:'immediate',operation:{type:'play',playing:true}});render(128);
  await transcript('tempo one forty',m=>m.type==='ack'&&m.status==='queued');
  assert.equal(core.getSession().tempo,120);render(44100*8);
  assert.equal(core.getSession().tempo,140);assert.equal(core.getSession().revision,3);
  // Verify the backend receives the updated revision before issuing its next command.
  await transcript('mute drums',m=>m.type==='session'&&m.session.tracks[3].muted);
  assert.equal(core.getSession().revision,4);
  await transcript('record snare',m=>m.type==='ack'&&m.status==='queued');
  const beforeRecord=core.transport().currentFrame;
  const nextBeat=beforeRecord+Math.ceil((44100*60-dsp.w.vs_phase())/core.getSession().tempo);
  render(nextBeat-beforeRecord);assert.equal(core.transport().recordingState,'armed');render(1);
  assert.equal(core.transport().recordingStartFrame,nextBeat,'backend Record must use next-beat, not next-loop');
  render(1024);
  core.dispatch({id:'captured-snare',expectedRevision:core.getSession().revision,boundary:'next-loop',operation:{type:'commit-performance',recordingEpoch:core.transport().recordingEpoch,events:[{kind:'onset',id:'snare-from-capture',target:{trackId:'drums',lane:'snare'},clockId:'integration-clock',captureFrame:nextBeat+512,confidence:1,velocity:.8}],excludedSpans:[],verifiedThroughFrame:core.transport().currentFrame}});
  render(44100*8);assert.ok(core.getSession().tracks[3].hits.some(h=>h.id==='snare-from-capture'));
  const epoch=core.transport().recordingEpoch!;
  await transcript('Groove clear snare',m=>m.type==='session'&&!m.session.tracks[3].hits.some(h=>h.id==='snare-from-capture'));
  assert.equal(core.transport().recording,true);assert.equal(core.transport().playing,true);assert.equal(core.transport().recordingEpoch,epoch+1);
  await transcript('Groove undo',m=>m.type==='session'&&m.session.tracks[3].hits.some(h=>h.id==='snare-from-capture'));
  assert.equal(core.transport().recording,true);assert.equal(core.transport().playing,true);
  // Repair commands traverse the real Python parser, WebSocket, coordinator and WASM engine.
  // These are typed transcripts, not acoustic/STT evidence.
  const beforeClick=core.getSession().revision;
  await transcript('Groove metronome off',m=>m.type==='ack'&&m.status==='applied'&&m.revision===beforeClick);
  assert.equal(core.transport().metronomeEnabled,false);assert.equal(core.getSession().revision,beforeClick);
  assert.equal(core.transport().recording,true);assert.equal(core.transport().playing,true);
  // Change the selection from the UI (a spoken switch to another instrument now stops the take first,
  // by design); erase must still default to the active take, not the new selection.
  core.dispatch({id:'ui-select-synth-3',expectedRevision:core.getSession().revision,boundary:'immediate',operation:{type:'select',target:{trackId:'synth-3'}}});
  render(1024);assert.equal(core.getSession().selected.trackId,'synth-3');
  const hit=core.getSession().tracks[3].hits.find(h=>h.id==='snare-from-capture')!;
  const eraseEpoch=core.transport().recordingEpoch;
  const bar=Math.floor(hit.step/16)+1,beat=Math.floor(hit.step%16/4)+1,sixteenth=hit.step%4+1;
  await transcript(`Groove erase bar ${bar} beat ${beat} sixteenth ${sixteenth}`,m=>m.type==='session'&&!m.session.tracks[3].hits.some(h=>h.id==='snare-from-capture'));
  assert.equal(core.transport().recordingEpoch,eraseEpoch,'precise voice erase preserves the active take');
  assert.deepEqual(core.transport().captureErasure?.target,{trackId:'drums',lane:'snare'},'active take wins over the changed selection');
  assert.equal(core.transport().recording,true);assert.equal(core.transport().playing,true);
  await transcript('Groove stop',m=>m.type==='session'&&!core.transport().recording);
  render(128);assert.equal(core.transport().playing,true);assert.equal(core.transport().recording,false);
  assert.deepEqual(errors,[]);
  await transcript('record snare',m=>m.type==='ack'&&m.status==='queued');render(44100*8);
  assert.equal(bridge.captureAllowed,true);
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Disconnect callback did not arrive')),2000);
   socket.onStatus=connected=>{bridge.connectionChanged(connected);if(!connected){clearTimeout(timer);resolve();}};
   socket.dispose();assert.equal(bridge.captureAllowed,false);
  });
  assert.equal(core.transport().recording,false);assert.equal(core.transport().playing,true);
 }finally{
  coordinator?.dispose();agent?.dispose();child.kill();
  if(child.exitCode===null)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());setTimeout(()=>{child.kill('SIGKILL');resolve();},2000).unref();});
 }
});
