import { SessionCommand, type SessionState, type ClientMessage, type Transport } from '@voicesynth/contracts';
import type { FirmwareMetadata } from './metadata.ts';
import { firmwareSnapshot } from './snapshot.ts';
export interface FirmwareBridge {
 w: { memory: WebAssembly.Memory; vs_playing(): number; vs_beat(): number; vs_phase(): number; vs_render(frames:number): number; preview_play(on:number): number };
 sync(state: ReturnType<typeof firmwareSnapshot>): void;
}
function copy<T>(value:T):T { return JSON.parse(JSON.stringify(value)); }
/** Runs in the audio worklet. The firmware clock is the only musical clock. */
export class EngineCore {
 private session: SessionState;
 private pending: SessionCommand[]=[];
 private replies=new Map<string,ClientMessage>();
 private history: SessionState[]=[];
 private cycle=0;
 private startRequested=false;
 private frame=0;
 private loopStart=0;
 constructor(private dsp: FirmwareBridge, private metadata:FirmwareMetadata, session:SessionState, private clockId:string, private emit:(m:ClientMessage)=>void){
  this.session=copy(session);this.dsp.sync(firmwareSnapshot(this.session,metadata));
 }
 getSession(){return copy(this.session);}
 private ack(c:SessionCommand,status:'queued'|'applied'|'rejected',reason?:string){
  const message:ClientMessage={type:'ack',commandId:c.id,status,revision:this.session.revision,...(reason?{reason}:{})};
  this.replies.set(c.id,message);this.emit(message);return message;
 }
 dispatch(input:SessionCommand){
  const c=SessionCommand.parse(input);
  const previous=this.replies.get(c.id);if(previous){this.emit(previous);return previous;}
  try{
   this.propose(c);
   const requiresBoundary=['tempo','clear','undo','apply-patch'].includes(c.operation.type);
   if(requiresBoundary && c.boundary!=='next-loop')throw new Error('Operation requires next-loop boundary');
   if(c.boundary==='next-loop' && this.dsp.w.vs_playing()){
    if(this.pending.length>=64)throw new Error('Command queue full');
    this.pending.push(c);return this.ack(c,'queued');
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
   case 'play':break;
   case 'mute':state.tracks.find(t=>t.id===op.trackId)!.muted=op.muted;break;
   case 'tempo':if(!Number.isInteger(op.bpm))throw new Error('Integer BPM required');state.tempo=op.bpm;break;
   case 'clear':{
    const t=state.tracks.find(t=>t.id===op.target.trackId)!;
    if(op.target.lane)t.hits=t.hits.filter(h=>h.lane!==op.target.lane);else{t.notes=[];t.hits=[];}break;
   }
   case 'apply-patch':state.tracks.find(t=>t.id===op.trackId)!.patch=op.patch;break;
   case 'undo':if(!this.history.length)throw new Error('Nothing to undo');return {...copy(this.history.at(-1)!),revision:this.session.revision+1};
   case 'record':case 'stop-recording':throw new Error('Recording pipeline is not connected yet');
  }
  state.revision++;firmwareSnapshot(state,this.metadata);return state;
 }
 private apply(c:SessionCommand){
  const state=this.propose(c);
  const old=this.session;
  this.dsp.sync(firmwareSnapshot(state,this.metadata));
  if(c.operation.type==='undo')this.history.pop();
  else if(!['select','play'].includes(c.operation.type)){this.history.push(old);if(this.history.length>64)this.history.shift();}
  this.session=state;
  if(c.operation.type==='play'){
   this.dsp.w.preview_play(c.operation.playing?1:0);
   if(c.operation.playing){this.cycle=0;this.loopStart=this.frame;this.startRequested=true;}
   else{for(const queued of this.pending)this.ack(queued,'rejected','Playback stopped');this.pending=[];}
  }
  const ack=this.ack(c,'applied');this.emit({type:'session',session:this.getSession()});return ack;
 }
 transport():Transport{return {clockId:this.clockId,sampleRate:44100,currentFrame:this.frame,loopStartFrame:this.loopStart,playing:!!this.dsp.w.vs_playing(),recording:false,pendingCommandIds:this.pending.map(c=>c.id)};}
 render(left:Float32Array,right:Float32Array,startFrame:number){
  this.frame=startFrame;
  for(let offset=0;offset<left.length;){
   const cycle=Math.floor(this.dsp.w.vs_beat()/16);
   if(this.startRequested){this.startRequested=false;this.cycle=0;}
   else if(cycle!==this.cycle){
    this.cycle=cycle;this.loopStart=this.frame;
    const pending=this.pending;this.pending=[];
    for(const c of pending){try{this.apply(c);}catch(e){this.ack(c,'rejected',String(e));}}
   }
   const units=(16-this.dsp.w.vs_beat()%16)*44100*60-this.dsp.w.vs_phase();
   const untilLoop=Math.max(1,Math.ceil(units/this.session.tempo));
   const count=Math.min(left.length-offset,this.metadata.blockFrames,untilLoop);
   const pointer=this.dsp.w.vs_render(count);
   const samples=new Float32Array(this.dsp.w.memory.buffer,pointer,count*2);
   for(let i=0;i<count;i++){left[offset+i]=samples[i*2];right[offset+i]=samples[i*2+1];}
   offset+=count;this.frame+=count;
  }
 }
}
