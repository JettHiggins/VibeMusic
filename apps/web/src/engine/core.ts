import { AuditionEvent, SessionCommand, type SessionState, type ClientMessage, type Transport } from '@voicesynth/contracts';
import type { FirmwareMetadata } from './metadata.ts';
import {OutputTransition} from './output-transition.ts';
import { firmwareSnapshot } from './snapshot.ts';
import {commitPerformance,type RecordingWindow} from './performance.ts';
export interface FirmwareBridge {
 w: { memory: WebAssembly.Memory; vs_playing(): number; vs_beat(): number; vs_phase(): number; vs_render(frames:number): number; preview_play(on:number): number; preview_panic(): number; vs_note(track:number,note:number,velocity:number,on:number): number };
 sync(state: ReturnType<typeof firmwareSnapshot>): void;
}
function copy<T>(value:T):T { return JSON.parse(JSON.stringify(value)); }
/** Runs in the audio worklet. The firmware clock is the only musical clock. */
export class EngineCore {
 private session: SessionState;
 private pending: SessionCommand[]=[];
 private recording:RecordingWindow|null=null;
 private replies=new Map<string,ClientMessage>();
 private history: SessionState[]=[];
 private cycle=0;
 private startRequested=false;
 private frame=0;
 private loopStart=0;
 private output=new OutputTransition(44100);
 constructor(private dsp: FirmwareBridge, private metadata:FirmwareMetadata, session:SessionState, private clockId:string, private emit:(m:ClientMessage)=>void){
  this.session=copy(session);this.sync();
 }
 audition(input:AuditionEvent){
  const event=AuditionEvent.parse(input);
  if(event.kind==='drum')this.dsp.w.vs_note(3,{kick:36,snare:38,'closed-hat':42}[event.lane],Math.round(event.velocity*127),1);
  else this.dsp.w.vs_note(['synth-1','synth-2','synth-3'].indexOf(event.trackId),event.midi,Math.round(event.velocity*127),event.on?1:0);
 }
 getSession(){return copy(this.session);}
 private sync(){
  const snapshot=firmwareSnapshot(this.session,this.metadata);
  snapshot.g[2]=this.pending.some(c=>c.operation.type==='record')?2:0;
  this.dsp.sync(snapshot);
 }
 private ack(c:SessionCommand,status:'queued'|'applied'|'rejected',reason?:string){
  const message:ClientMessage={type:'ack',commandId:c.id,status,revision:this.session.revision,...(reason?{reason}:{})};
  this.replies.set(c.id,message);this.emit(message);return message;
 }
 dispatch(input:SessionCommand){
  const c=SessionCommand.parse(input);
  const previous=this.replies.get(c.id);if(previous){this.emit(previous);return previous;}
  try{
   this.propose(c);
   const requiresBoundary=['record','tempo','clear','undo','apply-patch','commit-performance','edit-pattern','load-session'].includes(c.operation.type);
   if(requiresBoundary && c.boundary!=='next-loop')throw new Error('Operation requires next-loop boundary');
   if(c.operation.type==='commit-performance'&&c.operation.replacesCommandId){
    const replacesCommandId=c.operation.replacesCommandId;
    const index=this.pending.findIndex(queued=>queued.id===replacesCommandId);
    const previous=this.pending[index];
    if(!previous||previous.operation.type!=='commit-performance')throw new Error('Performance batch no longer queued');
    const before=previous.operation,after=c.operation;
    if(after.verifiedThroughFrame<before.verifiedThroughFrame)throw new Error('Verification watermark cannot move backward');
    for(const event of before.events){
     const replacement=after.events.find(candidate=>candidate.id===event.id);
     if(!replacement||JSON.stringify(replacement)!==JSON.stringify(event))throw new Error('Replacement must preserve previously queued events');
    }
    const spans=[...before.excludedSpans,...after.excludedSpans];
    after.excludedSpans=spans.filter((span,i)=>spans.findIndex(other=>other.startFrame===span.startFrame&&other.endFrame===span.endFrame)===i);
    if(after.excludedSpans.length>64)throw new Error('Too many command spans in replacement');
    this.pending[index]=c;this.ack(previous,'rejected','Performance batch superseded');
    return this.ack(c,'queued');
   }
   if(c.operation.type==='record'&&!this.dsp.w.vs_playing()){
    this.dsp.w.preview_play(1);this.cycle=0;this.loopStart=this.frame;this.startRequested=true;
   }
   if(c.boundary==='next-loop' && (this.dsp.w.vs_playing()||c.operation.type==='record')){
    if(this.pending.length>=64)throw new Error('Command queue full');
    this.pending.push(c);this.sync();return this.ack(c,'queued');
   }
   return this.apply(c);
  }catch(error){return this.ack(c,'rejected',String(error));}
 }
 private propose(c:SessionCommand):SessionState{
  if(c.expectedRevision!==this.session.revision)throw new Error('Stale revision');
  const state=copy(this.session);const op=c.operation;
  const target='target' in op?op.target:undefined;
  if(target && ((target.trackId==='drums' && !target.lane && ['select','record'].includes(op.type)) || (target.trackId!=='drums' && target.lane)))throw new Error('Invalid lane for target');
  switch(op.type){
   case 'select': state.selected=op.target;break;
   case 'play':if(op.playing&&this.recording?.endFrame===null)throw new Error('Stop recording before restarting playback');break;
   case 'edit-pattern':{
    const track=state.tracks.find(t=>t.id===op.trackId)!;track.notes=op.notes;track.hits=op.hits;break;
   }
   case 'volume':state.tracks.find(t=>t.id===op.trackId)!.volume=op.volume;break;
   case 'load-session':{
    if(this.recording?.endFrame===null||this.pending.some(c=>c.operation.type==='record'))throw new Error('Stop recording before loading a session');
    const restored=copy(op.session);restored.revision=this.session.revision+1;
    firmwareSnapshot(restored,this.metadata);return restored;
   }
   case 'mute':state.tracks.find(t=>t.id===op.trackId)!.muted=op.muted;break;
   case 'tempo':if(this.recording?.endFrame===null)throw new Error('Stop recording before changing tempo');if(!Number.isInteger(op.bpm))throw new Error('Integer BPM required');state.tempo=op.bpm;break;
   case 'clear':{
    const t=state.tracks.find(t=>t.id===op.target.trackId)!;
    if(op.target.lane)t.hits=t.hits.filter(h=>h.lane!==op.target.lane);else{t.notes=[];t.hits=[];}break;
   }
   case 'apply-patch':state.tracks.find(t=>t.id===op.trackId)!.patch=op.patch;break;
   case 'undo':if(!this.history.length)throw new Error('Nothing to undo');return {...copy(this.history.at(-1)!),revision:this.session.revision+1};
   case 'record':state.selected=op.target;break;
   case 'stop-recording':break;
   case 'commit-performance':{
    if(!this.recording)throw new Error('No recording window');
    const result=commitPerformance(state,op,this.recording,this.clockId,this.frame);
    result.revision++;firmwareSnapshot(result,this.metadata);return result;
   }
  }
  if(op.type!=='stop-recording')state.revision++;firmwareSnapshot(state,this.metadata);return state;
 }
 private apply(c:SessionCommand){
  const state=this.propose(c);
  const old=this.session;
  firmwareSnapshot(state,this.metadata);
  if(c.operation.type==='undo')this.history.pop();
  else if(!['select','play','record','stop-recording'].includes(c.operation.type)){this.history.push(old);if(this.history.length>64)this.history.shift();}
  if(state.tracks.some((track,i)=>JSON.stringify(track.patch)!==JSON.stringify(old.tracks[i].patch)))this.output.begin();
  this.session=state;
  if(c.operation.type==='load-session'){
   this.recording=null;
   const playing=!!this.dsp.w.vs_playing();this.dsp.w.preview_panic();
   if(playing){this.dsp.w.preview_play(1);this.cycle=0;this.loopStart=this.frame;this.startRequested=true;}
  }
  if(c.operation.type==='record')this.recording={startFrame:this.frame,endFrame:null,loopStartFrame:this.loopStart,tempo:this.session.tempo,target:copy(c.operation.target)};
  if(c.operation.type==='stop-recording'){
   if(this.recording&&this.recording.endFrame===null)this.recording.endFrame=this.frame;
   this.pending=this.pending.filter(queued=>{if(queued.operation.type!=='record')return true;this.ack(queued,'rejected','Recording cancelled');return false;});
  }
  if(c.operation.type==='play'){
   this.dsp.w.preview_play(c.operation.playing?1:0);
   if(c.operation.playing){this.cycle=0;this.loopStart=this.frame;this.startRequested=true;}
   else{if(this.recording&&this.recording.endFrame===null)this.recording.endFrame=this.frame;for(const queued of this.pending)this.ack(queued,'rejected','Playback stopped');this.pending=[];}
  }
  this.sync();
  const ack=this.ack(c,'applied');this.emit({type:'session',session:this.getSession()});return ack;
 }
 transport():Transport{const armed=this.pending.find(c=>c.operation.type==='record')?.operation;return {...(armed?.type==='record'?{armedTarget:armed.target}:{}),clockId:this.clockId,sampleRate:44100,currentFrame:this.frame,loopStartFrame:this.loopStart,playing:!!this.dsp.w.vs_playing(),recording:this.recording?.endFrame===null,recordingState:this.recording?.endFrame===null?'recording':this.pending.some(c=>c.operation.type==='record')?'armed':'idle',...(this.recording?{recordingStartFrame:this.recording.startFrame,recordingTarget:this.recording.target}:{}),pendingCommandIds:this.pending.map(c=>c.id)};}
 render(left:Float32Array,right:Float32Array,startFrame:number){
  this.frame=startFrame;
  for(let offset=0;offset<left.length;){
   const cycle=Math.floor(this.dsp.w.vs_beat()/16);
   if(this.startRequested){this.startRequested=false;this.cycle=0;}
   else if(cycle!==this.cycle){
    this.cycle=cycle;this.loopStart=this.frame;
    const pending=this.pending;this.pending=[];
    for(const c of pending){try{this.apply(c);}catch(e){this.ack(c,'rejected',String(e));}}
    this.sync();
   }
   const units=(16-this.dsp.w.vs_beat()%16)*44100*60-this.dsp.w.vs_phase();
   const untilLoop=Math.max(1,Math.ceil(units/this.session.tempo));
   const count=Math.min(left.length-offset,this.metadata.blockFrames,untilLoop);
   const pointer=this.dsp.w.vs_render(count);
   const samples=new Float32Array(this.dsp.w.memory.buffer,pointer,count*2);
   for(let i=0;i<count;i++)this.output.write(left,right,offset+i,samples[i*2],samples[i*2+1]);
   offset+=count;this.frame+=count;
  }
 }
}
