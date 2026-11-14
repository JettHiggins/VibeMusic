import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createSession, type ClientMessage, type SessionCommand } from '../packages/contracts/src/index.ts';
import { PatternEditQueue, placeNote, removeNoteAt, toggleHit } from '../apps/web/src/ui/pattern-edit.ts';

let n = 0; const id = () => `x${++n}`;

test('pattern ops toggle hits per lane, keep notes monophonic across the loop edge, and remove notes', () => {
 const empty = { notes: [], hits: [] };
 const one = toggleHit('kick', 4)(empty, id);
 assert.deepEqual(one.hits.map(h => [h.lane, h.step]), [['kick', 4]]);
 const two = toggleHit('snare', 4)(one, id);
 assert.equal(two.hits.length, 2, 'other lanes at the same step are untouched');
 assert.deepEqual(toggleHit('kick', 4)(two, id).hits.map(h => h.lane), ['snare']);
 const wrap = placeNote(62, 60, 4)(empty, id);
 const replaced = placeNote(1, 64, 2)(placeNote(8, 67, 2)(wrap, id), id);
 assert.deepEqual(replaced.notes.map(x => [x.step, x.midi]).sort((a, b) => a[0] - b[0]), [[1, 64], [8, 67]], 'note wrapping into step 1 was replaced');
 assert.deepEqual(removeNoteAt(9)(replaced, id).notes.map(x => x.midi), [64]);
});

/** Engine double with boundary queueing and stale-revision checks. */
function fake() {
 let session = createSession();
 const queue: SessionCommand[] = [], sent: SessionCommand[] = [];
 const listeners: ((m: ClientMessage) => void)[] = [];
 const emit = (m: ClientMessage) => listeners.forEach(l => l(m));
 const ack = (c: SessionCommand, status: 'queued' | 'applied' | 'rejected', reason?: string): ClientMessage => { const m: ClientMessage = { type: 'ack', commandId: c.id, status, revision: session.revision, ...(reason ? { reason } : {}) }; emit(m); return m; };
 return {
  sent, listeners, get session() { return session; },
  dispatch: (c: SessionCommand) => { sent.push(c); queue.push(c); return ack(c, 'queued'); },
  boundary() {
   for (const c of queue.splice(0)) {
    if (c.expectedRevision !== session.revision) { ack(c, 'rejected', 'Error: Stale revision'); continue; }
    session = structuredClone(session); session.revision++;
    if (c.operation.type === 'edit-pattern') { const t = session.tracks.find(t => t.id === (c.operation as { trackId: string }).trackId)!; t.notes = c.operation.notes; t.hits = c.operation.hits; }
    if (c.operation.type === 'mute') session.tracks[3].hits.push({ id: 'recorded', step: 9, lane: 'kick', velocity: 1 });
    ack(c, 'applied'); emit({ type: 'session', session });
   }
  },
  emitSession() { emit({ type: 'session', session }); },
 };
}

test('several clicks within one loop coalesce into one edit and all land at the boundary', () => {
 const engine = fake();
 const q = new PatternEditQueue({ dispatch: engine.dispatch, newId: id });
 engine.listeners.push(m => q.handle(m)); engine.emitSession();
 q.edit('drums', toggleHit('kick', 0));
 q.edit('drums', toggleHit('kick', 4));
 q.edit('drums', toggleHit('snare', 4));
 assert.equal(engine.sent.length, 1);
 assert.equal(q.view('drums').hits.length, 3, 'the view shows unapplied edits');
 engine.boundary();
 assert.equal(engine.sent.length, 2, 'later clicks follow as one coalesced edit');
 engine.boundary();
 assert.deepEqual(engine.session.tracks[3].hits.map(h => `${h.lane}@${h.step}`).sort(), ['kick@0', 'kick@4', 'snare@4']);
 assert.equal(q.view('drums').pending, false);
});

test('a stale edit is re-applied on top of a take that landed first, not over it', () => {
 const engine = fake();
 const q = new PatternEditQueue({ dispatch: engine.dispatch, newId: id });
 engine.listeners.push(m => q.handle(m)); engine.emitSession();
 // A recorded batch (simulated by the mute branch above) lands before our edit.
 engine.dispatch({ id: 'take', expectedRevision: 0, boundary: 'next-loop', operation: { type: 'mute', trackId: 'synth-1', muted: false } });
 q.edit('drums', toggleHit('snare', 12));
 engine.boundary();
 engine.boundary();
 assert.deepEqual(engine.session.tracks[3].hits.map(h => `${h.lane}@${h.step}`).sort(), ['kick@9', 'snare@12']);
 assert.equal(q.lastError, null);
});

test('edit-pattern from the editor applies in the real engine and preserves other tracks', { skip: !existsSync('apps/web/public/engine/voicesynth.wasm') }, async () => {
 const { EngineCore } = await import('../apps/web/src/engine/core.ts');
 const dir = 'apps/web/public/engine';
 const module = await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
 const { FirmwareAudio } = await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const metadata = JSON.parse(readFileSync(`${dir}/metadata.json`, 'utf8'));
 const start = createSession(); start.tracks[3].hits.push({ id: 'h', step: 0, lane: 'kick', velocity: 1 });
 const listeners: ((m: ClientMessage) => void)[] = [];
 const core = new EngineCore(new FirmwareAudio(module), metadata, start, 'clock', m => listeners.forEach(l => l(m)));
 const q = new PatternEditQueue({ dispatch: c => core.dispatch(c), newId: id });
 listeners.push(m => q.handle(m));
 q.handle({ type: 'session', session: core.getSession() });
 q.edit('synth-2', placeNote(4, 62, 3));
 q.edit('synth-2', placeNote(10, 65, 2));
 q.edit('drums', toggleHit('closed-hat', 2));
 const s = core.getSession();
 assert.deepEqual(s.tracks[1].notes.map(x => [x.step, x.duration, x.midi]), [[4, 3, 62], [10, 2, 65]]);
 assert.deepEqual(s.tracks[3].hits.map(h => `${h.lane}@${h.step}`), ['kick@0', 'closed-hat@2']);
 assert.equal(q.lastError, null);
});
