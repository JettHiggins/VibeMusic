import {snapMidiToScale,triadFor,type PerformanceEvent,type SessionState,type SessionCommand} from '@voicesynth/contracts';
/** gridCells: rhythm-snap unit in sixteenth cells (1/2/4), fixed when the take started; missing = 1. */
export interface RecordingWindow {startFrame:number;endFrame:number|null;loopStartFrame:number;tempo:number;target:SessionState['selected'];captureStartFrame?:number;erasedThrough?:Record<string,number>;gridCells?:number}
type Note=SessionState['tracks'][number]['notes'][number];
export type PerformanceOperation=Extract<SessionCommand['operation'],{type:'commit-performance'}>;
function cells(start:number,length:number){return new Set(Array.from({length},(_,i)=>(start+i)%64));}
/** Exact quantized cells used by both erasure fences and performance application. */
/** Quantized [unwrapped start cell, duration] on the take's rhythm grid; shared by commit and erase fences. */
export function quantize(event:PerformanceEvent,window:RecordingWindow):[number,number]{
 const grid=window.gridCells??1,unit=44100*60/(window.tempo*4)*grid;
 const first=Math.round((event.captureFrame-window.loopStartFrame)/unit);
 if(event.kind==='onset')return [first*grid,1];
 const last=Math.round((event.endFrame-window.loopStartFrame)/unit);
 return [first*grid,Math.max(grid,Math.min(64,(last-first)*grid))];
}
export function performanceCells(event:PerformanceEvent,window:RecordingWindow){
 const [first,duration]=quantize(event,window);
 return cells(((first%64)+64)%64,duration);
}
/**
 * Over-recording replaces only the overlapped cells: the rest of an older note survives as one or two
 * shorter notes (its id is kept on the first piece; later pieces get ":s<n>"), instead of deleting it.
 */
export function trimOverlaps(notes:Note[],occupied:Set<number>):Note[]{
 const out:Note[]=[];
 for(const note of notes){
  const runs:number[][]=[];let run:number[]=[];
  for(let i=0;i<note.duration;i++){
   const cell=(note.step+i)%64;
   if(occupied.has(cell)){if(run.length)runs.push(run);run=[];}else run.push(cell);
  }
  if(run.length)runs.push(run);
  if(runs.length===1&&runs[0].length===note.duration){out.push(note);continue;}
  runs.forEach((cellsInRun,index)=>out.push({...note,id:index===0?note.id:`${note.id}:s${index}`,step:cellsInRun[0],duration:cellsInRun.length}));
 }
 return out;
}
export function performanceWasErased(event:PerformanceEvent,window:RecordingWindow){
 return [...performanceCells(event,window)].some(step=>event.captureFrame<=(window.erasedThrough?.[step]??-1));
}
/** Input frames are already calibrated to the AudioContext clock; never subtract latency twice. */
export function commitPerformance(state:SessionState,op:PerformanceOperation,window:RecordingWindow,clockId:string,currentFrame:number):SessionState{
 const result:SessionState=JSON.parse(JSON.stringify(state));
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
  const [unwrapped,quantizedDuration]=quantize(event,window);
  const step=((unwrapped%64)+64)%64;
  const track=result.tracks.find(t=>t.id===event.target.trackId)!;
  if(event.kind==='onset'){
   if(track.id!=='drums'||!event.target.lane)throw new Error('Onsets require a selected drum lane');
   track.hits=track.hits.filter(h=>h.step!==step||h.lane!==event.target.lane);
   track.hits.push({id:event.id,step,lane:event.target.lane,velocity:event.velocity});
  }else{
   if(track.id==='drums'||event.target.lane)throw new Error('Notes require a melodic track');
   const duration=quantizedDuration;
   track.notes=trimOverlaps(track.notes,cells(step,duration));
   const midi=snapMidiToScale(event.midi,state.pitchSnap);
   const chord=state.chordMode==='triad'?triadFor(midi,state.pitchSnap):[];
   track.notes.push({id:event.id,step,duration,midi,velocity:event.velocity,...(chord.length?{chord}:{})});
  }
 }
 return result;
}
