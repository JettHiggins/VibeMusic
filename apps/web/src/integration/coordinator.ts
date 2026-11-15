import type {EngineAdapter,AgentAdapter,ClientMessage,ServerMessage,Transport,SessionCommand,BrowserActionAdapter} from '@voicesynth/contracts';
import {BrowserActionRouter} from './browser-actions.ts';
/** The engine owns session state; the service only proposes changes. */
export class SessionCoordinator {
 private transport:Transport|null=null;
 private disposed=false;
 private recordIntents=new Map<string,'pending'|'applied'>();
 private cleanups:(()=>void)[];
 private browserActions:BrowserActionRouter;
 onMessage:(message:ServerMessage)=>void=()=>{};
 onError:(error:Error)=>void=()=>{};
 prepareCommand:(command:SessionCommand)=>SessionCommand=command=>command;
 onReceipt:(message:ClientMessage)=>void=()=>{};
 constructor(private engine:EngineAdapter,private agent:AgentAdapter,private connected:()=>boolean){
  this.browserActions=new BrowserActionRouter(m=>this.send(m),connected,()=>this.transport?.clockId,e=>this.onError(e));
  this.cleanups=[engine.subscribe(m=>{
   let inputClockChanged=false;
   if(m.type==='transport'){
    const oldClock=this.transport?.clockId;
    this.transport=m.transport;
    inputClockChanged=oldClock!==m.transport.clockId;
    if(m.transport.recordingState==='idle')for(const [id,status] of this.recordIntents)if(status==='applied')this.recordIntents.delete(id);
   }
   if(m.type==='ack'&&this.recordIntents.has(m.commandId)){
    if(m.status==='rejected')this.recordIntents.delete(m.commandId);
    else if(m.status==='applied')this.recordIntents.set(m.commandId,'applied');
   }
   if(['session','transport','ack'].includes(m.type)&&connected())this.send(m);
   if(inputClockChanged)this.browserActions.syncStatus();
  }),agent.subscribe(m=>{
   if(m.type==='browser-action')this.browserActions.handle(m);
   if(m.type==='command'){
    if(m.command.operation.type==='record')this.recordIntents.set(m.command.id,'pending');
    try{
     const receipt=engine.dispatch(this.prepareCommand(m.command));
     this.reportReceipt(receipt);
     // Successful submission receipts are not authoritative audio-thread acknowledgments.
     if(receipt.type==='ack'&&receipt.status==='rejected'){this.recordIntents.delete(m.command.id);this.send(receipt);}
    }catch(error){this.recordIntents.delete(m.command.id);const receipt:ClientMessage={type:'ack',commandId:m.command.id,status:'rejected',revision:engine.getSession().revision,reason:String(error)};this.reportReceipt(receipt);this.send(receipt);}
   }
   this.onMessage(m);
  })];
 }
 connectionChanged(connected:boolean){
  if(this.disposed)return;
  if(connected){this.sync();this.browserActions.connectionChanged(true);return;}
  this.browserActions.connectionChanged(false);
  if(this.recordIntents.size||this.transport?.recording||this.transport?.recordingState==='armed'){
   this.engine.dispatch({id:crypto.randomUUID(),expectedRevision:this.engine.getSession().revision,boundary:'immediate',operation:{type:'stop-recording'}});
  }
 }
 get captureAllowed(){return !this.disposed&&this.connected()&&this.transport?.recording===true;}
 setBrowserActionAdapter(input:BrowserActionAdapter|null){this.browserActions.setAdapter(input);}
 sync(){this.send({type:'session',session:this.engine.getSession()});if(this.transport)this.send({type:'transport',transport:this.transport});this.browserActions.syncStatus();}
 private reportReceipt(message:ClientMessage){try{this.onReceipt(message);}catch(error){this.onError(new Error(String(error)));}}
 private send(message:ClientMessage){try{this.agent.send(message);}catch(error){this.onError(new Error(String(error)));}}
 /** Transcript-level seam only. Real speech capture supplies measured span frames. */
 submitTranscript(text:string){
  if(!this.transport)throw new Error('Enable audio and wait for its clock before sending a transcript');
  if(!this.connected())throw new Error('Connect the agent first');
  this.agent.send({type:'utterance',id:crypto.randomUUID(),text,clockId:this.transport.clockId,startFrame:this.transport.currentFrame,endFrame:this.transport.currentFrame,duringRecording:this.transport.recording});
 }
 dispose(){this.disposed=true;this.browserActions.dispose();this.recordIntents.clear();this.cleanups.forEach(off=>off());this.cleanups=[];}
}
