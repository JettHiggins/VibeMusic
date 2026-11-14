import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSession,type ClientMessage,type SessionCommand} from '../packages/contracts/src/index.ts';
import {EngineCore} from '../apps/web/src/engine/core.ts';
const dir='apps/web/public/engine',ready=existsSync(`${dir}/voicesynth.wasm`),SR=44100;
async function setup(tempo=120){
 const module=await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
 const {FirmwareAudio}=await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const state=createSession();state.tempo=tempo;state.tracks[3].hits=[{id:'original',step:0,lane:'kick',velocity:.8}];
 const messages:ClientMessage[]=[],core=new EngineCore(new FirmwareAudio(module),JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8')),state,'clock',m=>messages.push(m));
 let frame=0,n=0;
 const render=(count:number)=>{core.render(new Float32Array(count),new Float32Array(count),frame);frame+=count;};
 const dispatch=(operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate')=>core.dispatch({id:`request-${++n}`,expectedRevision:core.getSession().revision,boundary,operation});
 const target={trackId:'drums' as const,lane:'kick' as const};
 const record=()=>{dispatch({type:'record',target},'next-beat');render(Math.ceil(4*SR*60/tempo)+1);assert.equal(core.transport().recording,true);};
 const batch=(id:string,captureFrame:number,epoch=core.transport().recordingEpoch)=>dispatch({type:'commit-performance',events:[{kind:'onset',id,target,captureFrame,clockId:'clock',confidence:1,velocity:.9}],excludedSpans:[],verifiedThroughFrame:core.transport().currentFrame,...(epoch===undefined?{}:{recordingEpoch:epoch})},'next-loop');
 return {core,messages,render,dispatch,target,record,batch};
}
test('stopped recording has a one-bar count-in; playing recording starts at the next fractional beat', {skip:!ready},async()=>{
 for(const tempo of [120,137]){
  const s=await setup(tempo),bar=Math.ceil(4*SR*60/tempo);
  s.dispatch({type:'record',target:s.target},'next-beat');s.render(bar);
  assert.equal(s.core.transport().recordingState,'armed');s.render(1);
  assert.equal(s.core.transport().recordingStartFrame,bar);assert.equal(s.core.transport().loopStartFrame,0);
  const p=await setup(tempo);p.dispatch({type:'play',playing:true});p.render(1234);
  p.dispatch({type:'record',target:p.target},'next-beat');const next=Math.ceil(SR*60/tempo);
  p.render(next-1234);assert.equal(p.core.transport().recordingState,'armed');p.render(1);
  assert.equal(p.core.transport().recordingStartFrame,next);assert.equal(p.core.transport().recordingLoopStartFrame,0);
  p.render(1000);p.batch('first-mid-loop',next+100);
  p.render(Math.ceil(16*SR*60/tempo));
  const hit=p.core.getSession().tracks[3].hits.find(h=>h.id==='first-mid-loop');assert.equal(hit?.step,4,'capture is placed relative to the four-bar loop, not its own start');
 }
});
test('live clear resets capture before acks, removes queued audio, and rejects delayed pre-edit events', {skip:!ready},async()=>{
 const s=await setup();s.record();s.render(4000);
 const originalEpoch=s.core.transport().recordingEpoch!,eventFrame=s.core.transport().recordingStartFrame!+100;
 s.batch('old',eventFrame);const queued=s.core.transport().pendingCommandIds[0],before=s.messages.length;
 s.dispatch({type:'clear',target:s.target});
 assert.equal(s.core.getSession().tracks[3].hits.length,0);
 assert.equal(s.core.transport().recording,true);assert.equal(s.core.transport().playing,true);
 assert.equal(s.core.transport().pendingCommandIds.length,0);
 assert.equal(s.core.transport().recordingEpoch,originalEpoch+1);
 const notifications=s.messages.slice(before),reset=notifications.findIndex(m=>m.type==='transport'),rejected=notifications.findIndex(m=>m.type==='ack'&&m.commandId===queued);
 assert.ok(reset>=0&&reset<rejected,'input learns the cutoff before a rejected batch could be retried');
 const old=s.batch('delayed',eventFrame,originalEpoch);assert.ok(old.type==='ack'&&old.status==='rejected'&&old.reason?.includes('epoch'));
 const legacy=s.dispatch({type:'commit-performance',events:[{kind:'onset',id:'legacy-old',target:s.target,captureFrame:eventFrame,clockId:'clock',confidence:1,velocity:1}],excludedSpans:[],verifiedThroughFrame:s.core.transport().currentFrame},'next-loop');
 assert.ok(legacy.type==='ack'&&legacy.status==='rejected'&&legacy.reason?.includes('outside'));
 const fresh=s.core.transport().captureStartFrame!+100;s.render(256);s.batch('fresh',fresh);s.render(SR*8);
 assert.deepEqual(s.core.getSession().tracks[3].hits.map(h=>h.id),['fresh']);
});
test('Undo discards queued/provisional input first and then undoes the last edit without stopping capture', {skip:!ready},async()=>{
 const s=await setup();s.record();s.render(1000);
 const revision=s.core.getSession().revision;
 s.batch('pending',s.core.transport().recordingStartFrame!+100);
 s.dispatch({type:'undo'});
 assert.equal(s.core.getSession().revision,revision,'discarding uncommitted input is transport-only');
 assert.deepEqual(s.core.getSession().tracks[3].hits.map(h=>h.id),['original']);
 assert.equal(s.core.transport().pendingCommandIds.length,0);
 // The input owner uses this flag when its worker has provisional events not submitted yet.
 const epoch=s.core.transport().recordingEpoch!;s.dispatch({type:'undo',discardCaptureOnly:true});
 assert.equal(s.core.transport().recordingEpoch,epoch+1);assert.equal(s.core.getSession().revision,revision);
 s.dispatch({type:'clear',target:s.target});assert.equal(s.core.getSession().tracks[3].hits.length,0);
 s.dispatch({type:'undo'});assert.deepEqual(s.core.getSession().tracks[3].hits.map(h=>h.id),['original']);
 assert.equal(s.core.transport().recording,true);assert.equal(s.core.transport().playing,true);
 s.render(SR*8);assert.deepEqual(s.core.getSession().tracks[3].hits.map(h=>h.id),['original']);
});
test('count-in can be cancelled and next-beat is not accepted for unrelated operations', {skip:!ready},async()=>{
 const s=await setup();s.dispatch({type:'record',target:s.target},'next-beat');s.render(1000);
 s.dispatch({type:'stop-recording'});s.render(SR*3);assert.equal(s.core.transport().recordingState,'idle');assert.equal(s.core.transport().playing,true);
 const bad=s.dispatch({type:'clear',target:s.target},'next-beat');assert.ok(bad.type==='ack'&&bad.status==='rejected');
});
test('clearing another lane preserves the active capture window; tempo undo keeps its grid anchored', {skip:!ready},async()=>{
 const s=await setup();s.record();s.render(2000);
 const epoch=s.core.transport().recordingEpoch;
 s.dispatch({type:'clear',target:{trackId:'drums',lane:'snare'}});
 assert.equal(s.core.transport().recordingEpoch,epoch);
 const t=await setup(120);t.dispatch({type:'tempo',bpm:137},'next-loop');
 t.dispatch({type:'record',target:t.target},'next-beat');t.render(Math.ceil(4*SR*60/137)+1);
 t.dispatch({type:'undo'});assert.equal(t.core.getSession().tempo,120);assert.equal(t.core.transport().recording,true);
 const cutoff=t.core.transport().captureStartFrame!;t.render(256);t.batch('after-tempo-undo',cutoff+100);t.render(SR*9);
 assert.ok(t.core.getSession().tracks[3].hits.some(h=>h.id==='after-tempo-undo'));
});

test('unrelated edits during count-in preserve the armed record deadline and target', {skip:!ready},async()=>{
 const s=await setup();s.dispatch({type:'record',target:s.target},'next-beat');s.render(SR/2);
 s.dispatch({type:'mute',trackId:'synth-1',muted:true});s.dispatch({type:'select',target:{trackId:'synth-3'}});
 s.render(SR*1.5);assert.equal(s.core.transport().recordingState,'armed');s.render(1);
 assert.equal(s.core.transport().recordingStartFrame,SR*2);
 assert.deepEqual(s.core.transport().recordingTarget,s.target);
 assert.equal(s.core.getSession().tracks[0].muted,true);assert.deepEqual(s.core.getSession().selected,s.target);
});

test('discard-only Undo cancels queued piano-roll edits despite retaining revision', {skip:!ready},async()=>{
 const s=await setup();s.record();s.render(1000);
 const revision=s.core.getSession().revision;
 const queued=s.dispatch({type:'edit-pattern',trackId:'synth-1',hits:[],notes:[{id:'pending-ui-note',step:8,duration:2,midi:64,velocity:.8}]},'next-loop');
 assert.ok(queued.type==='ack'&&queued.status==='queued');
 s.dispatch({type:'undo',discardCaptureOnly:true});
 assert.equal(s.core.getSession().revision,revision);
 s.render(SR*9);
 assert.equal(s.core.getSession().tracks[0].notes.length,0);
 assert.ok(s.messages.some(m=>m.type==='ack'&&m.commandId===queued.commandId&&m.status==='rejected'&&m.reason?.includes('discarded')));
 assert.equal(s.core.transport().recording,true);
});
