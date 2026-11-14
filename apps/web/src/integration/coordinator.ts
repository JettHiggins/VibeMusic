import type {EngineAdapter,AgentAdapter,ClientMessage,ServerMessage,Transport} from '@voicesynth/contracts';
/** The engine owns session state; the service only proposes changes. */
export class SessionCoordinator {
 private transport:Transport|null=null;
 private disposed=false;
 private recordIntents=new Map<string,'pending'|'applied'>();
 private cleanups:(()=>void)[];
 onMessage:(message:ServerMessage)=>void=()=>{};
 onError:(error:Error)=>void=()=>{};
 constructor(private engine:EngineAdapter,private agent:AgentAdapter,private connected:()=>boolean){
  this.cleanups=[engine.subscribe(m=>{
   if(m.type==='transport'){
    this.transport=m.transport;
    if(m.transport.recordingState==='idle')for(const [id,status] of this.recordIntents)if(status==='applied')this.recordIntents.delete(id);
   }
   if(m.type==='ack'&&this.recordIntents.has(m.commandId)){
    if(m.status==='rejected')this.recordIntents.delete(m.commandId);
    else if(m.status==='applied')this.recordIntents.set(m.commandId,'applied');
   }
   if(['session','transport','ack'].includes(m.type)&&connected())this.send(m);
  }),agent.subscribe(m=>{
   if(m.type==='command'){
    if(m.command.operation.type==='record')this.recordIntents.set(m.command.id,'pending');
    try{
     const receipt=engine.dispatch(m.command);
     // Successful submission receipts are not authoritative audio-thread acknowledgments.
     if(receipt.type==='ack'&&receipt.status==='rejected'){this.recordIntents.delete(m.command.id);this.send(receipt);}
    }catch(error){this.recordIntents.delete(m.command.id);this.send({type:'ack',commandId:m.command.id,status:'rejected',revision:engine.getSession().revision,reason:String(error)});}
   }
   this.onMessage(m);
  })];
 }
 connectionChanged(connected:boolean){
  if(this.disposed)return;
  if(connected){this.sync();return;}
  if(this.recordIntents.size||this.transport?.recording||this.transport?.recordingState==='armed'){
   this.engine.dispatch({id:crypto.randomUUID(),expectedRevision:this.engine.getSession().revision,boundary:'immediate',operation:{type:'stop-recording'}});
  }
 }
 get captureAllowed(){return !this.disposed&&this.connected()&&this.transport?.recording===true;}
 sync(){this.send({type:'session',session:this.engine.getSession()});if(this.transport)this.send({type:'transport',transport:this.transport});}
 private send(message:ClientMessage){try{this.agent.send(message);}catch(error){this.onError(new Error(String(error)));}}
 /** Transcript-level seam only. Real speech capture supplies measured span frames. */
 submitTranscript(text:string){
  if(!this.transport)throw new Error('Enable audio and wait for its clock before sending a transcript');
  if(!this.connected())throw new Error('Connect the agent first');
  this.agent.send({type:'utterance',id:crypto.randomUUID(),text,clockId:this.transport.clockId,startFrame:this.transport.currentFrame,endFrame:this.transport.currentFrame,duringRecording:this.transport.recording});
 }
 dispose(){this.disposed=true;this.recordIntents.clear();this.cleanups.forEach(off=>off());this.cleanups=[];}
}
