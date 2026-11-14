import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession,type PerformanceEvent} from '../packages/contracts/src/index.ts';
import {commitPerformance,type RecordingWindow,type PerformanceOperation} from '../apps/web/src/engine/performance.ts';
const target={trackId:'synth-1' as const};
const window:RecordingWindow={startFrame:352800,endFrame:null,loopStartFrame:352800,tempo:120,target};
const stepFrames=5512.5;
function note(id:string,step:number,duration=1):PerformanceEvent{return {id,kind:'note',target,clockId:'clock',captureFrame:Math.round(window.startFrame+step*stepFrames),endFrame:Math.round(window.startFrame+(step+duration)*stepFrames),confidence:0.9,velocity:0.8,midi:64};}
function operation(events:PerformanceEvent[]):PerformanceOperation{return {type:'commit-performance',events,excludedSpans:[],verifiedThroughFrame:1100000};}
test('quantized correction preserves notes outside occupied time including wrapped phrases',()=>{
 const session=createSession();session.tracks[0].notes=[{id:'old',step:2,duration:4,midi:60,velocity:1},{id:'preserve',step:12,duration:1,midi:60,velocity:1}];
 const result=commitPerformance(session,operation([note('new',2.1,1.8)]),window,'clock',1100000);
 assert.deepEqual(result.tracks[0].notes.map(n=>n.id),['preserve','new']);assert.equal(result.tracks[0].notes[1].step,2);assert.equal(result.tracks[0].notes[1].duration,2);
 assert.equal(session.tracks[0].notes[0].id,'old');
 const wrapped=commitPerformance(result,operation([note('wrap',63.9,1.2)]),window,'clock',1100000);assert.equal(wrapped.tracks[0].notes.at(-1)!.step,0);
});
test('drum overdubs update only the selected lane and grid position',()=>{
 const session=createSession();session.tracks[3].hits=[{id:'old',step:1,lane:'kick',velocity:1},{id:'snare',step:1,lane:'snare',velocity:1}];
 const drumWindow={...window,target:{trackId:'drums' as const,lane:'kick' as const}};
 const event:PerformanceEvent={id:'new',kind:'onset',target:drumWindow.target,clockId:'clock',captureFrame:Math.round(window.startFrame+stepFrames*1.1),confidence:1,velocity:0.7};
 const result=commitPerformance(session,operation([event]),drumWindow,'clock',1100000);
 assert.deepEqual(result.tracks[3].hits.map(h=>h.id),['snare','new']);assert.equal(result.tracks[3].hits[1].step,1);
});
test('speech spans, silence, and low confidence never replace existing notes',()=>{
 const session=createSession();session.tracks[0].notes=[{id:'old',step:2,duration:1,midi:60,velocity:1}];
 const event=note('speech',2);
 const op=operation([event,{...note('quiet',12),confidence:0.2},{...note('silent',20),velocity:0}]);
 op.excludedSpans=[{startFrame:event.captureFrame,endFrame:event.kind==='note'?event.endFrame:event.captureFrame}];
 assert.deepEqual(commitPerformance(session,op,window,'clock',1100000),session);
});
test('unverified, future, foreign-clock and out-of-window events are rejected atomically',()=>{
 const event=note('a',2);const session=createSession();
 assert.throws(()=>commitPerformance(session,operation([{...event,clockId:'other'}]),window,'clock',1100000),/clock/);
 const unverified=operation([event]);unverified.verifiedThroughFrame=window.startFrame;assert.throws(()=>commitPerformance(session,unverified,window,'clock',1100000),/verified/);
 assert.throws(()=>commitPerformance(session,operation([{...event,captureFrame:0}]),window,'clock',1100000),/outside/);
 assert.throws(()=>commitPerformance(session,operation([event]),window,'clock',window.startFrame),/future/);
 assert.deepEqual(session,createSession());
});
