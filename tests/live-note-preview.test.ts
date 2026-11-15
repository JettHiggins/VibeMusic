import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, type SessionCommand, type Transport } from '../packages/contracts/src/index.ts';
import { NoteSegmenter, type SungNote } from '../apps/web/src/input/pitch.ts';
import { PerformanceRecorder } from '../apps/web/src/input/recorder.ts';

const SR=44100, START=441000, STEP=SR/8;
function setup(mode:'manual'|'speech'='manual') {
 const sent:SessionCommand[]=[];
 const recorder=new PerformanceRecorder({newId:()=>crypto.randomUUID(),dispatch:c=>{sent.push(c);return {type:'ack',commandId:c.id,status:'queued',revision:0};}},mode);
 recorder.handle({type:'session',session:createSession()});
 const transport:Transport={clockId:'clock',sampleRate:SR,currentFrame:START+SR,loopStartFrame:START,playing:true,recording:true,recordingState:'recording',recordingStartFrame:START,recordingTarget:{trackId:'synth-1'},recordingEpoch:1,pendingCommandIds:[]};
 const update=(patch:Partial<Transport>={})=>{Object.assign(transport,patch);recorder.handle({type:'transport',transport:{...transport}});};
 update();
 const note=(start=START+STEP,end=start+SR):SungNote=>({startFrame:Math.round(start),endFrame:Math.round(end),midi:61,velocity:.7,confidence:.95});
 return {recorder,sent,update,note,transport};
}

test('segmenter exposes a growing raw estimate before release without finalizing; release clears it',()=>{
 const segmenter=new NoteSegmenter({sampleRate:SR,hop:256});
 const final:SungNote[]=[];
 const frame=(n:number,f0:number|null=261.6256)=>({frame:n*256,f0,clarity:1,rmsDb:-24});
 for(let n=1;n<=8;n++)final.push(...segmenter.push([frame(n)]));
 const early=segmenter.liveNote!;
 assert.ok(early&&early.endFrame<SR/10); assert.equal(final.length,0);
 early.midi=0;assert.equal(segmenter.liveNote?.midi,60,'view cannot mutate segmenter');
 for(let n=9;n<=340;n++)final.push(...segmenter.push([frame(n)]));
 assert.equal(final.length,0);assert.ok(segmenter.liveNote!.endFrame>SR*1.9);
 for(let n=341;n<=347;n++)final.push(...segmenter.push([frame(n,null)]));
 assert.equal(final.length,1);assert.equal(segmenter.liveNote,null);assert.equal(final[0].midi,60);
});

test('view-only estimate grows on calibrated grid and never queues or dispatches even at boundary',()=>{
 const {recorder,sent,update,note}=setup();
 const latency=2205,raw=note(START+STEP+latency,START+3*STEP+latency);
 recorder.setLiveNote(raw,latency,'clock');
 const a=recorder.status().live!;
 assert.equal(a.step,1);assert.equal(a.duration,2);assert.equal(a.event.captureFrame,Math.round(START+STEP));
 recorder.setLiveNote({...raw,endFrame:raw.endFrame+4*STEP},latency,'clock');
 assert.equal(recorder.status().live?.event.id,a.event.id);assert.equal(recorder.status().live?.duration,6);
 update({currentFrame:START+64*STEP-100});
 recorder.addOnsets([],latency,'clock',START+64*STEP);
 assert.equal(sent.length,0);assert.equal(recorder.hasPendingCapture,false);assert.equal(recorder.status().provisional.length,0);
 recorder.setLiveNote(null,latency,'clock');recorder.addNotes([raw],latency,'clock',START+64*STEP);
 assert.equal(recorder.status().live,null);assert.equal(sent.length,1,'only released note goes through normal commit path');
});

test('speech preview does not imply verification; command spans hide it and released commands stay excluded',()=>{
 const {recorder,note,sent,update}=setup('speech');recorder.setSpeechAvailable(true);
 const n=note();recorder.setLiveNote(n,0,'clock');
 assert.ok(recorder.status().live);assert.equal(sent.length,0);
 recorder.addCommandSpan({clockId:'clock',startFrame:n.startFrame,endFrame:n.endFrame});
 assert.equal(recorder.status().live,null);
 recorder.setLiveNote({...n,endFrame:n.endFrame+SR},0,'clock');assert.equal(recorder.status().live,null);
 recorder.addNotes([n],0,'clock',n.endFrame);recorder.verifyThrough('clock',n.endFrame);update({currentFrame:START+64*STEP-1});
 assert.equal(sent.length,0);assert.equal(recorder.status().provisional.length,0);
});

test('preview respects erasure fences, epoch/reset, stop, wrong clock, drum takes and speech disconnect',()=>{
 const {recorder,note,update}=setup();const n=note();
 const show=()=>{recorder.setLiveNote(n,0,'clock');assert.ok(recorder.status().live);};
 show();recorder.resetPendingCapture();assert.equal(recorder.status().live,null);
 show();update({recordingEpoch:2,captureStartFrame:n.endFrame});assert.equal(recorder.status().live,null);
 recorder.setLiveNote(n,0,'clock');assert.equal(recorder.status().live,null,'delayed pre-edit frames cannot return');
 update({recordingEpoch:3,captureStartFrame:START});show();
 update({captureErasure:{commandId:'erase',recordingEpoch:3,target:{trackId:'synth-1'},step:1,throughFrame:n.endFrame}});
 assert.equal(recorder.status().live,null);recorder.setLiveNote(n,0,'clock');assert.equal(recorder.status().live,null);
 update({recordingEpoch:4,captureStartFrame:START,captureErasure:undefined});show();
 update({recording:false,recordingState:'idle'});assert.equal(recorder.status().live,null);
 update({recording:true,recordingState:'recording'});recorder.setLiveNote(n,0,'wrong');assert.equal(recorder.status().live,null);
 update({recordingStartFrame:START+1,recordingTarget:{trackId:'drums',lane:'kick'}});recorder.setLiveNote(n,0,'clock');assert.equal(recorder.status().live,null);
 const speech=setup('speech');speech.recorder.setSpeechAvailable(true);speech.recorder.setLiveNote(speech.note(),0,'clock');assert.ok(speech.recorder.status().live);
 speech.recorder.setSpeechAvailable(false);assert.equal(speech.recorder.status().live,null);
});

test('live loop-crossing geometry wraps while raw MIDI remains unchanged',()=>{
 const {recorder,note}=setup();recorder.setLiveNote(note(START+60*STEP,START+76*STEP),0,'clock');
 const p=recorder.status().live!;assert.equal(p.step,60);assert.equal(p.duration,16);assert.ok(p.event.kind==='note'&&p.event.midi===61);
});
