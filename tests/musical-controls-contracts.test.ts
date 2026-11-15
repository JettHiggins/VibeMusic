import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ClientMessage,ServerMessage,SessionState,SessionCommand,createSession,snapMidiToScale,type PitchSnap} from '../packages/contracts/src/index.ts';
const examples=JSON.parse(readFileSync('packages/contracts/fixtures/MusicalControls.json','utf8'));
test('published control fixtures validate in the right direction and old sessions remain Off',()=>{
 for(const example of examples){
  const server=['command','browser-action'].includes(example.type);
  assert.ok((server?ServerMessage:ClientMessage).safeParse(example).success);
  assert.equal((server?ClientMessage:ServerMessage).safeParse(example).success,false);
 }
 const old=JSON.parse(readFileSync('packages/contracts/fixtures/SessionState.json','utf8'));
 assert.ok(SessionState.safeParse(old).success);assert.equal(SessionState.parse(old).pitchSnap,undefined);
 assert.ok(SessionState.safeParse({...createSession(),pitchSnap:null}).success);
 for(const pitchSnap of [{root:12,scale:'major'},{root:.5,scale:'major'},{root:0,scale:'blues'},{root:0,scale:'minor',enabled:true}])assert.equal(SessionState.safeParse({...createSession(),pitchSnap}).success,false);
 const settings=examples.find((e:{type:string;command?:{operation:{type:string}}})=>e.command?.operation.type==='set-pitch-snap').command;
 assert.equal(SessionCommand.safeParse({...settings,operation:{type:'set-pitch-snap',settings:{root:-1,scale:'minor'}}}).success,false);
 assert.equal(SessionCommand.safeParse({...settings,operation:{type:'snap-notes',trackId:'drums'}}).success,false);
});
test('browser actions are strict local orchestration with bounded offset and scoped cancellation',()=>{
 const action=examples.find((e:{type:string})=>e.type==='browser-action');
 for(const fields of [{expectedInputRevision:-1},{clockId:''},{expectedRevision:1},{operation:{type:'set-input-offset',milliseconds:151}},{operation:{type:'set-input-offset',milliseconds:.5}},{operation:{type:'set-input-profile',profile:'automatic'}},{operation:{type:'cancel-input-action'}},{operation:{type:'apply-patch',trackId:'synth-1'}}])assert.equal(ServerMessage.safeParse({...action,...fields}).success,false);
 assert.equal(SessionCommand.safeParse({id:'bad',expectedRevision:0,boundary:'immediate',operation:action.operation}).success,false,'calibration must not reach the audio engine');
 const ack=examples.find((e:{type:string})=>e.type==='browser-action-ack');
 assert.equal(ClientMessage.safeParse({...ack,status:'applied'}).success,false);
 assert.equal(ClientMessage.safeParse({...ack,clockId:''}).success,false);
});
test('shared pitch mapping is deterministic, bounded, nearest and idempotent across every key and MIDI pitch',()=>{
 const scales={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]} as const;
 for(const scale of ['major','minor'] as const)for(let root=0;root<12;root++)for(let midi=0;midi<128;midi++){
  const settings:PitchSnap={root,scale},allowed=Array.from({length:128},(_,i)=>i).filter(n=>(scales[scale] as readonly number[]).includes(((n-root)%12+12)%12));
  const best=allowed.reduce((a,b)=>Math.abs(b-midi)<Math.abs(a-midi)?b:a);
  const actual=snapMidiToScale(midi,settings);assert.equal(actual,best);assert.equal(snapMidiToScale(actual,settings),actual);
  assert.equal(snapMidiToScale(midi,null),midi);assert.equal(snapMidiToScale(midi),midi);
 }
 assert.equal(snapMidiToScale(61,{root:0,scale:'major'}),60,'equal distance goes down');
 assert.equal(snapMidiToScale(0,{root:1,scale:'major'}),0,'C is in C-sharp major as B-sharp');
 for(const midi of [-1,128,60.5,NaN])assert.throws(()=>snapMidiToScale(midi),RangeError);
});
