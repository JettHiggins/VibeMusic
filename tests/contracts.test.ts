import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SessionState,SessionCommand,PerformanceEvent,PatchCandidate,ClientMessage,ServerMessage,MockEngine,MockAgent} from '../packages/contracts/src/index.ts';
for(const [name,schema] of Object.entries({SessionState,SessionCommand,PerformanceEvent,PatchCandidate,ClientMessage,ServerMessage}))test(`${name} fixture parses`,()=>{schema.parse(JSON.parse(readFileSync(`packages/contracts/fixtures/${name}.json`,'utf8')));});
test('invalid commands cannot carry unchecked fields or invalid tempo',()=>{
 const base={id:'test',expectedRevision:0,boundary:'next-loop'};
 assert.equal(SessionCommand.safeParse({...base,operation:{type:'tempo',bpm:0}}).success,false);
 assert.equal(SessionCommand.safeParse({...base,operation:{type:'undo',shell:'rm'}}).success,false);
});
test('mock rejects stale and unsupported commands without mutating session',()=>{
 const engine=new MockEngine();const before=engine.getSession();
 const stale=engine.dispatch({id:'stale',expectedRevision:1,boundary:'immediate',operation:{type:'select',target:{trackId:'synth-1'}}});
 assert.equal(stale.type,'ack');if(stale.type==='ack')assert.equal(stale.status,'rejected');
 engine.dispatch({id:'unsupported',expectedRevision:0,boundary:'next-loop',operation:{type:'tempo',bpm:140}});
 assert.deepEqual(engine.getSession(),before);
});
test('mock selection publishes acknowledgment and isolates state',()=>{
 const engine=new MockEngine();let count=0;const off=engine.subscribe(()=>count++);
 engine.dispatch({id:'select',expectedRevision:0,boundary:'immediate',operation:{type:'select',target:{trackId:'synth-1'}}});
 assert.equal(engine.getSession().revision,1);assert.equal(count,1);off();
 const external=engine.getSession();external.tempo=200;assert.equal(engine.getSession().tempo,120);
});
test('mock agent explicitly supplies empty research rather than fake audio',()=>{
 const agent=new MockAgent();let received=false;
 agent.subscribe(m=>{ServerMessage.parse(m);assert.equal(m.type,'research');received=true;});
 agent.send({type:'sound-request',id:'search',trackId:'synth-1',description:'electric piano'});assert.ok(received);
});
test('performance-batch fixture and extended transport validate with shared schema',()=>{
 SessionCommand.parse(JSON.parse(readFileSync('packages/contracts/fixtures/PerformanceBatch.json','utf8')));
 ClientMessage.parse({type:'transport',transport:{clockId:'clock',sampleRate:44100,currentFrame:400000,loopStartFrame:352800,playing:true,recording:true,recordingState:'recording',recordingStartFrame:352800,recordingTarget:{trackId:'drums',lane:'kick'},pendingCommandIds:[]}});
});
