import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession,type PerformanceEvent} from '../packages/contracts/src/index.ts';
import {commitPerformance,performanceCells,trimOverlaps,type RecordingWindow,type PerformanceOperation} from '../apps/web/src/engine/performance.ts';
import {firmwareSnapshot} from '../apps/web/src/engine/snapshot.ts';
import {existsSync,readFileSync} from 'node:fs';

const target={trackId:'synth-1' as const};
const base:RecordingWindow={startFrame:352800,endFrame:null,loopStartFrame:352800,tempo:120,target};
const cell=5512.5;
const note=(id:string,start:number,length:number,midi=60):PerformanceEvent=>({id,kind:'note',target,clockId:'clock',captureFrame:Math.round(base.startFrame+start*cell),endFrame:Math.round(base.startFrame+(start+length)*cell),confidence:0.9,velocity:0.8,midi});
const op=(events:PerformanceEvent[]):PerformanceOperation=>({type:'commit-performance',events,excludedSpans:[],verifiedThroughFrame:1100000});
const commit=(session:ReturnType<typeof createSession>,events:PerformanceEvent[],window=base)=>commitPerformance(session,op(events),window,'clock',1100000);
const shape=(s:ReturnType<typeof createSession>)=>s.tracks[0].notes.map(n=>[n.id,n.step,n.duration]);

test('over-recording the middle of a note splits it around the new note',()=>{
 const session=createSession();session.tracks[0].notes=[{id:'long',step:0,duration:16,midi:60,velocity:1}];
 assert.deepEqual(shape(commit(session,[note('mid',6,2)])),[['long',0,6],['long:s1',8,8],['mid',6,2]]);
});

test('over-recording across the loop wrap trims both ends correctly',()=>{
 const session=createSession();session.tracks[0].notes=[{id:'wrap',step:60,duration:8,midi:60,velocity:1}];
 assert.deepEqual(shape(commit(session,[note('new',62,3)])),[['wrap',60,2],['wrap:s1',1,3],['new',62,3]]);
 assert.deepEqual(trimOverlaps([{id:'x',step:4,duration:2,midi:60,velocity:1}],new Set([4,5])),[]);
});

test('rhythm grid rounds starts and lengths and is shared with erase fences',()=>{
 const quarter={...base,gridCells:4},eighth={...base,gridCells:2};
 assert.deepEqual(shape(commit(createSession(),[note('q',2.6,1.2)],quarter)),[['q',4,4]]); // nearest beat, at least one beat
 assert.deepEqual(shape(commit(createSession(),[note('e',5.2,3.1)],eighth)),[['e',6,2]]);
 assert.deepEqual(shape(commit(createSession(),[note('s',5.2,3.1)])),[['s',5,3]]); // sixteenth = legacy behavior
 assert.deepEqual([...performanceCells(note('q',2.6,1.2),quarter)],[4,5,6,7]);
 assert.deepEqual(shape(commit(createSession(),[note('a',0.2,0.8),note('b',1.1,0.8)],quarter)),[['b',0,4]]); // chosen trade-off: quick notes share the beat
});

test('chord mode adds the in-key triad to newly committed notes only',()=>{
 const session=createSession();session.pitchSnap={root:0,scale:'major'};session.chordMode='triad';
 session.tracks[0].notes=[{id:'before',step:8,duration:2,midi:67,velocity:1}];
 const result=commit(session,[note('c',0,4,61),note('d',4,4,62)]);
 const byId=Object.fromEntries(result.tracks[0].notes.map(n=>[n.id,n]));
 assert.equal(byId.before.chord,undefined);
 assert.equal(byId.c.midi,60);assert.deepEqual(byId.c.chord,[64,67]); // C# snapped to C, C major triad
 assert.deepEqual(byId.d.chord,[65,69]); // D minor in C major
 session.chordMode='off';assert.equal(commit(session,[note('e',12,2)]).tracks[0].notes.at(-1)!.chord,undefined);
});

