import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createSession, type ClientMessage } from '../packages/contracts/src/index.ts';
import { PatchEditQueue, patchControls, withEngine, withParameter } from '../apps/web/src/ui/patch-edit.ts';

const dir = 'apps/web/public/engine';
const ready = existsSync(`${dir}/voicesynth.wasm`);

test('controls expose common envelope/filter plus named engine macros with firmware ranges', { skip: !ready }, () => {
 const metadata = JSON.parse(readFileSync(`${dir}/metadata.json`, 'utf8'));
 const patch = withEngine(createSession().tracks[0].patch, 1, 0);
 const controls = patchControls(patch, metadata);
 assert.deepEqual(controls.slice(0, 4).map(c => c.name), ['ATK', 'DEC', 'REL', 'FLT']);
 const macros = controls.slice(4);
 assert.ok(macros.length >= 6 && macros.every(c => c.name !== '-' && c.max > c.min));
 assert.ok(controls.every(c => c.value >= c.min && c.value <= c.max), 'values default to the factory preset');
 const edited = withParameter(patch, macros[0].id, macros[0].max);
 assert.equal(patchControls(edited, metadata)[4].value, macros[0].max);
});

test('rapid sound changes apply latest-wins through the real engine and preserve the music', { skip: !ready }, async () => {
 const { EngineCore } = await import('../apps/web/src/engine/core.ts');
 const module = await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
 const { FirmwareAudio } = await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const metadata = JSON.parse(readFileSync(`${dir}/metadata.json`, 'utf8'));
 const start = createSession(); start.tracks[0].notes.push({ id: 'n', step: 0, duration: 4, midi: 60, velocity: 0.8 });
 const listeners: ((m: ClientMessage) => void)[] = [];
 const core = new EngineCore(new FirmwareAudio(module), metadata, start, 'clock', m => listeners.forEach(l => l(m)));
 let n = 0;
 const q = new PatchEditQueue({ dispatch: c => core.dispatch(c), newId: () => `p${++n}` });
 listeners.push(m => q.handle(m));
 q.handle({ type: 'session', session: core.getSession() });
 // Playing: edits queue for the boundary, so successive slider moves coalesce.
 core.dispatch({ id: 'play', expectedRevision: core.getSession().revision, boundary: 'immediate', operation: { type: 'play', playing: true } });
 { const l = new Float32Array(128), r = new Float32Array(128); core.render(l, r, 0); }
 const base = withEngine(core.getSession().tracks[0].patch, 9, 2);
 q.set('synth-1', base);
 const cutoff = patchControls(base, metadata).find(c => c.name === 'FLT')!;
 for (const v of [-20, 10, 40]) q.set('synth-1', withParameter(q.view('synth-1')!, cutoff.id, v));
 assert.ok(q.pending('synth-1'));
 const loop = Math.ceil(44100 * 960 / 120);
 for (let i = 0; i < 3; i++) { const l = new Float32Array(loop), r = new Float32Array(loop); core.render(l, r, 128 + i * loop); }
 const patch = core.getSession().tracks[0].patch;
 assert.equal(patch.engine, 9); assert.equal(patch.preset, 2);
 assert.equal(patch.parameters[String(cutoff.id)], 40, 'latest value wins');
 assert.deepEqual(core.getSession().tracks[0].notes.map(x => x.id), ['n'], 'notes preserved');
 assert.equal(q.pending('synth-1'), false); assert.equal(q.lastError, null);
});
