import type {AgentAdapter,ClientMessage,EngineAdapter,PatchCandidate,ServerMessage,SessionState} from '@voicesynth/contracts';
type ResearchMessage=Extract<ServerMessage,{type:'research'}>;
export interface ResearchState {
 jobId:string|null;trackId:SessionState['selected']['trackId']|null;description:string;
 status:'idle'|ResearchMessage['status'];progress:number;candidates:PatchCandidate[];error:string|null;
 acceptance:{commandId:string;candidateId:string;status:'queued'|'applied'|'rejected';reason?:string}|null;
}
/** Browser-side research controls. The original track and exact candidate stay bound to each action. */
export class ResearchController {
 private state:ResearchState={jobId:null,trackId:null,description:'',status:'idle',progress:0,candidates:[],error:null,acceptance:null};
 private listeners=new Set<()=>void>();
 private cleanups:(()=>void)[];
 constructor(private engine:EngineAdapter,private agent:AgentAdapter,private connected:()=>boolean,private newId:()=>string=()=>crypto.randomUUID()){
  this.cleanups=[agent.subscribe(m=>this.handle(m)),engine.subscribe(m=>{
   if(m.type==='ack'&&m.commandId===this.state.acceptance?.commandId){
    this.state={...this.state,acceptance:{...this.state.acceptance,status:m.status,...(m.reason?{reason:m.reason}:{})}};this.changed();
   }
  })];
 }
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 request(trackId:SessionState['selected']['trackId'],description:string){
  if(!this.connected())throw new Error('Connect the local agent first');
  if(trackId==='drums')throw new Error('Sound research currently targets synth tracks');
  if(!description.trim())throw new Error('Describe the sound first');
  if(this.state.acceptance?.status==='queued')throw new Error('Wait for the pending sound change before starting another search');
  if(this.state.status==='running'&&this.state.jobId)this.agent.send({type:'cancel-job',jobId:this.state.jobId});
  const id=this.newId();
  this.state={jobId:id,trackId,description:description.trim(),status:'running',progress:0,candidates:[],error:null,acceptance:null};this.changed();
  try{this.agent.send({type:'sound-request',id,trackId,description:description.trim()});}
  catch(error){this.state={...this.state,status:'failed',error:String(error)};this.changed();throw error;}
 }
 cancel(){if(this.state.status==='running'&&this.state.jobId)this.agent.send({type:'cancel-job',jobId:this.state.jobId});}
 connectionChanged(connected:boolean){
  if(!connected&&this.state.status==='running'){
   this.state={...this.state,status:'failed',error:'Agent disconnected; search stopped. Reconnect and start a new search.'};this.changed();
  }
 }
 accept(candidateId:string){
  const candidate=this.state.candidates.find(c=>c.id===candidateId),trackId=this.state.trackId;
  if(!candidate||!trackId)throw new Error('Candidate is no longer available');
  if(this.state.acceptance?.status==='queued')throw new Error('A sound change is already queued');
  const commandId=this.newId();
  this.state={...this.state,acceptance:{commandId,candidateId,status:'queued'}};this.changed();
  // Copy the displayed candidate now: later ranking updates cannot change which sound was chosen.
  try{
   const receipt=this.engine.dispatch({id:commandId,expectedRevision:this.engine.getSession().revision,boundary:'next-loop',operation:{type:'apply-patch',trackId,patch:structuredClone(candidate.patch)}});
   if(receipt.type==='ack'&&receipt.status==='rejected')this.rejection(receipt);
  }catch(error){this.rejection({type:'ack',commandId,status:'rejected',revision:this.engine.getSession().revision,reason:String(error)});}
 }
 private rejection(ack:Extract<ClientMessage,{type:'ack'}>){
  if(this.state.acceptance?.commandId===ack.commandId){this.state={...this.state,acceptance:{...this.state.acceptance,status:'rejected',reason:ack.reason}};this.changed();}
 }
 private handle(message:ServerMessage){
  if(this.state.status!=='running')return;
  if(message.type==='research'&&message.jobId===this.state.jobId){this.state={...this.state,status:message.status,progress:message.progress,candidates:message.candidates,error:message.error??null};this.changed();}
  else if(message.type==='error'&&message.requestId===this.state.jobId){this.state={...this.state,status:'failed',error:message.message};this.changed();}
 }
 private changed(){this.listeners.forEach(fn=>fn());}
 dispose(){this.cleanups.forEach(off=>off());this.cleanups=[];this.listeners.clear();}
}
