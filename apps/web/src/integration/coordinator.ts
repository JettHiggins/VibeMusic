import type {EngineAdapter,AgentAdapter,ClientMessage,ServerMessage,Transport} from '@voicesynth/contracts';
/** The engine owns session state; the service only proposes changes. */
export class SessionCoordinator {
 private transport:Transport|null=null;
 private cleanups:(()=>void)[];
 onMessage:(message:ServerMessage)=>void=()=>{};
 onError:(error:Error)=>void=()=>{};
 constructor(private engine:EngineAdapter,private agent:AgentAdapter,private connected:()=>boolean){
  this.cleanups=[engine.subscribe(m=>{
   if(m.type==='transport')this.transport=m.transport;
   if(['session','transport','ack'].includes(m.type)&&connected())this.send(m);
  }),agent.subscribe(m=>{
   if(m.type==='command'){
    try{
     const receipt=engine.dispatch(m.command);
     // Successful submission receipts are not authoritative audio-thread acknowledgments.
     if(receipt.type==='ack'&&receipt.status==='rejected')this.send(receipt);
    }catch(error){this.send({type:'ack',commandId:m.command.id,status:'rejected',revision:engine.getSession().revision,reason:String(error)});}
   }
   this.onMessage(m);
  })];
 }
 connectionChanged(connected:boolean){
  if(connected){this.sync();return;}
  if(this.transport?.recording||this.transport?.recordingState==='armed'){
   this.engine.dispatch({id:crypto.randomUUID(),expectedRevision:this.engine.getSession().revision,boundary:'immediate',operation:{type:'stop-recording'}});
  }
 }
 get captureAllowed(){return this.connected()&&this.transport?.recording===true;}
 sync(){this.send({type:'session',session:this.engine.getSession()});if(this.transport)this.send({type:'transport',transport:this.transport});}
 private send(message:ClientMessage){try{this.agent.send(message);}catch(error){this.onError(new Error(String(error)));}}
 /** Transcript-level seam only. Real speech capture supplies measured span frames. */
 submitTranscript(text:string){
  if(!this.transport)throw new Error('Enable audio and wait for its clock before sending a transcript');
  if(!this.connected())throw new Error('Connect the agent first');
  this.agent.send({type:'utterance',id:crypto.randomUUID(),text,clockId:this.transport.clockId,startFrame:this.transport.currentFrame,endFrame:this.transport.currentFrame,duringRecording:this.transport.recording});
 }
 dispose(){this.cleanups.forEach(off=>off());this.cleanups=[];}
}
