import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSession,type SessionCommand} from '../packages/contracts/src/index.ts';
import {EngineCore} from '../apps/web/src/engine/core.ts';
const dir='apps/web/public/engine',ready=existsSync(`${dir}/voicesynth.wasm`),SR=44100;
async function setup(tempo=120,initialFrame=0){
 const {FirmwareAudio}=await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const state=createSession();state.tempo=tempo;
 const dsp=new FirmwareAudio(await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`)));
 const core=new EngineCore(dsp,JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8')),state,'clock',()=>{},initialFrame);
 let frame=initialFrame,id=0;
 const render=(count:number)=>{const left=new Float32Array(count);core.render(left,new Float32Array(count),frame);frame+=count;return left;};
 const send=(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate',commandId=`request-${++id}`)=>core.dispatch({id:commandId,expectedRevision:core.getSession().revision,boundary,operation});
 return {core,dsp,render,send,target:{trackId:'drums' as const,lane:'kick' as const}};
}
test('Record after a previous play/stop uses four beats, not the old firmware beat count', {skip:!ready},async()=>{
 const s=await setup();s.send({type:'play',playing:true});s.render(SR*40);s.send({type:'play',playing:false});s.render(128);
 const start=s.core.transport().currentFrame;assert.equal(s.dsp.w.vs_beat(),80);
 s.send({type:'record',target:s.target},'next-beat');s.render(SR*2+1);
 assert.equal(s.core.transport().recordingState,'recording');assert.equal(s.core.transport().recordingStartFrame,start+SR*2);
});
test('stopped count-in pins the actual nonzero audio frame at several tempos', {skip:!ready},async()=>{
 for(const tempo of [60,120,137,180]){
  const initial=SR*97+13,s=await setup(tempo,initial),beat=SR*60/tempo,deadline=initial+Math.ceil(4*beat);
  s.send({type:'record',target:s.target},'next-beat');
  assert.equal(s.core.transport().armedStartFrame,deadline);assert.equal(s.core.transport().countInBeatsRemaining,4);
  s.render(Math.ceil(beat));assert.equal(s.core.transport().countInBeatsRemaining,3);
  s.render(Math.ceil(4*beat)-Math.ceil(beat));assert.equal(s.core.transport().recordingState,'armed');
  assert.equal(s.core.transport().countInBeatsRemaining,0);s.render(1);
  assert.equal(s.core.transport().recordingStartFrame,deadline);assert.equal(s.core.transport().armedStartFrame,undefined);
  assert.equal(s.core.transport().countInBeatsRemaining,undefined);
 }
});
test('repeated Record, tempo changes and musical edits cannot extend a count-in', {skip:!ready},async()=>{
 const s=await setup();s.send({type:'record',target:s.target},'next-beat','original');const deadline=s.core.transport().armedStartFrame;
 s.render(SR/2);const again=s.send({type:'record',target:s.target},'next-beat');assert.ok(again.type==='ack'&&again.status==='rejected');
 const play=s.send({type:'play',playing:true});assert.ok(play.type==='ack'&&play.status==='rejected');
 const tempo=s.send({type:'tempo',bpm:180},'next-loop');assert.ok(tempo.type==='ack'&&tempo.status==='rejected');
 s.send({type:'mute',trackId:'synth-1',muted:true});s.send({type:'select',target:{trackId:'synth-3'}});
 s.send({type:'record',target:s.target},'next-beat','original');assert.equal(s.core.transport().armedStartFrame,deadline);
 s.render(SR*1.5+1);assert.equal(s.core.transport().recordingStartFrame,deadline);
 const active=s.send({type:'record',target:{trackId:'synth-2'}},'next-beat');assert.ok(active.type==='ack'&&active.status==='rejected');
 assert.deepEqual(s.core.transport().recordingTarget,s.target);
});
test('count-in cancellation clears its deadline and legacy explicit next-loop waits four bars', {skip:!ready},async()=>{
 const s=await setup();s.send({type:'record',target:s.target},'next-beat');s.render(1000);s.send({type:'stop-recording'});
 assert.equal(s.core.transport().armedStartFrame,undefined);assert.equal(s.core.transport().countInBeatsRemaining,undefined);
 s.render(SR*3);assert.equal(s.core.transport().recordingState,'idle');assert.equal(s.core.transport().playing,true);
 const legacy=await setup();legacy.send({type:'record',target:legacy.target},'next-loop');
 assert.equal(legacy.core.transport().armedStartFrame,SR*8);assert.equal(legacy.core.transport().countInBeatsRemaining,undefined);
 legacy.render(SR*8);assert.equal(legacy.core.transport().recordingState,'armed');legacy.render(1);assert.equal(legacy.core.transport().recording,true);
});

test('metronome defaults on during play/capture, mutes independently and never enters musical history', {skip:!ready},async()=>{
 const s=await setup();assert.equal(s.core.transport().metronomeEnabled,true);
 assert.ok(s.render(1024).every(v=>v===0),'stopped empty project stays silent');
 s.send({type:'play',playing:true});assert.ok(s.render(SR).some(v=>v!==0),'empty playing project has a click');
 const revision=s.core.getSession().revision;
 s.send({type:'metronome',enabled:false});assert.equal(s.core.getSession().revision,revision);assert.equal(s.core.transport().metronomeEnabled,false);
 s.render(SR);assert.ok(s.render(SR).every(v=>v===0),'muted empty loop has no ongoing click');
 const undo=s.send({type:'undo'});assert.ok(undo.type==='ack'&&undo.status==='rejected','toggle did not create Undo history');
 s.send({type:'metronome',enabled:true});s.send({type:'record',target:s.target},'next-beat');s.render(SR);
 assert.equal(s.core.transport().recording,true);s.send({type:'stop-recording'});
 assert.ok(s.render(SR).some(v=>v!==0),'stopping capture keeps playback metronome');
 assert.ok(s.core.getSession().tracks.every(t=>!t.notes.length&&!t.hits.length));
 const bad=s.send({type:'metronome',enabled:false},'next-loop');assert.ok(bad.type==='ack'&&bad.status==='rejected');
 assert.equal(s.core.transport().metronomeEnabled,true);
 s.send({type:'play',playing:false});s.render(SR);assert.ok(s.render(SR).every(v=>v===0));
});
