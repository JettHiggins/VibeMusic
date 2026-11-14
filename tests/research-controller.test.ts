import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession,type AgentAdapter,type ClientMessage,type EngineAdapter,type PatchCandidate,type ServerMessage,type SessionCommand} from '../packages/contracts/src/index.ts';
import {ResearchController} from '../apps/web/src/integration/research.ts';
function setup(){
 const session=createSession(),sent:ClientMessage[]=[],commands:SessionCommand[]=[];
 const service=new Set<(m:ServerMessage)=>void>(),audio=new Set<(m:ClientMessage)=>void>();let connected=true,n=0;
 const agent:AgentAdapter={send:m=>{sent.push(m);},subscribe:fn=>{service.add(fn);return ()=>{service.delete(fn);};},dispose:()=>{}};
 const engine:EngineAdapter={getSession:()=>session,initialize:async()=>{},dispatch:c=>{commands.push(c);return {type:'ack',commandId:c.id,status:'queued',revision:session.revision};},subscribe:fn=>{audio.add(fn);return ()=>{audio.delete(fn);};},dispose:()=>{}};
 const controller=new ResearchController(engine,agent,()=>connected,()=>`request-${++n}`);
 const candidate:PatchCandidate={id:'candidate-a',patch:{...session.tracks[0].patch,engine:1},score:0.4,previewUrl:'http://127.0.0.1:8000/previews/test.wav',provenance:'MOCK ranking; real SLOOP audio'};
 const emit=(m:ServerMessage)=>service.forEach(fn=>fn(m));
 return {session,controller,sent,commands,candidate,emit,audio,service,disconnect:()=>{connected=false;controller.connectionChanged(false);}};
}
test('research binds the exact displayed patch to its original track and waits for authoritative acceptance',()=>{
 const s=setup();s.controller.request('synth-1','80s piano');const jobId=s.controller.getSnapshot().jobId!;
 s.emit({type:'research',jobId,status:'running',progress:0.2,candidates:[s.candidate]});
 s.session.selected={trackId:'synth-3'};s.session.revision=7;
 s.controller.accept('candidate-a');
 assert.equal(s.commands[0].operation.type,'apply-patch');
 if(s.commands[0].operation.type==='apply-patch')assert.equal(s.commands[0].operation.trackId,'synth-1');
 assert.equal(s.commands[0].expectedRevision,7);assert.equal(s.commands[0].boundary,'next-loop');
 const commandId=s.commands[0].id;
 s.emit({type:'research',jobId,status:'complete',progress:1,candidates:[{...s.candidate,patch:{...s.candidate.patch,engine:2}}]});
 if(s.commands[0].operation.type==='apply-patch')assert.equal(s.commands[0].operation.patch.engine,1);
 assert.equal(s.controller.getSnapshot().acceptance?.status,'queued');
 assert.throws(()=>s.controller.accept('candidate-a'),/already queued/);
 s.audio.forEach(fn=>fn({type:'ack',commandId,status:'applied',revision:8}));
 assert.equal(s.controller.getSnapshot().acceptance?.status,'applied');s.controller.dispose();
 assert.equal(s.audio.size,0);assert.equal(s.service.size,0);
});
test('superseded and disconnected jobs cannot replace current results; errors and cancellation remain visible',()=>{
 const s=setup();s.controller.request('synth-1','piano');const old=s.controller.getSnapshot().jobId!;
 s.controller.request('synth-2','organ');const current=s.controller.getSnapshot().jobId!;
 assert.deepEqual(s.sent[1],{type:'cancel-job',jobId:old});
 s.emit({type:'research',jobId:old,status:'complete',progress:1,candidates:[s.candidate]});assert.equal(s.controller.getSnapshot().candidates.length,0);
 s.controller.cancel();assert.deepEqual(s.sent.at(-1),{type:'cancel-job',jobId:current});
 s.emit({type:'research',jobId:current,status:'cancelled',progress:0.5,candidates:[s.candidate]});assert.equal(s.controller.getSnapshot().status,'cancelled');
 s.controller.request('synth-1','piano');const next=s.controller.getSnapshot().jobId!;
 s.disconnect();s.emit({type:'research',jobId:next,status:'complete',progress:1,candidates:[s.candidate]});
 assert.equal(s.controller.getSnapshot().status,'failed');assert.equal(s.controller.getSnapshot().candidates.length,0);
 assert.throws(()=>s.controller.request('synth-1','piano'),/Connect/);
});
test('request failures and rejected patches are not shown as successful acceptance',()=>{
 const s=setup();assert.throws(()=>s.controller.request('drums','kick'),/synth tracks/);assert.throws(()=>s.controller.request('synth-1',' '),/Describe/);
 s.controller.request('synth-1','piano');let id=s.controller.getSnapshot().jobId!;
 s.emit({type:'error',requestId:id,message:'Research is not configured'});assert.equal(s.controller.getSnapshot().status,'failed');
 s.controller.request('synth-1','piano');id=s.controller.getSnapshot().jobId!;
 s.emit({type:'research',jobId:id,status:'complete',progress:1,candidates:[s.candidate]});s.controller.accept(s.candidate.id);
 s.audio.forEach(fn=>fn({type:'ack',commandId:s.commands[0].id,status:'rejected',revision:2,reason:'Stale revision'}));
 assert.equal(s.controller.getSnapshot().acceptance?.status,'rejected');assert.equal(s.controller.getSnapshot().acceptance?.reason,'Stale revision');
});
