import { AuditionEvent, SessionCommand, type SessionState, type ClientMessage, type Transport, type CaptureErasure } from '@voicesynth/contracts';
import type { FirmwareMetadata } from './metadata.ts';
import {OutputTransition} from './output-transition.ts';
import { firmwareSnapshot } from './snapshot.ts';
import {commitPerformance,performanceWasErased,type RecordingWindow} from './performance.ts';
export interface FirmwareBridge {
 w: { memory: WebAssembly.Memory; vs_playing(): number; vs_beat(): number; vs_phase(): number; vs_render(frames:number): number; preview_play(on:number): number; preview_panic(): number; vs_note(track:number,note:number,velocity:number,on:number): number; vs_erase_note?(track:number,note:number):void };
 sync(state: ReturnType<typeof firmwareSnapshot>): void;
}
function copy<T>(value:T):T { return JSON.parse(JSON.stringify(value)); }
/** Runs in the audio worklet. The firmware clock is the only musical clock. */
export class EngineCore {
 private session: SessionState;
 private pending: SessionCommand[]=[];
 private scheduledFrames=new Map<string,number>();
 private countIns=new Map<string,{frame:number;tempo:number}>();
 private metronomeEnabled=true;
 private recordingEpoch=0;
 private captureErasure:CaptureErasure|null=null;
 private recording:RecordingWindow|null=null;
 private replies=new Map<string,ClientMessage>();
 private history: SessionState[]=[];
 private cycle=0;
 private startRequested=false;
 private frame=0;
 private loopStart=0;
 private output=new OutputTransition(44100);
 constructor(private dsp: FirmwareBridge, private metadata:FirmwareMetadata, session:SessionState, private clockId:string, private emit:(m:ClientMessage)=>void,initialFrame=0){
  this.frame=initialFrame;this.loopStart=initialFrame;this.session=copy(session);this.sync();
 }
 audition(input:AuditionEvent){
  const event=AuditionEvent.parse(input);
  if(event.kind==='drum')this.dsp.w.vs_note(3,{kick:36,snare:38,'closed-hat':42}[event.lane],Math.round(event.velocity*127),1);
  else this.dsp.w.vs_note(['synth-1','synth-2','synth-3'].indexOf(event.trackId),event.midi,Math.round(event.velocity*127),event.on?1:0);
 }
 getSession(){return copy(this.session);}
 private sync(){
  const snapshot=firmwareSnapshot(this.session,this.metadata);
  snapshot.g[2]=this.metronomeEnabled?2:0;
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
   if(c.operation.type==='undo'&&c.boundary==='immediate'&&this.pending.some(p=>p.operation.type==='commit-performance'))c.operation.discardCaptureOnly=true;
   this.propose(c);
   const requiresBoundary=['tempo','commit-performance','edit-pattern','load-session'].includes(c.operation.type);
   if(c.operation.type==='record'&&!['next-beat','next-loop'].includes(c.boundary))throw new Error('Record requires next-beat or next-loop boundary');
   if(c.boundary==='next-beat'&&c.operation.type!=='record')throw new Error('Next-beat boundary is only supported for record');
   if(requiresBoundary && c.boundary!=='next-loop')throw new Error('Operation requires next-loop boundary');
   if(c.operation.type==='metronome'&&c.boundary!=='immediate')throw new Error('Metronome requires immediate boundary');
   if(c.operation.type==='erase-event'&&c.boundary!=='immediate')throw new Error('Erase requires immediate boundary');
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
   if(c.operation.type==='record'&&this.pending.length>=64)throw new Error('Command queue full');
   const stoppedRecord=c.operation.type==='record'&&!this.dsp.w.vs_playing();
   if(stoppedRecord){
    this.dsp.w.preview_play(1);this.cycle=0;this.loopStart=this.frame;this.startRequested=true;
   }
   if((c.boundary==='next-loop'||c.boundary==='next-beat') && (this.dsp.w.vs_playing()||c.operation.type==='record')){
    if(this.pending.length>=64)throw new Error('Command queue full');
    if(c.operation.type==='record'){
     // preview_play is deferred until render and resets the firmware beat counter.
     // Pin an absolute audio-frame deadline before that reset; never compare to its old count.
     const beats=stoppedRecord?(c.boundary==='next-beat'?4:16):(c.boundary==='next-beat'?1:16-this.dsp.w.vs_beat()%16);
     const phase=stoppedRecord?0:this.dsp.w.vs_phase();
     this.scheduledFrames.set(c.id,this.frame+Math.ceil((beats*44100*60-phase)/this.session.tempo));
     if(stoppedRecord&&c.boundary==='next-beat')this.countIns.set(c.id,{frame:this.frame,tempo:this.session.tempo});
    }
    this.pending.push(c);this.sync();return this.ack(c,'queued');
   }
   return this.apply(c);
  }catch(error){return this.ack(c,'rejected',String(error));}
 }
 private propose(c:SessionCommand):SessionState{
  if(c.expectedRevision!==this.session.revision)throw new Error('Stale revision');
  const state=copy(this.session);const op=c.operation;
  const target='target' in op?op.target:undefined;
  if(target && ((target.trackId==='drums' && !target.lane && ['select','record','erase-event'].includes(op.type)) || (target.trackId!=='drums' && target.lane)))throw new Error('Invalid lane for target');
  switch(op.type){
   case 'metronome':break;
   case 'erase-event':{
    const track=state.tracks.find(t=>t.id===op.target.trackId)!;
    if(track.id==='drums'){
     const before=track.hits.length;track.hits=track.hits.filter(h=>h.lane!==op.target.lane||h.step!==op.step);
     if(track.hits.length===before)return state;
    }else{
     const removed=track.notes.filter(n=>(op.step-n.step+64)%64<n.duration);
     if(!removed.length)return state;
     if(!this.dsp.w.vs_erase_note)throw new Error('Rebuild engine assets for melodic erasure');
     track.notes=track.notes.filter(n=>!removed.includes(n));
    }
    break;
   }
   case 'select': state.selected=op.target;break;
   case 'play':if(op.playing&&(this.recording?.endFrame===null||this.pending.some(p=>p.operation.type==='record')))throw new Error('Stop recording before restarting playback');break;
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
   case 'tempo':if(this.recording?.endFrame===null||this.pending.some(p=>p.operation.type==='record'))throw new Error('Stop recording before changing tempo');if(!Number.isInteger(op.bpm))throw new Error('Integer BPM required');state.tempo=op.bpm;break;
   case 'clear':{
    const t=state.tracks.find(t=>t.id===op.target.trackId)!;
    if(op.target.lane)t.hits=t.hits.filter(h=>h.lane!==op.target.lane);else{t.notes=[];t.hits=[];}break;
   }
   case 'apply-patch':state.tracks.find(t=>t.id===op.trackId)!.patch=op.patch;break;
   case 'undo':if(op.discardCaptureOnly){if(!this.recording)throw new Error('No capture to discard');return state;}if(!this.history.length)throw new Error('Nothing to undo');if(this.pending.some(p=>p.operation.type==='record')&&this.history.at(-1)!.tempo!==this.session.tempo)throw new Error('Stop count-in before undoing a tempo change');return {...copy(this.history.at(-1)!),revision:this.session.revision+1};
   case 'record':if(this.recording?.endFrame===null||this.pending.some(p=>p.operation.type==='record'))throw new Error('Recording already armed or active');state.selected=op.target;break;
   case 'stop-recording':break;
   case 'commit-performance':{
    if(!this.recording)throw new Error('No recording window');
    if(op.recordingEpoch!==undefined&&op.recordingEpoch!==this.recordingEpoch)throw new Error('Capture epoch mismatch');
    const result=commitPerformance(state,op,this.recording,this.clockId,this.frame);
    if(JSON.stringify(result.tracks)!==JSON.stringify(state.tracks))result.revision++;firmwareSnapshot(result,this.metadata);return result;
   }
   default:throw new Error('Operation not supported by this engine build');
  }
  if(op.type!=='stop-recording'&&op.type!=='metronome')state.revision++;firmwareSnapshot(state,this.metadata);return state;
 }
 private apply(c:SessionCommand){
  // Record is a transport intent with a pinned target/deadline. Its revision was
  // validated when armed; unrelated musical edits must not cancel the count-in.
  const state=this.propose(c.operation.type==='record'?{...c,expectedRevision:this.session.revision}:c);
  const old=this.session;
  firmwareSnapshot(state,this.metadata);
  if(c.operation.type==='undo'){if(!c.operation.discardCaptureOnly)this.history.pop();}
  else if(state.revision!==old.revision&&!['select','play','record','stop-recording','metronome'].includes(c.operation.type)){this.history.push(old);if(this.history.length>64)this.history.shift();}
  if(state.tracks.some((track,i)=>JSON.stringify(track.patch)!==JSON.stringify(old.tracks[i].patch)))this.output.begin();
  this.session=state;
  if(c.operation.type==='metronome')this.metronomeEnabled=c.operation.enabled;
  if(c.operation.type==='load-session'){
   this.recording=null;this.captureErasure=null;
   const playing=!!this.dsp.w.vs_playing();this.dsp.w.preview_panic();
   if(playing){this.dsp.w.preview_play(1);this.cycle=0;this.loopStart=this.frame;this.startRequested=true;}
  }
  if(c.operation.type==='record'){this.captureErasure=null;this.recordingEpoch++;this.recording={startFrame:this.frame,captureStartFrame:this.frame,endFrame:null,loopStartFrame:this.loopStart,tempo:this.session.tempo,target:copy(c.operation.target)};}
  if(c.operation.type==='stop-recording'){
   if(this.recording&&this.recording.endFrame===null)this.recording.endFrame=this.frame;
   this.pending=this.pending.filter(queued=>{if(queued.operation.type!=='record')return true;this.scheduledFrames.delete(queued.id);this.countIns.delete(queued.id);this.ack(queued,'rejected','Recording cancelled');return false;});
  }
  if(c.operation.type==='play'){
   this.dsp.w.preview_play(c.operation.playing?1:0);
   if(c.operation.playing){this.cycle=0;this.loopStart=this.frame;this.startRequested=true;}
   else{if(this.recording&&this.recording.endFrame===null)this.recording.endFrame=this.frame;for(const queued of this.pending)this.ack(queued,'rejected','Playback stopped');this.pending=[];this.scheduledFrames.clear();this.countIns.clear();}
  }
  this.sync();
  // Explicit live edits supersede queued pattern intentions, including discard-only Undo
  // (which deliberately leaves revision unchanged). Do not let them reappear at the loop.
  if(c.boundary==='immediate'&&(c.operation.type==='clear'||c.operation.type==='undo')){
   const operation=c.operation;
   const cancelled=this.pending.filter(p=>p.operation.type==='edit-pattern'&&(operation.type==='undo'||p.operation.trackId===operation.target.trackId));
   this.pending=this.pending.filter(p=>!cancelled.includes(p));
   for(const queued of cancelled)this.ack(queued,'rejected','Pattern edit discarded by live edit');
  }
  const clear=c.operation.type==='clear'?c.operation.target:null;
  const conflicts=clear&&this.recording&&clear.trackId===this.recording.target.trackId&&(!clear.lane||clear.lane===this.recording.target.lane);
  if(this.recording&&(c.operation.type==='undo'||conflicts)){
   this.recordingEpoch++;this.captureErasure=null;this.recording.erasedThrough={};
   this.recording.captureStartFrame=this.frame+1;
   if(this.recording.tempo!==this.session.tempo){
    this.recording.tempo=this.session.tempo;
    this.recording.loopStartFrame=this.frame-((this.dsp.w.vs_beat()%16)*44100*60+this.dsp.w.vs_phase())/this.session.tempo;
   }
   const cancelled=this.pending.filter(p=>p.operation.type==='commit-performance');
   this.pending=this.pending.filter(p=>p.operation.type!=='commit-performance');
   // Deliver the reset before batch rejection acks so the consumer cannot retry old audio.
   this.emit({type:'transport',transport:this.transport()});
   for(const queued of cancelled)this.ack(queued,'rejected','Capture discarded by live edit');
  }
  if(c.operation.type==='erase-event'){
   const operation=c.operation;
   const window=this.recording;
   if(window&&window.target.trackId===operation.target.trackId&&window.target.lane===operation.target.lane){
    window.erasedThrough??={};window.erasedThrough[operation.step]=this.frame;
    this.captureErasure={commandId:c.id,recordingEpoch:this.recordingEpoch,throughFrame:this.frame,target:copy(operation.target),step:operation.step};
   }
   // Notify input before any queued-batch acknowledgments or the new session snapshot.
   this.emit({type:'transport',transport:this.transport()});
   const cancelled:SessionCommand[]=[],retained:SessionCommand[]=[];
   for(const queued of this.pending){
    if(queued.operation.type==='edit-pattern'&&queued.operation.trackId===operation.target.trackId){cancelled.push(queued);continue;}
    if(queued.operation.type==='commit-performance'&&queued.expectedRevision===old.revision&&window){
     // Narrow exception: an already-valid input batch may cross THIS erase only.
     // Other intervening mutations still make it stale. Keep the ID and unchanged surviving events.
     const events=queued.operation.events.filter(event=>!performanceWasErased(event,window));
     if(!events.length){cancelled.push(queued);continue;}
     queued.operation.events=events;queued.expectedRevision=state.revision;retained.push(queued);
    }
   }
   this.pending=this.pending.filter(q=>!cancelled.includes(q));
   for(const queued of cancelled)this.ack(queued,'rejected',queued.operation.type==='commit-performance'?'Capture removed by targeted erase':'Pattern edit discarded by targeted erase');
   for(const queued of retained)this.ack(queued,'queued');
   if(operation.target.trackId!=='drums'&&this.dsp.w.vs_playing()){
    const step=Math.floor((this.dsp.w.vs_beat()%16)*4+this.dsp.w.vs_phase()*4/(44100*60));
    const removed=old.tracks.find(t=>t.id===operation.target.trackId)!.notes.filter(n=>(operation.step-n.step+64)%64<n.duration&&(step-n.step+64)%64<n.duration);
    for(const note of removed)this.dsp.w.vs_erase_note!(['synth-1','synth-2','synth-3'].indexOf(operation.target.trackId),note.midi);
   }
  }
  const ack=this.ack(c,'applied');this.emit({type:'session',session:this.getSession()});return ack;
 }
 transport():Transport{
  const armedCommand=this.pending.find(c=>c.operation.type==='record'),armed=armedCommand?.operation;
  const deadline=armedCommand?this.scheduledFrames.get(armedCommand.id):undefined;
  const countIn=armedCommand?this.countIns.get(armedCommand.id):undefined;
  return {
   ...(this.captureErasure?{captureErasure:this.captureErasure}:{}),
   ...(deadline===undefined?{}:{armedStartFrame:deadline}),
   ...(countIn?{countInBeatsRemaining:Math.max(0,Math.min(4,4-Math.floor((this.frame-countIn.frame)*countIn.tempo/(44100*60))))}:{}),
   ...(armed?.type==='record'?{armedTarget:armed.target}:{}),
   metronomeEnabled:this.metronomeEnabled,clockId:this.clockId,sampleRate:44100,currentFrame:this.frame,loopStartFrame:this.loopStart,
   playing:!!this.dsp.w.vs_playing(),recording:this.recording?.endFrame===null,
   recordingState:this.recording?.endFrame===null?'recording':armedCommand?'armed':'idle',
   ...(this.recording?{recordingStartFrame:this.recording.startFrame,recordingTarget:this.recording.target,
    recordingEpoch:this.recordingEpoch,captureStartFrame:this.recording.captureStartFrame??this.recording.startFrame,
    recordingLoopStartFrame:this.recording.loopStartFrame}:{}),pendingCommandIds:this.pending.map(c=>c.id)
  };
 }

 render(left:Float32Array,right:Float32Array,startFrame:number){
  this.frame=startFrame;
  for(let offset=0;offset<left.length;){
   const beat=this.dsp.w.vs_beat(),cycle=Math.floor(beat/16);
   let boundary=false;
   if(this.startRequested){this.startRequested=false;this.cycle=0;}
   else if(cycle!==this.cycle){this.cycle=cycle;this.loopStart=this.frame;boundary=true;}
   const due=this.pending.filter(c=>c.operation.type==='record'?this.frame>=(this.scheduledFrames.get(c.id)??Infinity):boundary);
   if(due.length){
    const ids=new Set(due.map(c=>c.id));this.pending=this.pending.filter(c=>!ids.has(c.id));
    for(const c of due){this.scheduledFrames.delete(c.id);this.countIns.delete(c.id);try{this.apply(c);}catch(e){this.ack(c,'rejected',String(e));}}
    this.sync();
   }
   const units=(16-this.dsp.w.vs_beat()%16)*44100*60-this.dsp.w.vs_phase();
   const untilLoop=Math.max(1,Math.ceil(units/this.session.tempo));
   const untilRecord=Math.min(Infinity,...this.pending.filter(c=>c.operation.type==='record').map(c=>Math.max(1,(this.scheduledFrames.get(c.id)??Infinity)-this.frame)));
   const count=Math.min(left.length-offset,this.metadata.blockFrames,untilLoop,untilRecord);
   const pointer=this.dsp.w.vs_render(count);
   const samples=new Float32Array(this.dsp.w.memory.buffer,pointer,count*2);
   for(let i=0;i<count;i++)this.output.write(left,right,offset+i,samples[i*2],samples[i*2+1]);
   offset+=count;this.frame+=count;
  }
 }
}
