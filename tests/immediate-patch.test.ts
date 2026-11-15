import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createSession,type SessionCommand} from '../packages/contracts/src/index.ts';
import {EngineCore} from '../apps/web/src/engine/core.ts';
const dir='apps/web/public/engine',ready=existsSync(`${dir}/voicesynth.wasm`),SR=44100;
async function setup(){
 const {FirmwareAudio}=await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const dsp=new FirmwareAudio(await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`)));
 const state=createSession();state.tracks[0].notes=[{id:'held',step:0,duration:32,midi:60,velocity:.8}];
 state.tracks[3].hits=[{id:'kick',step:0,lane:'kick',velocity:.8}];
 const core=new EngineCore(dsp,JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8')),state,'clock',()=>{});
 let frame=0,id=0;
 const render=(count:number)=>{const l=new Float32Array(count);core.render(l,new Float32Array(count),frame);frame+=count;return l;};
 const send=(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate',revision=core.getSession().revision)=>core.dispatch({id:`patch-${++id}`,expectedRevision:revision,boundary,operation});
 return {core,dsp,render,send};
}
test('an immediate patch applies mid-loop during capture without moving the clock or musical events',{skip:!ready},async()=>{
 const s=await setup();s.send({type:'play',playing:true});s.render(SR);
 s.send({type:'record',target:{trackId:'drums',lane:'kick'}},'next-beat');s.render(SR/2+1);
 const before=s.core.getSession(),transport=s.core.transport(),phase=s.dsp.w.vs_phase();assert.equal(transport.recording,true);
 const patch={...before.tracks[0].patch,engine:1,preset:2};
 const ack=s.send({type:'apply-patch',trackId:'synth-1',patch});
 assert.ok(ack.type==='ack'&&ack.status==='applied','must acknowledge now, not queue for four bars');
 assert.equal(s.core.getSession().revision,before.revision+1);
 assert.deepEqual(s.core.getSession().tracks[0].patch,patch);
 assert.deepEqual(s.core.getSession().tracks.map(t=>({notes:t.notes,hits:t.hits})),before.tracks.map(t=>({notes:t.notes,hits:t.hits})));
 assert.deepEqual(s.core.getSession().tracks.slice(1),before.tracks.slice(1));
 assert.equal(s.core.transport().currentFrame,transport.currentFrame);assert.equal(s.core.transport().loopStartFrame,transport.loopStartFrame);
 assert.equal(s.core.transport().recordingEpoch,transport.recordingEpoch);assert.equal(s.core.transport().recordingStartFrame,transport.recordingStartFrame);
 assert.equal(s.dsp.w.vs_phase(),phase);assert.ok(s.render(256).every(Number.isFinite));
 s.send({type:'undo'});assert.deepEqual(s.core.getSession().tracks[0].patch,before.tracks[0].patch);
 assert.equal(s.core.transport().playing,true);assert.equal(s.core.transport().recording,true);
});
test('legacy explicit next-loop patches still wait, and invalid/stale requests do not mutate',{skip:!ready},async()=>{
 const s=await setup();s.send({type:'play',playing:true});s.render(SR);
 const before=s.core.getSession(),patch={...before.tracks[0].patch,engine:1,preset:1};
 const queued=s.send({type:'apply-patch',trackId:'synth-1',patch},'next-loop');assert.ok(queued.type==='ack'&&queued.status==='queued');
 s.render(SR);assert.deepEqual(s.core.getSession().tracks[0].patch,before.tracks[0].patch);
 s.render(SR*6+1);assert.deepEqual(s.core.getSession().tracks[0].patch,patch);
 const applied=s.core.getSession();
 for(const [boundary,revision,p] of [['next-beat',applied.revision,patch],['immediate',applied.revision-1,patch],['immediate',applied.revision,{...patch,engine:999}]] as const){
  const ack=s.send({type:'apply-patch',trackId:'synth-1',patch:p},boundary,revision);assert.ok(ack.type==='ack'&&ack.status==='rejected');assert.deepEqual(s.core.getSession(),applied);
 }
});
