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
 const child=spawn(process.env.VOICESYNTH_PYTHON??'python3',['-m','uvicorn','groove_agent.app:app','--app-dir','services/agent','--host','127.0.0.1','--port',String(port)],{stdio:['ignore','ignore','pipe']});
 let logs='';let coordinator:SessionCoordinator|undefined;let agent:WebSocketAgent|undefined;
 try{
  await new Promise<void>((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('Service startup timeout: '+logs)),10000);
   const done=()=>clearTimeout(timeout);
   child.once('error',e=>{done();reject(e);});child.once('exit',code=>{done();reject(new Error(`Service exited ${code}: ${logs}`));});
   child.stderr.on('data',data=>{logs=(logs+data.toString()).slice(-4000);if(logs.includes('Uvicorn running')){done();resolve();}});
  });
  const dir='apps/web/public/engine';
  const module=await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
  const {FirmwareAudio}=await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
  const listeners=new Set<(m:ClientMessage)=>void>();
  const core=new EngineCore(new FirmwareAudio(module),JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8')),createSession(),'integration-clock',m=>listeners.forEach(fn=>fn(m)));
  const engine:EngineAdapter={initialize:async()=>{},getSession:()=>core.getSession(),dispatch:c=>core.dispatch(c),subscribe:fn=>{listeners.add(fn);return ()=>{listeners.delete(fn);};},dispose:()=>listeners.clear()};
  agent=new WebSocketAgent(`ws://127.0.0.1:${port}/ws`);const socket=agent;
  coordinator=new SessionCoordinator(engine,socket,()=>socket.connected);const bridge=coordinator;
  socket.onStatus=connected=>{if(connected)bridge.sync();};
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
  assert.equal(core.getSession().revision,4);assert.deepEqual(errors,[]);
 }finally{
  coordinator?.dispose();agent?.dispose();child.kill();
  if(child.exitCode===null)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());setTimeout(()=>{child.kill('SIGKILL');resolve();},2000).unref();});
 }
});
