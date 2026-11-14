import {snapMidiToScale,type PerformanceEvent,type SessionState,type SessionCommand} from '@voicesynth/contracts';
export interface RecordingWindow {startFrame:number;endFrame:number|null;loopStartFrame:number;tempo:number;target:SessionState['selected'];captureStartFrame?:number;erasedThrough?:Record<string,number>}
export type PerformanceOperation=Extract<SessionCommand['operation'],{type:'commit-performance'}>;
function cells(start:number,length:number){return new Set(Array.from({length},(_,i)=>(start+i)%64));}
/** Exact quantized cells used by both erasure fences and performance application. */
export function performanceCells(event:PerformanceEvent,window:RecordingWindow){
 const unit=44100*60/(window.tempo*4),first=Math.round((event.captureFrame-window.loopStartFrame)/unit);
 const step=((first%64)+64)%64;
 const duration=event.kind==='onset'?1:Math.max(1,Math.min(64,Math.round((event.endFrame-window.loopStartFrame)/unit)-first));
 return cells(step,duration);
}
export function performanceWasErased(event:PerformanceEvent,window:RecordingWindow){
 return [...performanceCells(event,window)].some(step=>event.captureFrame<=(window.erasedThrough?.[step]??-1));
}
/** Input frames are already calibrated to the AudioContext clock; never subtract latency twice. */
export function commitPerformance(state:SessionState,op:PerformanceOperation,window:RecordingWindow,clockId:string,currentFrame:number):SessionState{
 const result:SessionState=JSON.parse(JSON.stringify(state));
 const stepFrames=44100*60/(window.tempo*4);
 if(op.verifiedThroughFrame>currentFrame)throw new Error('Speech verification cannot be in the future');
 for(const span of op.excludedSpans)if(span.endFrame<span.startFrame)throw new Error('Invalid speech span');
 const seen=new Set<string>();
 for(const event of op.events){
  if(seen.has(event.id))throw new Error('Duplicate performance event ID');seen.add(event.id);
  if(event.clockId!==clockId)throw new Error('Performance clock mismatch');
  if(event.target.trackId!==window.target.trackId||event.target.lane!==window.target.lane)throw new Error('Performance target does not match recording');
  const end=event.kind==='note'?event.endFrame:event.captureFrame;
  if(event.kind==='note'&&end<=event.captureFrame)throw new Error('Note must end after onset');
  if(event.captureFrame<(window.captureStartFrame??window.startFrame) || end>(window.endFrame??currentFrame) || end>currentFrame)throw new Error('Performance outside recording window');
  if(end>op.verifiedThroughFrame)throw new Error('Speech analysis has not verified these frames');
  if(op.excludedSpans.some(span=>event.captureFrame<=span.endFrame&&end>=span.startFrame))continue;
  if(event.confidence<0.6 || event.velocity===0 || performanceWasErased(event,window))continue;
  const unwrapped=Math.round((event.captureFrame-window.loopStartFrame)/stepFrames);
  const step=((unwrapped%64)+64)%64;
  const track=result.tracks.find(t=>t.id===event.target.trackId)!;
  if(event.kind==='onset'){
   if(track.id!=='drums'||!event.target.lane)throw new Error('Onsets require a selected drum lane');
   track.hits=track.hits.filter(h=>h.step!==step||h.lane!==event.target.lane);
   track.hits.push({id:event.id,step,lane:event.target.lane,velocity:event.velocity});
  }else{
   if(track.id==='drums'||event.target.lane)throw new Error('Notes require a melodic track');
   const duration=Math.max(1,Math.min(64,Math.round((end-window.loopStartFrame)/stepFrames)-unwrapped));
   const occupied=cells(step,duration);
   track.notes=track.notes.filter(note=>![...cells(note.step,note.duration)].some(i=>occupied.has(i)));
   track.notes.push({id:event.id,step,duration,midi:snapMidiToScale(event.midi,state.pitchSnap),velocity:event.velocity});
  }
 }
 return result;
}
