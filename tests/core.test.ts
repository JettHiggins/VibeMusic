import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSession,type ClientMessage,type SessionCommand} from '../packages/contracts/src/index.ts';
import {EngineCore} from '../apps/web/src/engine/core.ts';
const dir='apps/web/public/engine';const ready=existsSync(`${dir}/voicesynth.wasm`);
async function setup(tempo=137){
 const module=await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
 const {FirmwareAudio}=await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const metadata=JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8'));const session=createSession();session.tempo=tempo;
 session.tracks[3].hits=[{id:'kick',step:0,lane:'kick',velocity:1}];
 const messages:ClientMessage[]=[];const dsp=new FirmwareAudio(module);
 const core=new EngineCore(dsp,metadata,session,'clock',m=>messages.push(m));
 let frame=0;
 const render=(frames:number)=>{const l=new Float32Array(frames),r=new Float32Array(frames);core.render(l,r,frame);frame+=frames;return l;};
 const command=(id:string,operation:SessionCommand['operation'],boundary:SessionCommand['boundary']='immediate',revision=core.getSession().revision)=>({id,expectedRevision:revision,boundary,operation});
 return {core,dsp,messages,render,command};
}
test('queued edit applies exactly at fractional four-bar boundary using firmware clock', {skip:!ready},async()=>{
 const s=await setup();s.core.dispatch(s.command('play',{type:'play',playing:true}));s.render(128);
 const clear=s.command('clear',{type:'clear',target:{trackId:'drums',lane:'kick'}},'next-loop');
 s.core.dispatch(clear);assert.equal(s.core.getSession().tracks[3].hits.length,1);
 const boundary=Math.ceil(44100*960/137);s.render(boundary-128);
 assert.equal(s.core.getSession().tracks[3].hits.length,1);
 s.render(1);assert.equal(s.core.getSession().tracks[3].hits.length,0);
 assert.equal(s.core.transport().loopStartFrame,boundary);
 assert.deepEqual(s.messages.filter(m=>m.type==='ack'&&m.commandId==='clear').map(m=>m.type==='ack'?m.status:''),['queued','applied']);
});
test('duplicate commands do not mutate twice; stale queued edits are rejected', {skip:!ready},async()=>{
 const s=await setup(120);const play=s.command('play',{type:'play',playing:true});s.core.dispatch(play);s.core.dispatch(play);assert.equal(s.core.getSession().revision,1);s.render(128);
 s.core.dispatch(s.command('tempo',{type:'tempo',bpm:140},'next-loop'));
 s.core.dispatch(s.command('mute',{type:'mute',trackId:'synth-1',muted:true}));
 s.render(44100*8);assert.equal(s.core.getSession().tempo,120);
 assert.ok(s.messages.some(m=>m.type==='ack'&&m.commandId==='tempo'&&m.status==='rejected'));
});
test('stop cancels pending mutations; clear and undo preserve session data', {skip:!ready},async()=>{
 const s=await setup();s.core.dispatch(s.command('clear',{type:'clear',target:{trackId:'drums'}},'next-loop'));assert.equal(s.core.getSession().tracks[3].hits.length,0);
 s.core.dispatch(s.command('undo',{type:'undo'},'next-loop'));assert.equal(s.core.getSession().tracks[3].hits.length,1);
 s.core.dispatch(s.command('play',{type:'play',playing:true}));s.render(128);
 s.core.dispatch(s.command('tempo',{type:'tempo',bpm:160},'next-loop'));
 s.core.dispatch(s.command('stop',{type:'play',playing:false}));s.render(128);
 assert.equal(s.core.transport().playing,false);assert.deepEqual(s.core.transport().pendingCommandIds,[]);assert.equal(s.core.getSession().tempo,137);
});
test('ten-minute offline render keeps firmware clock and loop frames aligned', {skip:!ready},async()=>{
 const s=await setup(137);s.core.dispatch(s.command('play',{type:'play',playing:true}));
 for(let second=0;second<600;second++)s.render(44100);
 assert.equal(s.core.transport().currentFrame,44100*600);
 assert.equal(s.dsp.w.vs_beat(),137*10);
 const loop=Math.floor((137*10)/16);
 assert.equal(s.core.transport().loopStartFrame,Math.ceil(loop*44100*960/137));
});
test('restart after several loops anchors the new first downbeat without a block offset', {skip:!ready},async()=>{
 const s=await setup(120);s.core.dispatch(s.command('play',{type:'play',playing:true}));s.render(44100*20);
 s.core.dispatch(s.command('stop',{type:'play',playing:false}));s.render(128);
 const start=s.core.transport().currentFrame;s.core.dispatch(s.command('restart',{type:'play',playing:true}));s.render(128);
 assert.equal(s.core.transport().loopStartFrame,start);assert.equal(s.dsp.w.vs_beat(),0);
});
test('record from stopped counts in, starts on downbeat, commits quantized events, and stops capture only', {skip:!ready},async()=>{
 const s=await setup(120);const target={trackId:'drums' as const,lane:'snare' as const};
 s.core.dispatch(s.command('record',{type:'record',target},'next-loop'));
 assert.equal(s.core.transport().recordingState,'armed');assert.equal(s.dsp.previous.g[2],2);
 const countin=s.render(352800);assert.ok(countin.some(v=>v!==0));assert.equal(s.core.transport().recording,false);
 s.render(1);assert.equal(s.core.transport().recording,true);assert.equal(s.core.transport().recordingStartFrame,352800);assert.equal(s.dsp.previous.g[2],0);
 s.render(12000);
 const captureFrame=352800+5500;
 s.core.dispatch(s.command('batch',{type:'commit-performance',events:[{kind:'onset',id:'snare-new',target,clockId:'clock',captureFrame,confidence:1,velocity:1}],excludedSpans:[],verifiedThroughFrame:s.core.transport().currentFrame},'next-loop'));
 assert.equal(s.core.getSession().tracks[3].hits.length,1);
 s.render(352800);assert.ok(s.core.getSession().tracks[3].hits.some(h=>h.id==='snare-new'&&h.step===1));
 s.core.dispatch(s.command('finish',{type:'stop-recording'}));s.render(128);
 assert.equal(s.core.transport().recording,false);assert.equal(s.core.transport().playing,true);
});
test('stopping an armed recording cancels the take and never enters recording', {skip:!ready},async()=>{
 const s=await setup(120);
 s.core.dispatch(s.command('record',{type:'record',target:{trackId:'synth-1'}},'next-loop'));s.render(128);
 s.core.dispatch(s.command('cancel',{type:'stop-recording'}));s.render(352800);
 assert.equal(s.core.transport().recordingState,'idle');assert.equal(s.core.transport().recording,false);
 assert.ok(s.messages.some(m=>m.type==='ack'&&m.commandId==='record'&&m.status==='rejected'));
});
