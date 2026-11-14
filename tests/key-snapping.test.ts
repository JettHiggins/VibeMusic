import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSession,type ClientMessage,type SessionCommand,type PerformanceEvent} from '../packages/contracts/src/index.ts';
import {EngineCore} from '../apps/web/src/engine/core.ts';
import {PerformanceRecorder} from '../apps/web/src/input/recorder.ts';
const dir='apps/web/public/engine',ready=existsSync(`${dir}/voicesynth.wasm`),SR=44100,LOOP=SR*8;
const major={root:0,scale:'major' as const};
async function setup(){
 const {FirmwareAudio}=await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const dsp=new FirmwareAudio(await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`)));
 const state=createSession();state.tracks[0].notes=[{id:'old',step:0,duration:2,midi:61,velocity:.7}];
 state.tracks[1].notes=[{id:'other',step:4,duration:2,midi:63,velocity:.6}];
 state.tracks[3].hits=[{id:'kick',step:0,lane:'kick',velocity:.8}];
 const messages:ClientMessage[]=[],listeners:((m:ClientMessage)=>void)[]=[];
 const core=new EngineCore(dsp,JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8')),state,'clock',m=>{messages.push(m);listeners.forEach(fn=>fn(m));});
 let frame=0,id=0;
 const send=(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate',revision=core.getSession().revision)=>core.dispatch({id:`key-${++id}`,expectedRevision:revision,boundary,operation});
 const render=(count:number)=>{core.render(new Float32Array(count),new Float32Array(count),frame);frame+=count;listeners.forEach(fn=>fn({type:'transport',transport:core.transport()}));};
 const record=()=>{send({type:'record',target:{trackId:'synth-1'}},'next-beat');render(SR*3);};
 const note=(midi=61):PerformanceEvent=>({kind:'note',id:`input-${++id}`,target:{trackId:'synth-1'},captureFrame:frame-4096,endFrame:frame-1024,clockId:'clock',confidence:1,velocity:.75,midi});
 const batch=(event:PerformanceEvent)=>send({type:'commit-performance',events:[event],excludedSpans:[],verifiedThroughFrame:frame,recordingEpoch:core.transport().recordingEpoch},'next-loop');
 return {core,send,render,record,note,batch,listeners,messages};
}
test('new sung notes snap at commit while existing notes, timing, velocity and drums remain unchanged',{skip:!ready},async()=>{
 const s=await setup(),before=s.core.getSession();s.send({type:'set-pitch-snap',settings:major});
 assert.deepEqual(s.core.getSession().tracks,before.tracks,'enabling does not rewrite music');
 s.record();const epoch=s.core.transport().recordingEpoch,event=s.note();
 const ack=s.batch(event);assert.ok(ack.type==='ack'&&ack.status==='queued');s.render(LOOP);
 const note=s.core.getSession().tracks[0].notes.find(n=>n.id===event.id)!;
 assert.equal(note.midi,60);assert.equal(note.velocity,event.velocity);assert.equal(note.duration,1);
 assert.equal(note.step,Math.round((event.captureFrame-s.core.transport().recordingLoopStartFrame!)/(SR/8))%64);
 assert.equal(s.core.getSession().tracks[0].notes.find(n=>n.id==='old')?.midi,61);
 assert.deepEqual(s.core.getSession().tracks.slice(1),before.tracks.slice(1));
 assert.equal(s.core.transport().recordingEpoch,epoch);assert.equal(s.core.transport().recording,true);
});
test('old sessions and explicit Off preserve chromatic input; enabling/disabling never changes committed notes',{skip:!ready},async()=>{
 const s=await setup();assert.equal(s.core.getSession().pitchSnap,undefined);s.record();
 const event=s.note();s.batch(event);s.render(LOOP);assert.equal(s.core.getSession().tracks[0].notes.find(n=>n.id===event.id)?.midi,61);
 const tracks=s.core.getSession().tracks,transport=s.core.transport();
 s.send({type:'set-pitch-snap',settings:major});s.send({type:'set-pitch-snap',settings:null});
 assert.deepEqual(s.core.getSession().tracks,tracks);assert.equal(s.core.transport().recordingEpoch,transport.recordingEpoch);
 const event2=s.note(63);s.batch(event2);s.render(LOOP);assert.equal(s.core.getSession().tracks[0].notes.find(n=>n.id===event2.id)?.midi,63);
});
test('explicit existing-track snap waits for a loop, changes only pitches, and is one undoable edit',{skip:!ready},async()=>{
 const s=await setup();s.send({type:'set-pitch-snap',settings:major});s.send({type:'play',playing:true});s.render(1024);
 const before=s.core.getSession(),queued=s.send({type:'snap-notes',trackId:'synth-1'},'next-loop');
 assert.ok(queued.type==='ack'&&queued.status==='queued');assert.deepEqual(s.core.getSession().tracks,before.tracks);
 s.render(LOOP);const after=s.core.getSession();assert.deepEqual(after.tracks[0].notes,[{...before.tracks[0].notes[0],midi:60}]);
 assert.deepEqual(after.tracks.slice(1),before.tracks.slice(1));assert.equal(after.revision,before.revision+1);
 s.send({type:'snap-notes',trackId:'synth-1'},'next-loop');s.render(LOOP);assert.equal(s.core.getSession().revision,after.revision,'already-in-scale is no history entry');
 s.send({type:'undo'});assert.deepEqual(s.core.getSession().tracks,before.tracks);assert.deepEqual(s.core.getSession().pitchSnap,major);
});
test('setting no-ops/stale/bad boundaries leave state intact and a real key change cannot extend count-in',{skip:!ready},async()=>{
 const s=await setup(),before=s.core.getSession();
 const off=s.send({type:'snap-notes',trackId:'synth-1'},'next-loop');assert.ok(off.type==='ack'&&off.status==='rejected');
 s.send({type:'set-pitch-snap',settings:null});assert.deepEqual(s.core.getSession(),before);
 s.send({type:'record',target:{trackId:'synth-1'}},'next-beat');const deadline=s.core.transport().armedStartFrame;
 s.render(1000);s.send({type:'set-pitch-snap',settings:major});const chosen=s.core.getSession();
 for(const [boundary,revision] of [['next-loop',chosen.revision],['immediate',chosen.revision-1]] as const){
  const ack=s.send({type:'set-pitch-snap',settings:null},boundary,revision);assert.ok(ack.type==='ack'&&ack.status==='rejected');assert.deepEqual(s.core.getSession(),chosen);
 }
 s.send({type:'set-pitch-snap',settings:major});assert.equal(s.core.getSession().revision,chosen.revision);
 assert.equal(s.core.transport().armedStartFrame,deadline);s.render(SR*2);assert.equal(s.core.transport().recordingStartFrame,deadline);
 const immediate=s.send({type:'snap-notes',trackId:'synth-1'});assert.ok(immediate.type==='ack'&&immediate.status==='rejected');
});
test('real recorder retries queued raw notes across a key change and commits exactly once under the latest key',{skip:!ready},async()=>{
 const s=await setup();let id=0;
 const recorder=new PerformanceRecorder({dispatch:c=>s.core.dispatch(c),newId:()=>`recorded-${++id}`},'manual',{batchLeadSeconds:Infinity});
 s.listeners.push(m=>recorder.handle(m));recorder.handle({type:'session',session:s.core.getSession()});s.record();
 const event=s.note();assert.equal(event.kind,'note');if(event.kind!=='note')return;
 recorder.addNotes([{startFrame:event.captureFrame,endFrame:event.endFrame,midi:event.midi,velocity:event.velocity,confidence:event.confidence}],0,'clock',s.core.transport().currentFrame);
 assert.ok(recorder.status().inFlight);const raw=recorder.status().provisional[0].event;assert.ok(raw.kind==='note');assert.equal(raw.midi,61,'source remains raw');
 s.send({type:'set-pitch-snap',settings:major});s.render(LOOP*2+1);
 assert.equal(recorder.status().committed,1);assert.equal(recorder.status().inFlight,null);
 const newNotes=s.core.getSession().tracks[0].notes.filter(n=>n.id.startsWith('recorded-'));assert.equal(newNotes.length,1);assert.equal(newNotes[0].midi,60);
 assert.ok(s.messages.some(m=>m.type==='ack'&&m.status==='rejected'&&m.reason?.includes('Stale revision')));
});
