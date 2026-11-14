import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {renderPatch,type RenderRequest} from '../tools/offline-renderer.ts';
import {createSession} from '../packages/contracts/src/index.ts';
import {firmwareSnapshot} from '../apps/web/src/engine/snapshot.ts';
import type {FirmwareMetadata} from '../apps/web/src/engine/metadata.ts';
const ready=existsSync('apps/web/public/engine/voicesynth.wasm');
const recipe={name:'fixed-test',seconds:0.5,notes:[[0,0.25,60,0.8] as [number,number,number,number]]};
function request(engine=1):RenderRequest{const patch=createSession().tracks[0].patch;patch.engine=engine;return {patch,recipe};}
test('real offline render is deterministic, finite, unnormalized, and patch dependent', {skip:!ready},async()=>{
 const a=await renderPatch(request()),b=await renderPatch(request()),c=await renderPatch(request(0));
 assert.equal(a.length,22050);assert.deepEqual(a,b);assert.notDeepEqual(a,c);
 assert.ok(a.some(v=>Math.abs(v)>0.001));assert.ok(a.every(v=>Number.isFinite(v)&&Math.abs(v)<=1));
 const quiet=request();quiet.recipe={...recipe,notes:[[0,0.25,60,0.2]]};
 const low=await renderPatch(quiet);
 assert.ok(low.reduce((sum,v)=>sum+v*v,0)<a.reduce((sum,v)=>sum+v*v,0));
});
test('renderer rejects incompatible patches and notes outside recipe before producing audio', {skip:!ready},async()=>{
 const bad=request();bad.patch.engineRevision='unknown';await assert.rejects(()=>renderPatch(bad),/revision/);
 await assert.rejects(()=>renderPatch({...request(),recipe:{...recipe,notes:[[0.4,0.2,60,1]]}}),/beyond/);
});
test('all complete factory research patches preserve session-owned mixer and timing', {skip:!ready},()=>{
 const metadata:FirmwareMetadata=JSON.parse(readFileSync('apps/web/public/engine/metadata.json','utf8'));
 for(const [engine,data] of metadata.engines.entries())for(const [preset,patch] of data.presets.entries()){
  const session=createSession();session.tracks[0].volume=0.5;session.tracks[0].patch={...session.tracks[0].patch,engine,preset,parameters:Object.fromEntries(patch.parameters.map((v,i)=>[String(i),v]))};
  const snapshot=firmwareSnapshot(session,metadata);const p=snapshot.tracks[0].p;
  assert.equal(p[0],64);assert.equal(p[17],0);assert.equal(p[29],64);assert.equal(p[30],2);assert.equal(p[40],0);
 }
});
