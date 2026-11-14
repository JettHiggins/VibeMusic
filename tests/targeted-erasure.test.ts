import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSession,type ClientMessage,type PerformanceEvent,type SessionCommand,type SessionState} from '../packages/contracts/src/index.ts';
import {EngineCore} from '../apps/web/src/engine/core.ts';
import {PerformanceRecorder} from '../apps/web/src/input/recorder.ts';
const dir='apps/web/public/engine',ready=existsSync(`${dir}/voicesynth.wasm`),SR=44100,STEP=SR/8,LOOP=SR*8;
async function setup(seed=true,release=true){
 const {FirmwareAudio}=await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const native=new FirmwareAudio(await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`)));
 const calls:number[][]=[],messages:ClientMessage[]=[],session=createSession();
 if(seed){
  session.tracks[3].hits=[{id:'erase-kick',lane:'kick',step:18,velocity:.8},{id:'keep-kick',lane:'kick',step:24,velocity:.8},{id:'keep-snare',lane:'snare',step:18,velocity:.8}];
  session.tracks[0].notes=[{id:'wrap',step:62,duration:4,midi:60,velocity:.8},{id:'keep-note',step:24,duration:4,midi:67,velocity:.8}];
  session.tracks[1].notes=[{id:'other-track',step:0,duration:16,midi:64,velocity:.8}];
 }
 const w={...native.w};
 if(release){assert.equal(typeof native.w.vs_erase_note,'function','Build current engine assets before erasure tests');w.vs_erase_note=(track:number,note:number)=>{calls.push([track,note]);native.w.vs_erase_note(track,note);};}
 else delete w.vs_erase_note;
 const listeners:((message:ClientMessage)=>void)[]=[];
 const core=new EngineCore({w,sync:state=>native.sync(state)},JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8')),session,'clock',m=>{messages.push(m);listeners.forEach(listener=>listener(m));});
 let frame=0,id=0;
 const render=(count:number)=>{const left=new Float32Array(count);core.render(left,new Float32Array(count),frame);frame+=count;return left;};
 const send=(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate')=>core.dispatch({id:`request-${++id}`,expectedRevision:core.getSession().revision,boundary,operation});
 const record=(target:SessionState['selected'])=>{send({type:'record',target},'next-beat');render(SR*2+1);assert.equal(core.transport().recording,true);};
 const batch=(events:PerformanceEvent[])=>send({type:'commit-performance',events,excludedSpans:[],verifiedThroughFrame:core.transport().currentFrame,recordingEpoch:core.transport().recordingEpoch},'next-loop');
 const hit=(id:string,step:number,loop=0):PerformanceEvent=>({kind:'onset',id,target:{trackId:'drums',lane:'kick'},captureFrame:Math.round((step+loop*64)*STEP),clockId:'clock',velocity:.8,confidence:1});
 const note=(id:string,step:number,duration:number,loop=0):PerformanceEvent=>({kind:'note',id,target:{trackId:'synth-1'},captureFrame:Math.round((step+loop*64)*STEP),endFrame:Math.round((step+duration+loop*64)*STEP),clockId:'clock',midi:60,velocity:.8,confidence:1});
 return {core,messages,calls,render,send,record,batch,hit,note,native,listeners};
}
const kick={trackId:'drums' as const,lane:'kick' as const};
test('real recorder consumes the engine fence while the surviving batch keeps its command ID', {skip:!ready},async()=>{
 const s=await setup();let id=0;
 const recorder=new PerformanceRecorder({dispatch:c=>s.core.dispatch(c),newId:()=>`capture-${++id}`},'manual',{batchLeadSeconds:Infinity});
 s.listeners.push(m=>recorder.handle(m));recorder.handle({type:'session',session:s.core.getSession()});
 s.record(kick);s.render(SR);recorder.handle({type:'transport',transport:s.core.transport()});
 const onset=(step:number)=>({frame:Math.round(step*STEP),velocity:.8,confidence:1,levelDb:-12});
 recorder.addOnsets([onset(18),onset(20)],0,'clock',s.core.transport().currentFrame);
 const original=recorder.status().inFlight;assert.ok(original);
 s.send({type:'erase-event',target:kick,step:18});
 assert.equal(recorder.status().inFlight,original);
 assert.deepEqual(recorder.status().provisional.map(p=>p.step),[20]);
 recorder.addOnsets([onset(18)],0,'clock',s.core.transport().currentFrame);
 assert.deepEqual(recorder.status().provisional.map(p=>p.step),[20],'late worker input stays fenced');
 s.render(LOOP);recorder.handle({type:'transport',transport:s.core.transport()});
 assert.equal(recorder.status().inFlight,null);assert.equal(recorder.status().committed,1);
 assert.ok(s.messages.some(m=>m.type==='ack'&&m.commandId===original&&m.status==='applied'));
 assert.deepEqual(s.core.getSession().tracks[3].hits.filter(h=>h.lane==='kick').map(h=>h.step).sort((a,b)=>a-b),[20,24]);
});
test('erase removes one committed hit immediately, retains unrelated queued input and fences late copies', {skip:!ready},async()=>{
 const s=await setup();s.record(kick);s.render(SR);
 const epoch=s.core.transport().recordingEpoch!,revision=s.core.getSession().revision;
 const queued=s.batch([s.hit('old-erased',18),s.hit('good-input',20)]);assert.ok(queued.type==='ack'&&queued.status==='queued');
 const before=s.messages.length,cutoff=s.core.transport().currentFrame;
 s.send({type:'erase-event',target:kick,step:18});
 assert.equal(s.core.getSession().revision,revision+1);assert.equal(s.core.transport().recordingEpoch,epoch);
 assert.equal(s.core.transport().captureStartFrame,SR*2);
 assert.deepEqual(s.core.getSession().tracks[3].hits.map(h=>h.id),['keep-kick','keep-snare']);
 const fence=s.core.transport().captureErasure!;assert.equal(fence.throughFrame,cutoff);assert.equal(fence.step,18);assert.equal(fence.recordingEpoch,epoch);
 const after=s.messages.slice(before),notice=after.findIndex(m=>m.type==='transport'&&m.transport.captureErasure?.commandId===fence.commandId);
 const ack=after.findIndex(m=>m.type==='ack'&&m.commandId===queued.commandId);assert.ok(notice>=0&&notice<ack);
 assert.ok(s.core.transport().pendingCommandIds.includes(queued.commandId),'surviving batch retains its command ID');
 s.render(LOOP);
 assert.deepEqual(s.core.getSession().tracks[3].hits.map(h=>h.id).sort(),['good-input','keep-kick','keep-snare']);
 assert.ok(s.messages.some(m=>m.type==='ack'&&m.commandId===queued.commandId&&m.status==='applied'));
 const settled=s.core.getSession().revision;s.batch([s.hit('late-copy',18)]);s.render(LOOP);
 assert.equal(s.core.getSession().revision,settled,'fully fenced copy is not a new musical edit');
 assert.ok(!s.core.getSession().tracks[3].hits.some(h=>h.step===18&&h.lane==='kick'));
 const freshLoop=Math.floor(s.core.transport().currentFrame/LOOP);s.batch([s.hit('fresh-input',18,freshLoop)]);s.render(LOOP);
 assert.ok(s.core.getSession().tracks[3].hits.some(h=>h.id==='fresh-input'),'fresh post-cutoff input can refill the position');
});
test('provisional-only erase cancels an empty batch without history or epoch reset; new epoch clears fences', {skip:!ready},async()=>{
 const s=await setup(false);s.record(kick);s.render(SR);const revision=s.core.getSession().revision,epoch=s.core.transport().recordingEpoch;
 const queued=s.batch([s.hit('provisional',18)]);s.send({type:'erase-event',target:kick,step:18});
 assert.equal(s.core.getSession().revision,revision);assert.equal(s.core.transport().recordingEpoch,epoch);
 assert.equal(s.core.transport().pendingCommandIds.length,0);
 assert.ok(s.messages.some(m=>m.type==='ack'&&queued.type==='ack'&&m.commandId===queued.commandId&&m.status==='rejected'));
 const undo=s.send({type:'undo'});assert.ok(undo.type==='ack'&&undo.status==='rejected'&&undo.reason?.includes('Nothing'));
 s.send({type:'stop-recording'});s.send({type:'record',target:kick},'next-beat');s.render(SR);
 assert.equal(s.core.transport().recordingEpoch,epoch!+1);assert.equal(s.core.transport().captureErasure,undefined);
});
test('wrapped melody erases the whole note while unrelated pending notes survive', {skip:!ready},async()=>{
 const s=await setup();s.record({trackId:'synth-1'});s.render(SR*7);
 const queued=s.batch([s.note('old-wrap',62,4),s.note('good-note',66,2)]);
 s.send({type:'erase-event',target:{trackId:'synth-1'},step:0});
 assert.deepEqual(s.core.getSession().tracks[0].notes.map(n=>n.id),['keep-note']);
 assert.deepEqual(s.core.getSession().tracks[1].notes.map(n=>n.id),['other-track']);
 s.render(LOOP);assert.ok(queued.type==='ack');
 assert.deepEqual(s.core.getSession().tracks[0].notes.map(n=>n.id).sort(),['good-note','keep-note']);
 s.send({type:'stop-recording'});s.send({type:'undo'});
 assert.ok(s.core.getSession().tracks[0].notes.some(n=>n.id==='keep-note'));
});
test('committed erase is one Undo entry and unrelated track erasure preserves active capture', {skip:!ready},async()=>{
 const s=await setup();const original=s.core.getSession();
 s.send({type:'erase-event',target:{trackId:'synth-1'},step:0});s.send({type:'undo'});
 assert.deepEqual(s.core.getSession().tracks,original.tracks);
 s.record(kick);s.render(SR);const epoch=s.core.transport().recordingEpoch;
 s.batch([s.hit('unrelated-capture',20)]);s.send({type:'erase-event',target:{trackId:'synth-1'},step:0});s.render(LOOP);
 assert.ok(s.core.getSession().tracks[3].hits.some(h=>h.id==='unrelated-capture'));assert.equal(s.core.transport().recordingEpoch,epoch);
});
test('erase does not rebase an already-stale capture batch or replay queued whole-pattern replacement', {skip:!ready},async()=>{
 const s=await setup();s.record(kick);s.render(SR);const queued=s.batch([s.hit('stale-input',20)]);
 s.send({type:'mute',trackId:'synth-2',muted:true});
 const track=s.core.getSession().tracks[3];const pattern=s.send({type:'edit-pattern',trackId:'drums',notes:[],hits:track.hits},'next-loop');
 s.send({type:'erase-event',target:kick,step:18});s.render(LOOP);
 assert.ok(!s.core.getSession().tracks[3].hits.some(h=>h.id==='stale-input'||h.id==='erase-kick'));
 assert.ok(s.messages.some(m=>m.type==='ack'&&queued.type==='ack'&&m.commandId===queued.commandId&&m.status==='rejected'&&m.reason?.includes('Stale')));
 assert.ok(s.messages.some(m=>m.type==='ack'&&pattern.type==='ack'&&m.commandId===pattern.commandId&&m.status==='rejected'&&m.reason?.includes('targeted erase')));
});
test('sounding melody releases only the erased current note, not another track or a future same-pitch note', {skip:!ready},async()=>{
 const s=await setup();s.send({type:'metronome',enabled:false});const loaded=s.core.getSession();
 loaded.tracks[0].notes=[{id:'sounding',step:0,duration:8,midi:60,velocity:.8},{id:'future',step:16,duration:4,midi:60,velocity:.8}];
 s.send({type:'load-session',session:loaded},'next-loop');s.send({type:'play',playing:true});s.render(4410);
 s.send({type:'erase-event',target:{trackId:'synth-1'},step:16});assert.equal(s.calls.length,0);
 s.send({type:'erase-event',target:{trackId:'synth-1'},step:1});assert.deepEqual(s.calls,[[0,60]]);
 assert.deepEqual(s.core.getSession().tracks[1].notes,loaded.tracks[1].notes);
 assert.ok(s.render(SR/2).some(v=>v!==0),'other track continues to sound');
});
test('stale, invalid-lane, wrong-boundary and old-asset requests leave music untouched', {skip:!ready},async()=>{
 const s=await setup(true,false),before=s.core.getSession();
 const unavailable=s.send({type:'erase-event',target:{trackId:'synth-1'},step:0});assert.ok(unavailable.type==='ack'&&unavailable.status==='rejected'&&unavailable.reason?.includes('Rebuild'));
 const lane=s.send({type:'erase-event',target:{trackId:'drums'},step:18});assert.ok(lane.type==='ack'&&lane.status==='rejected');
 const wrong=s.send({type:'erase-event',target:kick,step:18},'next-loop');assert.ok(wrong.type==='ack'&&wrong.status==='rejected');
 const stale=s.core.dispatch({id:'stale',expectedRevision:99,boundary:'immediate',operation:{type:'erase-event',target:kick,step:18}});assert.ok(stale.type==='ack'&&stale.status==='rejected');
 assert.deepEqual(s.core.getSession(),before);
});