// Needs built engine metadata (absent in the contracts-and-web CI job), like the other engine tests.
test('firmware snapshot sounds chord pitches on the same step',{skip:!existsSync('apps/web/public/engine/metadata.json')},()=>{
 const metadata=JSON.parse(readFileSync('apps/web/public/engine/metadata.json','utf8'));
 const session=createSession();session.tracks[0].notes=[{id:'c',step:0,duration:2,midi:60,velocity:1,chord:[64,67]}];
 const step=firmwareSnapshot(session,metadata).tracks[0].step;
 assert.deepEqual([step[0].notes,step[0].n,step[0].time,step[1].time],[[60,64,67,0],3,0,1]);
});

// -- through the real engine core and WASM ------------------------------------------------------
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {ClientMessage,SessionCommand} from '../packages/contracts/src/index.ts';
import {EngineCore} from '../apps/web/src/engine/core.ts';
const dir='apps/web/public/engine',ready=existsSync(`${dir}/voicesynth.wasm`),SR=44100,LOOP=SR*8;
async function engine(){
 const {FirmwareAudio}=await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const dsp=new FirmwareAudio(await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`)));
 const messages:ClientMessage[]=[];
 const core=new EngineCore(dsp,JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8')),createSession(),'clock',m=>messages.push(m));
 let frame=0,id=0;
 const send=(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate')=>core.dispatch({id:`pt-${++id}`,expectedRevision:core.getSession().revision,boundary,operation});
 const render=(count:number)=>{core.render(new Float32Array(count),new Float32Array(count),frame);frame+=count;};
 const sung=(startCell:number,cells:number,midi=62):PerformanceEvent=>{const loop=core.transport().recordingLoopStartFrame!;return {kind:'note',id:`sung-${++id}`,target:{trackId:'synth-1'},captureFrame:Math.round(loop+startCell*SR/8),endFrame:Math.round(loop+(startCell+cells)*SR/8),clockId:'clock',confidence:1,velocity:.8,midi};};
 return {core,send,render,sung,frame:()=>frame};
}

test('rhythm and chord settings are immediate, undoable no-ops when unchanged',{skip:!ready},async()=>{
 const e=await engine(),rev=e.core.getSession().revision;
 assert.equal(e.send({type:'set-rhythm-snap',grid:'sixteenth'}).type,'ack');assert.equal(e.core.getSession().revision,rev); // default: no-op
 e.send({type:'set-rhythm-snap',grid:'quarter'});e.send({type:'set-chord-mode',mode:'triad'});
 assert.deepEqual([e.core.getSession().rhythmSnap,e.core.getSession().chordMode,e.core.getSession().revision],['quarter','triad',rev+2]);
 e.send({type:'undo'});assert.equal(e.core.getSession().chordMode,undefined);
 const late=e.core.dispatch({id:'bad',expectedRevision:e.core.getSession().revision,boundary:'next-loop',operation:{type:'set-chord-mode',mode:'triad'}});
 assert.ok(late.type==='ack'&&late.status==='rejected');
});

test('a take keeps its starting rhythm grid and commits chords that the engine accepts',{skip:!ready},async()=>{
 const e=await engine();
 e.send({type:'set-rhythm-snap',grid:'quarter'});e.send({type:'set-chord-mode',mode:'triad'});e.send({type:'set-pitch-snap',settings:{root:0,scale:'major'}});
 e.send({type:'record',target:{trackId:'synth-1'}},'next-beat');e.render(SR*3);
 e.send({type:'set-rhythm-snap',grid:'sixteenth'}); // during capture: applies from the next take
 e.render(SR);const now=e.frame();
 const event:PerformanceEvent={kind:'note',id:'sung-take',target:{trackId:'synth-1'},captureFrame:now-Math.round(SR*0.6),endFrame:now-Math.round(SR*0.45),clockId:'clock',confidence:1,velocity:.8,midi:61};
 const ack=e.send({type:'commit-performance',events:[event],excludedSpans:[],verifiedThroughFrame:e.frame(),recordingEpoch:e.core.transport().recordingEpoch},'next-loop');
 assert.ok(ack.type==='ack'&&ack.status==='queued',JSON.stringify(ack));e.render(LOOP);
 const committed=e.core.getSession().tracks[0].notes.find(n=>n.id===event.id)!;
 assert.deepEqual([committed.step%4,committed.duration,committed.midi,committed.chord],[0,4,60,[64,67]]);
});
