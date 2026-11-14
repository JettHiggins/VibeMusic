import type {CandidatePreview,PatchCandidate,PreviewAck} from '@voicesynth/contracts';
export interface PreviewAudio {
 play():Promise<void>;pause():void;release?():void;
 addEventListener(type:string,listener:()=>void):void;
 removeEventListener(type:string,listener:()=>void):void;
}
export interface PreviewState {candidateId:string;status:'starting'|'playing'|'ended'|'stopped'|'failed';reason?:string;}
interface Active {
 request?:CandidatePreview;jobId:string;candidate:PatchCandidate;audio:PreviewAudio;started:boolean;ended:boolean;
 onEnd:()=>void;onError:()=>void;timer:ReturnType<typeof setTimeout>;
}
const MAX_REQUESTS=256;
function browserAudio(url:string):PreviewAudio {
 const audio=new Audio(url);
 return {play:()=>audio.play(),pause:()=>audio.pause(),
  addEventListener:(type,listener)=>audio.addEventListener(type,listener),
  removeEventListener:(type,listener)=>audio.removeEventListener(type,listener),
  release:()=>{audio.removeAttribute('src');audio.load();}};
}
/** One non-mutating preview shared by manual and voice controls. No engine dependency. */
export class CandidatePreviewPlayer {
 private active:Active|null=null;
 private requests=new Map<string,{binding:string;ack?:PreviewAck}>();
 constructor(private ack:(message:PreviewAck)=>void,private changed:(state:PreviewState|null)=>void,
  private createAudio:(url:string)=>PreviewAudio=browserAudio,private startMs=5000,private finishMs=120000){}
 private report(request:CandidatePreview,status:PreviewAck['status'],reason?:string){
  const message:PreviewAck={type:'preview-ack',id:request.id,jobId:request.jobId,candidateId:request.candidateId,status,...(reason?{reason}:{})};
  const entry=this.requests.get(request.id);if(entry)entry.ack=message;
  this.ack(message);
 }
 private binding(request:CandidatePreview){return JSON.stringify([request.jobId,request.candidateId]);}
 /** Returns false for a duplicate/conflicting request; never restarts the audio. */
 reserve(request:CandidatePreview){
  const binding=this.binding(request),old=this.requests.get(request.id);
  if(old){
   if(old.binding!==binding)this.ack({type:'preview-ack',id:request.id,jobId:request.jobId,candidateId:request.candidateId,status:'rejected',reason:'Preview ID already belongs to another candidate'});
   else if(old.ack)this.ack(old.ack);
   return false;
  }
  if(this.requests.size>=MAX_REQUESTS){this.ack({type:'preview-ack',id:request.id,jobId:request.jobId,candidateId:request.candidateId,status:'rejected',reason:'Preview request limit reached; reconnect'});return false;}
  this.requests.set(request.id,{binding});return true;
 }
 reject(request:CandidatePreview,reason:string){this.report(request,'rejected',reason);if(!this.active)this.changed({candidateId:request.candidateId,status:'failed',reason});}
 start(jobId:string,candidate:PatchCandidate,request?:CandidatePreview){
  this.stop('Preview replaced',true);
  let audio:PreviewAudio;
  try{audio=this.createAudio(candidate.previewUrl);}catch{if(request)this.reject(request,'Preview playback unavailable');else this.changed({candidateId:candidate.id,status:'failed',reason:'Preview playback unavailable'});return;}
  const entry={} as Active;
  Object.assign(entry,{request,jobId,candidate:structuredClone(candidate),audio,started:false,ended:false,
   onEnd:()=>{if(this.active!==entry)return;entry.ended=true;if(entry.started)this.ended(entry);},
   onError:()=>{if(this.active===entry)this.stop('Preview playback failed',false);}});
  this.active=entry;
  audio.addEventListener('ended',entry.onEnd);audio.addEventListener('error',entry.onError);
  entry.timer=setTimeout(()=>{if(this.active===entry)this.stop('Preview did not start in time',false);},this.startMs);
  this.changed({candidateId:candidate.id,status:'starting'});
  try{Promise.resolve(audio.play()).then(()=>{
   if(this.active!==entry){audio.pause();audio.release?.();return;}
   entry.started=true;clearTimeout(entry.timer);
   entry.timer=setTimeout(()=>{if(this.active===entry)this.stop('Preview playback timed out',false);},this.finishMs);
   if(request)this.report(request,'started');
   this.changed({candidateId:candidate.id,status:'playing'});
   if(entry.ended)this.ended(entry);
  },()=>{if(this.active===entry)this.stop('Preview playback was blocked or failed',false);});}
  catch{if(this.active===entry)this.stop('Preview playback was blocked or failed',false);}
 }
 private detach(entry:Active){clearTimeout(entry.timer);entry.audio.removeEventListener('ended',entry.onEnd);entry.audio.removeEventListener('error',entry.onError);}
 private ended(entry:Active){
  this.active=null;this.detach(entry);entry.audio.pause();entry.audio.release?.();if(entry.request)this.report(entry.request,'ended');
  this.changed({candidateId:entry.candidate.id,status:'ended'});
 }
 stop(reason='Preview stopped',clear=false){
  const entry=this.active;this.active=null;
  if(entry){this.detach(entry);entry.audio.pause();entry.audio.release?.();if(entry.request)this.report(entry.request,'rejected',reason);
   this.changed(clear?null:{candidateId:entry.candidate.id,status:reason==='Preview stopped'?'stopped':'failed',reason});}
  else if(clear)this.changed(null);
 }
 candidates(jobId:string|null,candidates:PatchCandidate[]){
  const entry=this.active;if(!entry)return;
  const current=candidates.find(c=>c.id===entry.candidate.id);
  if(jobId!==entry.jobId||!current||current.previewUrl!==entry.candidate.previewUrl||JSON.stringify(current.patch)!==JSON.stringify(entry.candidate.patch))this.stop('Preview candidate was replaced',true);
 }
 reset(){this.stop('Preview connection closed',true);this.requests.clear();}
}
