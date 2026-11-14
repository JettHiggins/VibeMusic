import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createSession,type SessionCommand} from '../packages/contracts/src/index.ts';
import {EngineCore,type FirmwareBridge} from '../apps/web/src/engine/core.ts';
import {OutputTransition} from '../apps/web/src/engine/output-transition.ts';
import type {FirmwareMetadata} from '../apps/web/src/engine/metadata.ts';
const metadataPath='apps/web/public/engine/metadata.json';
const rate=44100,loop=rate*8,fade=Math.round(rate*.005);
function setup(){
 const memory=new WebAssembly.Memory({initial:1});let frame=0,playing=false,value=.75;
 const metadata=JSON.parse(readFileSync(metadataPath,'utf8')) as FirmwareMetadata;
 const dsp:FirmwareBridge={sync:state=>{value=state.tracks[0].engine===0?.75:-.75;},w:{memory,
  vs_playing:()=>+playing,vs_beat:()=>Math.floor(frame*120/(rate*60)),vs_phase:()=>frame*120%(rate*60),
  preview_play:on=>{playing=!!on;return 0;},preview_panic:()=>0,vs_note:()=>0,
  vs_render:frames=>{const data=new Float32Array(memory.buffer,0,frames*2);for(let i=0;i<frames;i++){data[i*2]=value;data[i*2+1]=-value;}frame+=frames;return 0;}}};
 const core=new EngineCore(dsp,metadata,createSession(),'clock',()=>{});let outputFrame=0,n=0;
 const command=(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate')=>core.dispatch({id:`cmd-${++n}`,expectedRevision:core.getSession().revision,boundary,operation});
 const render=(frames:number)=>{const l=new Float32Array(frames),r=new Float32Array(frames);core.render(l,r,outputFrame);outputFrame+=frames;return {l,r};};
 return {core,command,render};
}
test('patch and undo transitions remove an output jump at the exact musical boundary', {skip:!existsSync(metadataPath)},()=>{
 const s=setup();s.command({type:'play',playing:true});s.render(128);
 const patch={...s.core.getSession().tracks[0].patch,engine:1};
 s.command({type:'apply-patch',trackId:'synth-1',patch},'next-loop');
 const before=s.render(loop-128);assert.equal(before.l.at(-1),.75);
 const after=s.render(fade+1);assert.equal(s.core.transport().loopStartFrame,loop);
 assert.equal(s.core.getSession().tracks[0].patch.engine,1);
 assert.equal(after.l[0],.75);assert.equal(after.r[0],-.75);
 assert.equal(after.l[fade-1],-.75);assert.equal(after.r[fade-1],.75);
 assert.ok(after.l.every(v=>v>=-.75&&v<=.75),'convex blend does not overshoot');
 const delta=Math.max(...after.l.slice(1).map((v,i)=>Math.abs(v-after.l[i])));assert.ok(delta<.011,'instantaneous 1.5 amplitude jump is spread over five milliseconds');
 s.command({type:'undo'},'next-loop');s.render(loop-fade-1);
 const undone=s.render(fade);assert.equal(undone.l[0],-.75);assert.equal(undone.l.at(-1),.75);
});
test('rejected and unchanged patches leave the rendered waveform unchanged', {skip:!existsSync(metadataPath)},()=>{
 const s=setup();s.render(64);
 const receipt=s.command({type:'apply-patch',trackId:'synth-1',patch:{...s.core.getSession().tracks[0].patch,engine:99}},'next-loop');
 assert.ok(receipt.type==='ack'&&receipt.status==='rejected');
 s.command({type:'select',target:{trackId:'synth-2'}});
 assert.ok(s.render(500).l.every(v=>v===.75));
});
test('immediate mid-loop patches use the same five-millisecond transition without waiting for a boundary', {skip:!existsSync(metadataPath)},()=>{
 const s=setup();s.command({type:'play',playing:true});s.render(128);
 const ack=s.command({type:'apply-patch',trackId:'synth-1',patch:{...s.core.getSession().tracks[0].patch,engine:1}},'immediate');
 assert.ok(ack.type==='ack'&&ack.status==='applied');
 const after=s.render(fade+1);assert.equal(s.core.transport().loopStartFrame,0);
 assert.equal(after.l[0],.75);assert.equal(after.r[0],-.75);
 assert.equal(after.l[fade-1],-.75);assert.equal(after.r[fade-1],.75);
 assert.ok(after.l.every(Number.isFinite));
});
test('the transition is invariant to block sizes and a new patch starts from the current blended output',()=>{
 const run=(blocks:number[])=>{
  const output=new OutputTransition(rate),l=new Float32Array(800),r=new Float32Array(800);let offset=0;
  output.write(l,r,offset++,.7,-.7);output.begin();
  for(const count of blocks)for(let i=0;i<count;i++)output.write(l,r,offset++,-.5,.5);
  const previous=l[offset-1];output.begin();output.write(l,r,offset++,.9,-.9);
  assert.equal(l[offset-1],previous);
  return l.slice(0,offset);
 };
 assert.deepEqual(run([100]),run([1,31,68]));
});
