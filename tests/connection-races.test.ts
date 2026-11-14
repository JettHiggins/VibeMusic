import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession,type AgentAdapter,type EngineAdapter,type ClientMessage,type ServerMessage,type SessionCommand} from '../packages/contracts/src/index.ts';
import {SessionCoordinator} from '../apps/web/src/integration/coordinator.ts';
import {WebSocketAgent} from '../apps/web/src/integration/agent.ts';
test('disconnect stops an in-flight record before the first armed transport snapshot',()=>{
 let publishAgent:(message:ServerMessage)=>void=()=>{};
 const commands:SessionCommand[]=[];
 const engine:EngineAdapter={initialize:async()=>{},getSession:createSession,dispatch:c=>{commands.push(c);return {type:'ack',commandId:c.id,status:'queued',revision:0};},subscribe:()=>()=>{},dispose:()=>{}};
 const agent:AgentAdapter={send:()=>{},subscribe:fn=>{publishAgent=fn;return ()=>{};},dispose:()=>{}};
 let connected=true;const bridge=new SessionCoordinator(engine,agent,()=>connected);
 publishAgent({type:'command',command:{id:'record-1',expectedRevision:0,boundary:'next-loop',operation:{type:'record',target:{trackId:'drums',lane:'kick'}}}});
 connected=false;bridge.connectionChanged(false);
 assert.equal(commands.length,2);assert.equal(commands[1].operation.type,'stop-recording');assert.equal(bridge.captureAllowed,false);
 bridge.dispose();bridge.connectionChanged(false);assert.equal(commands.length,2);
});
test('late callbacks from a replaced socket cannot disconnect or send commands into a fresh connection',async()=>{
 class FakeSocket {
  static OPEN=1;static instances:FakeSocket[]=[];
  readyState=0;
  onopen:(()=>void)|null=null;
  onclose:(()=>void)|null=null;
  onerror:(()=>void)|null=null;
  onmessage:((event:{data:string})=>void)|null=null;
  constructor(_url:string){FakeSocket.instances.push(this);}
  send(_data:string){}
  close(){this.readyState=3;}
  open(){this.readyState=1;this.onopen?.();}
 }
 const original=globalThis.WebSocket;
 globalThis.WebSocket=FakeSocket as unknown as typeof WebSocket;
 try{
  const agent=new WebSocketAgent();const statuses:boolean[]=[];const messages:ServerMessage[]=[];const errors:Error[]=[];
  agent.onStatus=status=>statuses.push(status);agent.onError=error=>errors.push(error);
  const firstConnection=agent.connect();const first=FakeSocket.instances[0];first.open();await firstConnection;
  agent.dispose();
  agent.subscribe(message=>messages.push(message));
  const secondConnection=agent.connect();const second=FakeSocket.instances[1];second.open();await secondConnection;
  first.onclose?.();first.onerror?.();first.onmessage?.({data:JSON.stringify({type:'error',requestId:'old',message:'old connection'})});
  assert.deepEqual(statuses,[true,false,true]);assert.equal(agent.connected,true);assert.deepEqual(messages,[]);assert.deepEqual(errors,[]);
  second.onmessage?.({data:JSON.stringify({type:'error',requestId:'new',message:'new connection'})});
  assert.equal(messages.length,1);agent.dispose();
 }finally{globalThis.WebSocket=original;}
});
