import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import type {FirmwareMetadata} from '../apps/web/src/engine/metadata.ts';
const dir='apps/web/public/engine';
test('built firmware has complete parameter and preset metadata', {skip:!existsSync(`${dir}/metadata.json`)},()=>{
 const data:FirmwareMetadata=JSON.parse(readFileSync(`${dir}/metadata.json`,'utf8'));
 assert.equal(data.steps,64);assert.equal(data.sampleRate,44100);assert.equal(data.engines.length,12);
 assert.equal(data.parameters.length,data.engineParamOffset);
 for(const engine of data.engines){assert.equal(engine.parameters.length,8);assert.ok(engine.presets.length>0);for(const preset of engine.presets){assert.equal(preset.parameters.length,data.engineParamOffset+8);assert.ok(preset.parameters.every(Number.isFinite));}}
});
test('built firmware is standalone and exports real DSP entrypoints', {skip:!existsSync(`${dir}/sloop-preview.wasm`)},async()=>{
 const module=await WebAssembly.compile(readFileSync(`${dir}/sloop-preview.wasm`));
 assert.deepEqual(WebAssembly.Module.imports(module),[]);
 const exports=new Set(WebAssembly.Module.exports(module).map(x=>x.name));
 for(const name of ['preview_render','preview_step','preview_position','preview_param','preview_play'])assert.ok(exports.has(name));
});
