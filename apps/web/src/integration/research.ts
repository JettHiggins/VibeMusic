import type {AgentAdapter,ClientMessage,EngineAdapter,PatchCandidate,ResearchContext,ServerMessage,SessionCommand,SessionState} from '@voicesynth/contracts';
import {CandidatePreviewPlayer,type PreviewAudio,type PreviewState} from './preview.ts';
type ResearchMessage=Extract<ServerMessage,{type:'research'}>;
export interface ResearchState {
 jobId:string|null;trackId:SessionState['selected']['trackId']|null;description:string;
 status:'idle'|ResearchMessage['status'];progress:number;candidates:PatchCandidate[];error:string|null;
 acceptance:{commandId:string;candidateId:string;status:'queued'|'applied'|'rejected';reason?:string}|null;
 preview:PreviewState|null;
}
/** Browser-side research controls. Original track, exact candidate and connection stay bound. */
export class ResearchController {
 private state:ResearchState={jobId:null,trackId:null,description:'',status:'idle',progress:0,candidates:[],error:null,acceptance:null,preview:null};
 private listeners=new Set<()=>void>();
 private cleanups:(()=>void)[];
 private seenJobs=new Map<string,string>();
 private pendingUi:string|null=null;
 private pendingPatches=new Set<string>();
 private enabled=false;
 private disposed=false;
 private player:CandidatePreviewPlayer;
 constructor(private engine:EngineAdapter,private agent:AgentAdapter,private connected:()=>boolean,private newId:()=>string=()=>crypto.randomUUID(),createAudio?:(url:string)=>PreviewAudio){
  this.player=new CandidatePreviewPlayer(message=>{if(!this.disposed&&this.connected())try{this.agent.send(message);}catch{/* No buffering across connections. */}},preview=>{this.state={...this.state,preview};this.changed();},createAudio);
  this.cleanups=[agent.subscribe(m=>this.handle(m)),engine.subscribe(m=>this.commandReceipt(m))];
 }
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 setAudioEnabled(enabled:boolean){if(this.disposed)return;this.enabled=enabled;if(!enabled)this.player.stop('Enable audio before previewing',true);}
 private remember(id:string,binding:string){
  if(this.seenJobs.size>=256)throw new Error('Search history limit reached; reconnect before another search');
  if(this.seenJobs.has(id))throw new Error('Search ID has already been used');
  this.seenJobs.set(id,binding);
 }
 private cancelJob(jobId:string){try{if(this.connected())this.agent.send({type:'cancel-job',jobId});}catch{/* No replay on reconnect. */}}
 request(trackId:SessionState['selected']['trackId'],description:string){
  if(this.disposed)throw new Error('Research controls are closed');
  if(!this.connected())throw new Error('Connect the local agent first');
  if(trackId==='drums')throw new Error('Sound research currently targets synth tracks');
  if(!description.trim())throw new Error('Describe the sound first');
  if(this.pendingPatches.size)throw new Error('Wait for the pending sound change before starting another search');
  const id=this.newId();this.remember(id,JSON.stringify(['ui',trackId,description.trim()]));
  if(this.state.status==='running'&&this.state.jobId)this.cancelJob(this.state.jobId);
  this.player.stop('Preview search was replaced',true);this.pendingUi=id;
  this.state={jobId:id,trackId,description:description.trim(),status:'running',progress:0,candidates:[],error:null,acceptance:null,preview:null};this.changed();
  try{this.agent.send({type:'sound-request',id,trackId,description:description.trim()});}
  catch(error){this.pendingUi=null;this.state={...this.state,status:'failed',error:String(error)};this.changed();throw error;}
 }
 cancel(){if(this.state.status==='running'&&this.state.jobId)this.cancelJob(this.state.jobId);}
 connectionChanged(connected:boolean){
  if(this.disposed)return;
  if(!connected){
   this.player.reset();this.pendingUi=null;this.seenJobs.clear();
   if(this.state.jobId){this.state={...this.state,jobId:null,candidates:[],status:'failed',error:'Agent disconnected; search stopped. Reconnect and start a new search.'};this.changed();}
  }
 }
 /** Called before dispatch by SessionCoordinator; no musical operation is changed. */
 prepareCommand(command:SessionCommand){
  if(this.disposed)return command;
  if(command.operation.type==='apply-patch'){
   this.pendingPatches.add(command.id);
   const operation=command.operation;
   const candidate=this.state.trackId===operation.trackId?this.state.candidates.find(c=>JSON.stringify(c.patch)===JSON.stringify(operation.patch)):undefined;
   if(candidate&&this.state.acceptance?.status!=='queued'){
    this.state={...this.state,acceptance:{commandId:command.id,candidateId:candidate.id,status:'queued'}};this.changed();
   }
  }
  return command;
 }
 /** Includes synchronous rejection receipts; queued submission alone never proves application. */
 commandReceipt(message:ClientMessage){
  if(message.type!=='ack')return;
  if(message.status!=='queued')this.pendingPatches.delete(message.commandId);
  if(message.commandId===this.state.acceptance?.commandId){
   this.state={...this.state,acceptance:{...this.state.acceptance,status:message.status,...(message.reason?{reason:message.reason}:{})}};this.changed();
  }
 }
 accept(candidateId:string){
  if(this.disposed)throw new Error('Research controls are closed');
  const candidate=this.state.candidates.find(c=>c.id===candidateId),trackId=this.state.trackId;
  if(!candidate||!trackId)throw new Error('Candidate is no longer available');
  if(this.pendingPatches.size)throw new Error('A sound change is already queued');
  const command=this.prepareCommand({id:this.newId(),expectedRevision:this.engine.getSession().revision,boundary:'immediate',operation:{type:'apply-patch',trackId,patch:structuredClone(candidate.patch)}});
  try{const receipt=this.engine.dispatch(command);if(receipt.type==='ack'&&receipt.status==='rejected')this.commandReceipt(receipt);}
  catch(error){this.commandReceipt({type:'ack',commandId:command.id,status:'rejected',revision:this.engine.getSession().revision,reason:String(error)});}
 }
 preview(candidateId:string){
  if(this.disposed)throw new Error('Research controls are closed');
  if(!this.connected())throw new Error('Connect the local agent first');
  if(!this.enabled)throw new Error('Enable audio before previewing');
  const candidate=this.state.candidates.find(c=>c.id===candidateId);
  if(!this.state.jobId||!candidate?.previewUrl)throw new Error('Candidate preview is no longer available');
  this.player.start(this.state.jobId,candidate);
 }
 stopPreview(){this.player.stop();}
 private context(message:ResearchContext){
  const binding=JSON.stringify([message.requestId,message.trackId,message.description,message.origin]);
  if(this.seenJobs.has(message.jobId))return; // no re-adoption, including ignored/stale contexts
  try{this.remember(message.jobId,binding);}catch(error){this.cancelJob(message.jobId);this.state={...this.state,error:String(error)};this.changed();return;}
  if(this.pendingUi||this.pendingPatches.size){
   // Never drop a spoken search silently (2026-11-15 playtest: no candidates appeared, no reason shown).
   this.cancelJob(message.jobId);
   this.state={...this.state,error:`Skipped the spoken search for "${message.description}": another sound search or sound change was still finishing. Say it again.`};this.changed();return;
  }
  if(this.state.status==='running'&&this.state.jobId)this.cancelJob(this.state.jobId);
  this.player.stop('Preview search was replaced',true);
  this.state={jobId:message.jobId,trackId:message.trackId,description:message.description,status:'running',progress:0,candidates:[],error:null,acceptance:null,preview:null};this.changed();
 }
 private handle(message:ServerMessage){
  if(this.disposed||!this.connected())return;
  if(message.type==='research-context'){this.context(message);return;}
  if(message.type==='candidate-preview'){
   if(!this.player.reserve(message))return;
   const candidate=this.state.candidates.find(c=>c.id===message.candidateId);
   const error=!this.enabled?'Enable audio before previewing':message.jobId!==this.state.jobId||!candidate?'Candidate is no longer displayed':!candidate.previewUrl?'Preview unavailable':null;
   if(error)this.player.reject(message,error);else this.player.start(message.jobId,candidate!,message);
   return;
  }
  if(this.state.status!=='running')return;
  if(message.type==='research'&&message.jobId===this.state.jobId){
   this.pendingUi=null;this.player.candidates(message.jobId,message.candidates);
   this.state={...this.state,status:message.status,progress:message.progress,candidates:message.candidates,error:message.error??null};this.changed();
  }else if(message.type==='error'&&message.requestId===this.state.jobId){
   this.pendingUi=null;this.player.stop('Preview search failed',true);this.state={...this.state,status:'failed',error:message.message};this.changed();
  }
 }
 private changed(){this.listeners.forEach(fn=>fn());}
 dispose(){if(this.disposed)return;this.player.reset();this.disposed=true;this.cleanups.forEach(off=>off());this.cleanups=[];this.listeners.clear();}
}
