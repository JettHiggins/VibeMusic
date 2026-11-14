import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ClientMessage,SessionCommand,createSession,type AgentAdapter,type BrowserAction,type BrowserActionAdapter,type BrowserActionAck,type BrowserStatus,type ClientMessage as Client,type EngineAdapter,type ServerMessage} from '../packages/contracts/src/index.ts';
import {SessionCoordinator} from '../apps/web/src/integration/coordinator.ts';
import {supportsBrowserActions} from '../apps/web/src/integration/browser-actions.ts';
class Engine implements EngineAdapter{
 state=createSession();commands:SessionCommand[]=[];listeners=new Set<(m:Client)=>void>();
 async initialize(){}getSession(){return structuredClone(this.state);}dispose(){this.listeners.clear();}
 dispatch(c:SessionCommand):Client{this.commands.push(SessionCommand.parse(c));return {type:'ack',commandId:c.id,status:'applied',revision:this.state.revision};}
 subscribe(fn:(m:Client)=>void){this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};}
 clock(clockId='clock-1'){this.listeners.forEach(fn=>fn({type:'transport',transport:{clockId,sampleRate:44100,currentFrame:128,loopStartFrame:0,playing:false,recording:false,recordingState:'idle',pendingCommandIds:[]}}));}
}
class Agent implements AgentAdapter{
 sent:Client[]=[];listeners=new Set<(m:ServerMessage)=>void>();
 send(m:Client){this.sent.push(ClientMessage.parse(m));}subscribe(fn:(m:ServerMessage)=>void){this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};}
 emit(m:ServerMessage){this.listeners.forEach(fn=>fn(m));}dispose(){this.listeners.clear();}
}
class Input implements BrowserActionAdapter{
 status:BrowserStatus={type:'browser-status',clockId:'clock-1',inputRevision:2,available:true,microphone:'on',profile:'noisy-room',calibration:null,activeAction:null};
 actions:BrowserAction[]=[];cancelled:string[]=[];listeners=new Set<(m:BrowserStatus|BrowserActionAck)=>void>();past:((m:BrowserStatus|BrowserActionAck)=>void)[]=[];
 getBrowserStatus(){return structuredClone(this.status);}handleBrowserAction(m:BrowserAction){this.actions.push(m);}
 subscribeBrowserActions(fn:(m:BrowserStatus|BrowserActionAck)=>void){this.listeners.add(fn);this.past.push(fn);return ()=>{this.listeners.delete(fn);};}
 cancelBrowserActions(reason:string){this.cancelled.push(reason);}
 emit(m:BrowserStatus|BrowserActionAck){this.listeners.forEach(fn=>fn(m));}
}
function setup(input:Input|null=new Input()){
 const engine=new Engine(),agent=new Agent(),errors:string[]=[];let online=false;
 const coordinator=new SessionCoordinator(engine,agent,()=>online);coordinator.onError=e=>errors.push(e.message);
 coordinator.setBrowserActionAdapter(input);engine.clock();
 const connect=()=>{online=true;coordinator.connectionChanged(true);};
 const disconnect=()=>{online=false;coordinator.connectionChanged(false);};
 return {engine,agent,input,coordinator,errors,connect,disconnect};
}
const action=(id='a1',clockId='clock-1'):BrowserAction=>({type:'browser-action',id,clockId,expectedInputRevision:2,operation:{type:'calibrate-input',mode:'noise'}});
const ack=(id='a1',status:BrowserActionAck['status']='complete'):BrowserActionAck=>({type:'browser-action-ack',id,clockId:'clock-1',inputRevision:3,status});
test('connection advertises real input state after engine context, and forwards only actual executor outcomes',()=>{
 const s=setup(),input=s.input!;assert.ok(supportsBrowserActions(input));assert.equal(supportsBrowserActions({getBrowserStatus:()=>input.status}),false);
 s.connect();assert.deepEqual(s.agent.sent.map(m=>m.type),['session','transport','browser-status']);
 const before=s.engine.getSession();s.agent.emit(action());assert.equal(input.actions.length,1);
 assert.equal(s.agent.sent.filter(m=>m.type==='browser-action-ack').length,0,'submission is not success');
 input.emit(ack('a1','running'));input.status={...input.status,inputRevision:3};input.emit(input.status);input.emit(ack());
 assert.deepEqual(s.agent.sent.slice(-3).map(m=>m.type),['browser-action-ack','browser-status','browser-action-ack']);
 assert.deepEqual(s.engine.commands,[],'calibration is not a musical command');assert.deepEqual(s.engine.getSession(),before);assert.deepEqual(s.errors,[]);
 s.coordinator.dispose();
});
test('an absent executor rejects honestly without advertising a fake measurement or touching music',()=>{
 const s=setup(null);s.connect();s.agent.emit(action());
 const result=s.agent.sent.at(-1);assert.ok(result?.type==='browser-action-ack'&&result.status==='rejected'&&result.reason?.includes('unavailable'));
 assert.equal(s.agent.sent.some(m=>m.type==='browser-status'),false);assert.equal(s.engine.commands.length,0);s.coordinator.dispose();
});
test('disconnect cancels agent-owned work, drops old completions and never replays an action on reconnect',()=>{
 const s=setup(),input=s.input!;s.connect();s.agent.emit(action());const oldListener=input.past[0];
 s.disconnect();assert.deepEqual(input.cancelled,['Agent disconnected']);const before=s.agent.sent.length;
 oldListener(ack());assert.equal(s.agent.sent.length,before);s.connect();
 assert.equal(input.actions.length,1);assert.equal(s.agent.sent.at(-1)?.type,'browser-status','new socket receives status even when unchanged');
 oldListener(ack());input.emit(ack());assert.equal(s.agent.sent.filter(m=>m.type==='browser-action-ack').length,0);
 s.agent.emit(action());assert.equal(input.actions.length,1,'an ID from the old socket cannot start new work');
 assert.ok(s.agent.sent.at(-1)?.type==='browser-action-ack');s.coordinator.dispose();
});
test('adapter replacement rejects pending work and old callbacks cannot finish a new action',()=>{
 const s=setup(),old=s.input!;s.connect();s.agent.emit(action());const oldListener=old.past[0],replacement=new Input();replacement.status.inputRevision=4;
 s.coordinator.setBrowserActionAdapter(replacement);
 assert.ok(s.agent.sent.some(m=>m.type==='browser-action-ack'&&m.id==='a1'&&m.status==='rejected'));
 assert.equal(old.cancelled.length,1);const before=s.agent.sent.length;oldListener(ack());assert.equal(s.agent.sent.length,before);
 s.agent.emit({...action('new'),expectedInputRevision:4});assert.equal(replacement.actions.length,1);
 replacement.emit({...ack('new'),inputRevision:4});assert.ok(s.agent.sent.at(-1)?.type==='browser-action-ack');s.coordinator.dispose();
});
test('status is schema-checked, monotonic and clock-scoped; changed engine clock is sent first',()=>{
 const s=setup(),input=s.input!;s.connect();const before=s.agent.sent.length;
 input.emit(input.status);assert.equal(s.agent.sent.length,before,'unchanged status is not streamed repeatedly');
 input.emit({...input.status,inputRevision:1});assert.equal(s.agent.sent.length,before);assert.ok(s.errors.some(e=>e.includes('backwards')));
 input.emit({...input.status,clockId:'old-clock'});assert.equal(s.agent.sent.length,before);
 input.status={...input.status,clockId:'clock-2',inputRevision:0};s.engine.clock('clock-2');
 assert.deepEqual(s.agent.sent.slice(-2).map(m=>m.type),['transport','browser-status']);
 input.emit({...input.status,inputRevision:-1});assert.ok(s.errors.some(e=>e.includes('Invalid browser input response')));s.coordinator.dispose();
});
test('throwing handlers report rejection, conflicting IDs cannot replace pending work, and disposal detaches all listeners',()=>{
 const s=setup(),input=s.input!;s.connect();s.agent.emit(action());
 s.agent.emit({...action(),operation:{type:'set-input-offset',milliseconds:10}});assert.equal(input.actions.length,1);
 assert.ok(s.agent.sent.some(m=>m.type==='browser-action-ack'&&m.status==='rejected'&&m.reason?.includes('reused')));
 input.handleBrowserAction=()=>{throw new Error('device lost');};s.agent.emit(action('error'));
 assert.ok(s.agent.sent.some(m=>m.type==='browser-action-ack'&&m.id==='error'&&m.status==='rejected'&&m.reason?.includes('device lost')));
 s.coordinator.dispose();const before=s.agent.sent.length;input.emit(ack());s.agent.emit(action('late'));assert.equal(s.agent.sent.length,before);
 assert.equal(input.listeners.size,0);assert.equal(s.engine.listeners.size,0);assert.equal(s.agent.listeners.size,0);
});
test('an executor error after a terminal result cannot contradict the already reported outcome',()=>{
 const s=setup(),input=s.input!;s.connect();input.handleBrowserAction=request=>{input.emit(ack(request.id));throw new Error('cleanup failed');};
 s.agent.emit(action());assert.deepEqual(s.agent.sent.filter(m=>m.type==='browser-action-ack').map(m=>m.type==='browser-action-ack'&&m.status),['complete']);
 assert.ok(s.errors.some(e=>e.includes('after settling')));s.coordinator.dispose();
});
