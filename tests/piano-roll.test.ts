import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createSession, type ClientMessage } from '../packages/contracts/src/index.ts';
import { PatternEditQueue, deleteNote, moveNote, placeNote, resizeNote } from '../apps/web/src/ui/pattern-edit.ts';
import { cellAt, centerPitch, isBlackKey, visibleRows } from '../apps/web/src/ui/piano-roll-geometry.ts';

let n = 0; const id = () => `n${++n}`;
const base = () => ({ notes: [{ id: 'a', step: 0, duration: 4, midi: 60, velocity: 0.8 }, { id: 'b', step: 8, duration: 4, midi: 64, velocity: 0.8 }], hits: [] });

test('move, resize and delete keep a synth track monophonic like the engine', () => {
 const moved = moveNote('a', 6, 67)(base(), id);
 assert.deepEqual(moved.notes.map(x => [x.id, x.step, x.duration, x.midi]).sort(), [['a', 6, 4, 67]], 'moving onto b replaces it');
 const resized = resizeNote('a', 10)(base(), id);
 assert.deepEqual(resized.notes.map(x => [x.id, x.step, x.duration]), [['a', 0, 10]], 'lengthening over b replaces it');
 assert.equal(resizeNote('a', 0)(base(), id).notes.find(x => x.id === 'a')!.duration, 1);
 assert.deepEqual(moveNote('a', -2, 200)(base(), id).notes.find(x => x.id === 'a'), { id: 'a', step: 62, duration: 4, midi: 127, velocity: 0.8 }, 'wraps steps and clamps pitch');
 assert.deepEqual(deleteNote('b')(base(), id).notes.map(x => x.id), ['a']);
 assert.equal(moveNote('missing', 1, 60)(base(), id).notes.length, 2, 'unknown IDs (e.g. still pending) are a no-op');
});

test('rolls center on C4 when empty and on the notes otherwise; pointer maps to step and pitch', () => {
 assert.equal(centerPitch([]), 60);
 assert.equal(centerPitch([{ midi: 72 }, { midi: 74 }, { midi: 76 }]), 74);
 const rows = visibleRows(60);
 assert.equal(rows.length, 25);
 assert.equal(rows[12], 60, 'C4 is the middle row');
 assert.equal(visibleRows(2)[24], 0, 'clamped at the bottom');
 assert.equal(visibleRows(126)[0], 127, 'clamped at the top');
 assert.deepEqual(cellAt(0, 0, 640, 12, rows), { step: 0, midi: 72 });
 assert.deepEqual(cellAt(639, 12 * 12 + 5, 640, 12, rows), { step: 63, midi: 60 });
 assert.deepEqual(cellAt(325, 30, 640, 12, rows), { step: 32, midi: 70 });
 assert.equal(cellAt(-1, 0, 640, 12, rows), null);
 assert.equal(cellAt(10, 12 * 25, 640, 12, rows), null);
 assert.equal(isBlackKey(61), true); assert.equal(isBlackKey(60), false);
});

test('piano-roll edits through the queue apply in the real engine', { skip: !existsSync('apps/web/public/engine/voicesynth.wasm') }, async () => {
 const { EngineCore } = await import('../apps/web/src/engine/core.ts');
 const dir = 'apps/web/public/engine';
 const module = await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
 const { FirmwareAudio } = await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const metadata = JSON.parse(readFileSync(`${dir}/metadata.json`, 'utf8'));
 const start = createSession(); start.tracks[0].notes = base().notes;
 const listeners: ((m: ClientMessage) => void)[] = [];
 const core = new EngineCore(new FirmwareAudio(module), metadata, start, 'c', m => listeners.forEach(l => l(m)));
 const q = new PatternEditQueue({ dispatch: c => core.dispatch(c), newId: id });
 listeners.push(m => q.handle(m)); q.handle({ type: 'session', session: core.getSession() });
 q.edit('synth-1', moveNote('b', 20, 65));
 q.edit('synth-1', resizeNote('a', 6));
 q.edit('synth-1', placeNote(40, 72, 8));
 assert.deepEqual(core.getSession().tracks[0].notes.map(x => [x.step, x.duration, x.midi]).sort((x, y) => x[0] - y[0]), [[0, 6, 60], [20, 4, 65], [40, 8, 72]]);
 q.edit('synth-1', deleteNote('a'));
 assert.deepEqual(core.getSession().tracks[0].notes.map(x => x.step).sort((x, y) => x - y), [20, 40]);
 assert.equal(q.lastError, null);
});

test('unapplied notes get unique placeholder IDs (no duplicate keys left behind in the view)', () => {
 const session = createSession();
 const q = new PatternEditQueue({ dispatch: c => ({ type: 'ack', commandId: c.id, status: 'queued', revision: 0 }), newId: id });
 q.handle({ type: 'session', session });
 q.edit('synth-1', placeNote(0, 60, 2)); // in flight
 q.edit('synth-1', placeNote(8, 62, 2)); // queued
 q.edit('synth-1', placeNote(16, 64, 2));
 const ids = q.view('synth-1').notes.map(x => x.id);
 assert.equal(new Set(ids).size, ids.length, `ids ${ids}`);
 assert.ok(ids.every(i => PatternEditQueue.isPlaceholder(i)));
});
