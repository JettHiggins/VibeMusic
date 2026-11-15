import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession,type AgentAdapter,type ClientMessage,type EngineAdapter,type PatchCandidate,type PreviewAck,type ResearchContext,type ServerMessage,type SessionCommand} from '../packages/contracts/src/index.ts';
import {ResearchController} from '../apps/web/src/integration/research.ts';
import {CandidatePreviewPlayer,type PreviewAudio} from '../apps/web/src/integration/preview.ts';
import {SessionCoordinator} from '../apps/web/src/integration/coordinator.ts';
class Audio implements PreviewAudio {
 listeners=new Map<string,Set<()=>void>>();pauses=0;plays=0;releases=0;
 resolve!:()=>void;reject!:()=>void;
 promise=new Promise<void>((resolve,reject)=>{this.resolve=resolve;this.reject=()=>reject(new Error('blocked'));});
 play(){this.plays++;return this.promise;}pause(){this.pauses++;}release(){this.releases++;}
 addEventListener(type:string,fn:()=>void){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type)!.add(fn);}
 removeEventListener(type:string,fn:()=>void){this.listeners.get(type)?.delete(fn);}
 emit(type:string){this.listeners.get(type)?.forEach(fn=>fn());}
}
function setup(){
 const session=createSession(),sent:ClientMessage[]=[],commands:SessionCommand[]=[],audios:{url:string;audio:Audio}[]=[];
 const service=new Set<(m:ServerMessage)=>void>(),engineListeners=new Set<(m:ClientMessage)=>void>();let online=true,n=0;
 const agent:AgentAdapter={send:m=>{sent.push(m);},subscribe:fn=>{service.add(fn);return()=>{service.delete(fn);};},dispose:()=>{}};
 const engine:EngineAdapter={initialize:async()=>{},getSession:()=>session,dispatch:command=>{commands.push(command);return {type:'ack',commandId:command.id,status:'queued',revision:session.revision};},subscribe:fn=>{engineListeners.add(fn);return()=>{engineListeners.delete(fn);};},dispose:()=>{}};
 const controller=new ResearchController(engine,agent,()=>online,()=>`ui-${++n}`,url=>{const audio=new Audio();audios.push({url,audio});return audio;});
 const context=(jobId='voice-a',trackId:ResearchContext['trackId']='synth-1'):ResearchContext=>({type:'research-context',requestId:`${jobId}:request`,jobId,trackId,description:`Sound ${jobId}`,origin:'voice'});
 const candidate:PatchCandidate={id:'patch-a',patch:structuredClone(session.tracks[0].patch),previewUrl:'http://127.0.0.1:8000/previews/a.wav',provenance:'fixture',score:0};
 const emit=(m:ServerMessage)=>service.forEach(fn=>fn(m));
 const progress=(jobId='voice-a',candidates=[candidate],status:'running'|'complete'='running')=>emit({type:'research',jobId,status,progress:0.5,candidates});
 const preview=(id='preview-a',jobId='voice-a',candidateId='patch-a')=>emit({type:'candidate-preview',id,jobId,candidateId});
 const acks=()=>sent.filter((m):m is PreviewAck=>m.type==='preview-ack');
 return {session,sent,commands,audios,agent,engine,controller,context,candidate,emit,progress,preview,acks,
  voice:()=>{emit(context());progress();controller.setAudioEnabled(true);},
  ack:(id:string,status:'applied'|'rejected')=>engineListeners.forEach(fn=>fn({type:'ack',commandId:id,status,revision:session.revision})),
  disconnect:()=>{online=false;controller.connectionChanged(false);}};
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('voice context adopts an idle panel, keeps original track and ignores duplicate/retired jobs',()=>{
 const s=setup();try{
  s.emit(s.context());s.progress();s.session.selected={trackId:'synth-3'};
  s.emit(s.context());assert.equal(s.controller.getSnapshot().candidates.length,1);
  assert.equal(s.controller.getSnapshot().trackId,'synth-1');
  s.emit(s.context('voice-b','synth-2'));assert.deepEqual(s.sent.at(-1),{type:'cancel-job',jobId:'voice-a'});
  s.progress('voice-b',[{...s.candidate,id:'patch-b'}]);s.emit(s.context());s.progress();
  assert.equal(s.controller.getSnapshot().jobId,'voice-b');assert.equal(s.controller.getSnapshot().candidates[0].id,'patch-b');
  s.emit({...s.context('voice-b'),trackId:'synth-3'});assert.equal(s.controller.getSnapshot().trackId,'synth-2');
  assert.equal(s.commands.length,0);
 }finally{s.controller.dispose();}
});
test('pending newer UI request rejects buffered voice context and never re-adopts it after progress',()=>{
 const s=setup();try{
  s.controller.request('synth-2','New piano');const id=s.controller.getSnapshot().jobId!;
  s.emit(s.context());assert.equal(s.controller.getSnapshot().jobId,id);assert.deepEqual(s.sent.at(-1),{type:'cancel-job',jobId:'voice-a'});
  s.progress(id);s.emit(s.context());assert.equal(s.controller.getSnapshot().jobId,id);
  s.emit(s.context('new-voice'));assert.equal(s.controller.getSnapshot().jobId,'new-voice');
 }finally{s.controller.dispose();}
});
test('queued patch acknowledgment stays bound while voice contexts are rejected',()=>{
 const s=setup();try{
  s.voice();s.controller.accept('patch-a');const id=s.commands[0].id;
  s.emit(s.context('blocked'));assert.equal(s.controller.getSnapshot().jobId,'voice-a');
  assert.equal(s.controller.getSnapshot().acceptance?.commandId,id);
  assert.throws(()=>s.controller.request('synth-2','Other'),/pending sound change/);
  s.ack(id,'applied');s.emit(s.context('blocked'));assert.equal(s.controller.getSnapshot().jobId,'voice-a');
  s.emit(s.context('fresh'));assert.equal(s.controller.getSnapshot().jobId,'fresh');
 }finally{s.controller.dispose();}
});
test('voice acceptance is tracked before dispatch and synchronous rejection releases the search gate',()=>{
 const s=setup();const coordinator=new SessionCoordinator(s.engine,s.agent,()=>true);
 try{
  s.voice();s.engine.dispatch=c=>({type:'ack',commandId:c.id,status:'rejected',revision:0,reason:'Enable audio first'});
  coordinator.prepareCommand=c=>s.controller.prepareCommand(c);coordinator.onReceipt=m=>s.controller.commandReceipt(m);
  s.emit({type:'command',command:{id:'voice-accept',expectedRevision:0,boundary:'next-loop',operation:{type:'apply-patch',trackId:'synth-1',patch:s.candidate.patch}}});
  assert.equal(s.controller.getSnapshot().acceptance?.status,'rejected');
  assert.doesNotThrow(()=>s.controller.request('synth-2','New sound'));
 }finally{coordinator.dispose();s.controller.dispose();}
});
test('voice preview confirms actual start/end, deduplicates IDs and never changes music',async()=>{
 const s=setup();try{
  s.voice();const before=structuredClone(s.session);s.preview();s.preview();
  assert.equal(s.audios.length,1);assert.equal(s.acks().length,0);
  const audio=s.audios[0].audio;audio.resolve();await flush();assert.equal(s.acks()[0].status,'started');
  s.preview();assert.equal(s.audios.length,1);assert.equal(s.acks().at(-1)?.status,'started');
  s.preview('preview-a','voice-a','wrong-patch');assert.equal(s.acks().at(-1)?.status,'rejected');assert.equal(audio.pauses,0);
  audio.emit('ended');assert.equal(s.acks().at(-1)?.status,'ended');
  assert.equal(s.commands.length,0);assert.deepEqual(s.session,before);
 }finally{s.controller.dispose();}
});
test('disabled audio, stale jobs, missing candidates and absent URLs are rejected without playback',()=>{
 const s=setup();try{
  s.emit(s.context());s.progress();s.preview('disabled');s.controller.setAudioEnabled(true);
  s.preview('stale','old-job');s.preview('missing','voice-a','missing');
  s.progress('voice-a',[{...s.candidate,previewUrl:''}]);s.preview('no-url');
  assert.equal(s.audios.length,0);assert.equal(s.acks().length,4);assert.ok(s.acks().every(m=>m.status==='rejected'));
 }finally{s.controller.dispose();}
});
test('superseded play promises and end events cannot restart or acknowledge an old preview',async()=>{
 const s=setup();try{
  s.voice();s.preview('old');const old=s.audios[0].audio;
  s.progress('voice-a',[s.candidate,{...s.candidate,id:'patch-b'}]);s.preview('new','voice-a','patch-b');
  const fresh=s.audios[1].audio;fresh.resolve();await flush();old.resolve();old.emit('ended');await flush();
  assert.ok(old.pauses>=2);assert.ok(old.releases);assert.equal(fresh.pauses,0);
  assert.deepEqual(s.acks().filter(m=>m.id==='old').map(m=>m.status),['rejected']);
  assert.deepEqual(s.acks().filter(m=>m.id==='new').map(m=>m.status),['started']);
 }finally{s.controller.dispose();}
});
test('manual/voice share one player; replacing candidate data and disconnect stop playback',async()=>{
 const s=setup();try{
  s.voice();s.preview();const voice=s.audios[0].audio;voice.resolve();await flush();
  s.controller.preview('patch-a');assert.ok(voice.pauses);assert.equal(s.acks().at(-1)?.status,'rejected');
  const manual=s.audios[1].audio;manual.resolve();await flush();const count=s.acks().length;
  s.progress('voice-a',[{...s.candidate,patch:{...s.candidate.patch,preset:1}}]);assert.ok(manual.pauses);assert.equal(s.acks().length,count);
  s.preview('disconnected');const pending=s.audios.at(-1)!.audio;s.disconnect();pending.resolve();await flush();
  assert.ok(pending.pauses);assert.equal(s.controller.getSnapshot().candidates.length,0);assert.equal(s.acks().length,count);
 }finally{s.controller.dispose();}
});
test('blocked play and disposal produce rejection rather than false start/end',async()=>{
 const s=setup();try{
  s.voice();s.preview('blocked');s.audios[0].audio.reject();await flush();
  assert.deepEqual(s.acks().map(m=>m.status),['rejected']);assert.equal(s.controller.getSnapshot().preview?.status,'failed');
  s.preview('dispose');const audio=s.audios[1].audio;s.controller.dispose();audio.resolve();await flush();
  assert.deepEqual(s.acks().filter(m=>m.id==='dispose').map(m=>m.status),['rejected']);assert.ok(audio.pauses);
 }finally{s.controller.dispose();}
});
test('preview start and finish deadlines stop playback with explicit rejection',async()=>{
 const messages:PreviewAck[]=[],audios:Audio[]=[];
 const player=new CandidatePreviewPlayer(m=>messages.push(m),()=>{},()=>{const a=new Audio();audios.push(a);return a;},10,10);
 const s=setup();try{
  const request={type:'candidate-preview' as const,id:'timeout',jobId:'job',candidateId:'patch-a'};
  player.reserve(request);player.start('job',s.candidate,request);await new Promise(r=>setTimeout(r,30));
  assert.equal(messages.at(-1)?.status,'rejected');assert.ok(audios[0].pauses);
  const second={...request,id:'finish'};player.reserve(second);player.start('job',s.candidate,second);audios[1].resolve();await flush();
  await new Promise(r=>setTimeout(r,30));assert.deepEqual(messages.filter(m=>m.id==='finish').map(m=>m.status),['started','rejected']);
 }finally{player.reset();s.controller.dispose();}
});

test('a receipt observer failure cannot reject a command already submitted to the audio thread',()=>{
 const s=setup(),errors:string[]=[];const coordinator=new SessionCoordinator(s.engine,s.agent,()=>true);
 try{
  coordinator.onReceipt=()=>{throw new Error('UI observer failed');};coordinator.onError=e=>errors.push(e.message);
  s.emit({type:'command',command:{id:'submitted',expectedRevision:0,boundary:'immediate',operation:{type:'volume',trackId:'synth-1',volume:0.5}}});
  assert.equal(s.commands.length,1);assert.equal(errors.length,1);assert.match(errors[0],/UI observer failed/);
  assert.equal(s.sent.filter(m=>m.type==='ack').length,0,'submission is not a rejected or authoritative ack');
  s.ack('submitted','applied');assert.equal(s.sent.find(m=>m.type==='ack')?.status,'applied');
 }finally{coordinator.dispose();s.controller.dispose();}
});

test('a spoken search skipped while another search is pending says so instead of vanishing',()=>{
 const s=setup();s.controller.setAudioEnabled(true);
 s.controller.request('synth-1','typed pad'); // UI search still waiting for its first result
 s.emit(s.context('voice-b'));
 const state=s.controller.getSnapshot();
 assert.match(state.error??'',/Skipped the spoken search for "Sound voice-b"/);
 assert.ok(s.sent.some(m=>m.type==='cancel-job'&&m.jobId==='voice-b'));
});
