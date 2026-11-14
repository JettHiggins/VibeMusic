import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createSession} from '../packages/contracts/src/index.ts';
import {firmwareSnapshot} from '../apps/web/src/engine/snapshot.ts';
import type {FirmwareMetadata} from '../apps/web/src/engine/metadata.ts';
const dir='apps/web/public/engine';
const ready=existsSync(`${dir}/metadata.json`);
function metadata():FirmwareMetadata{return JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8'));}
test('snapshot maps all four bars, ties, mixer, and independent drum lanes', {skip:!ready},()=>{
 const session=createSession();session.tracks[0].notes=[{id:'held',step:62,duration:4,midi:60,velocity:0.8}];session.tracks[3].hits=[{id:'kick',step:63,lane:'kick',velocity:1},{id:'hat',step:63,lane:'closed-hat',velocity:0.5}];
 const original=structuredClone(session);const state=firmwareSnapshot(session,metadata());
 assert.equal(state.tracks[0].step[62].time,0);for(const i of [63,0,1])assert.equal(state.tracks[0].step[i].time,1);
 assert.equal(state.tracks[3].dstep[63].on,17);assert.equal(state.tracks[0].p[29],64);assert.equal(state.g[0],120);assert.deepEqual(session,original);
});
test('snapshot rejects incompatible patches, overlapping notes, and invalid track order', {skip:!ready},()=>{
 const session=createSession();session.tracks[0].patch.parameters={'1000':1};assert.throws(()=>firmwareSnapshot(session,metadata()),/parameter/);
 session.tracks[0].patch.parameters={};session.tracks[0].notes=[{id:'a',step:63,duration:2,midi:60,velocity:1},{id:'b',step:0,duration:1,midi:64,velocity:1}];assert.throws(()=>firmwareSnapshot(session,metadata()),/Overlapping/);
 session.tracks[0].notes=[];session.tracks.reverse();assert.throws(()=>firmwareSnapshot(session,metadata()),/slot order/);
});
test('our snapshot produces real audible finite output for every SLOOP engine', {skip:!ready},async()=>{
 const module=await WebAssembly.compile(readFileSync(`${dir}/sloop-preview.wasm`));
 const workletUrl=pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href;
 const {FirmwareAudio}=await import(workletUrl);
 const m=metadata();
 for(let engine=0;engine<12;engine++){
  const session=createSession();session.tracks.forEach((t,k)=>t.muted=k!==0);session.tracks[0].patch.engine=engine;
  const dsp=new FirmwareAudio(module);dsp.sync(firmwareSnapshot(session,m));dsp.w.preview_note(0,60,1);
  const l=new Float32Array(8192),r=new Float32Array(8192);dsp.render(l,r);
  assert.ok([...l,...r].every(x=>Number.isFinite(x)&&Math.abs(x)<=1));assert.ok(l.reduce((a,b)=>a+Math.abs(b),0)>0.01,`engine ${engine} must sound`);
 }
});
test('duplicate pattern event IDs and oversized imported patterns cannot reach firmware', {skip:!ready},()=>{
 const session=createSession();session.tracks[0].notes=[{id:'same',step:0,duration:1,midi:60,velocity:1},{id:'same',step:2,duration:1,midi:64,velocity:1}];
 assert.throws(()=>firmwareSnapshot(session,metadata()),/Duplicate/);
 session.tracks[0].notes=Array.from({length:65},(_,i)=>({id:String(i),step:0,duration:1,midi:60,velocity:1}));
 assert.throws(()=>firmwareSnapshot(session,metadata()));
});
