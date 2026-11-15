import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createSession, snapMidiToScale, type ClientMessage, type SessionCommand } from '../packages/contracts/src/index.ts';
import { keyLabel, snapBlockedReason, withRoot, withScale } from '../apps/web/src/ui/pitch-snap-ui.ts';
import { CommandClient, describe } from '../apps/web/src/ui/command-client.ts';

const dir = 'apps/web/public/engine';
const ready = existsSync(`${dir}/voicesynth.wasm`);

test('key choices default Off, keep the scale across root changes and never invent a key from a scale alone', () => {
 assert.equal(keyLabel(null), 'Off');
 assert.equal(withRoot(null, 'off'), null);
 assert.deepEqual(withRoot(null, '2'), { root: 2, scale: 'major' });
 assert.deepEqual(withRoot({ root: 2, scale: 'minor' }, '9'), { root: 9, scale: 'minor' });
 assert.equal(withRoot({ root: 9, scale: 'minor' }, 'off'), null);
 assert.equal(withScale(null, 'minor'), null, 'a scale without a root stays Off');
 assert.deepEqual(withScale({ root: 9, scale: 'major' }, 'minor'), { root: 9, scale: 'minor' });
 assert.equal(keyLabel({ root: 6, scale: 'minor' }), 'F♯ minor');
});

test('snap existing track is blocked when the key is Off, drums are selected, the track is empty or audio is off', () => {
 const key = { root: 0, scale: 'major' as const };
 assert.match(snapBlockedReason(null, 'synth-1', 3, true)!, /key/);
 assert.match(snapBlockedReason(key, 'drums', 3, true)!, /Drums/);
 assert.match(snapBlockedReason(key, 'synth-2', 0, true)!, /no notes/);
 assert.match(snapBlockedReason(key, 'synth-3', 3, false)!, /Enable audio/);
 assert.equal(snapBlockedReason(key, 'synth-3', 3, true), null);
});

test('status text names the key, says immediate changes apply now and that snapping waits for the loop', () => {
 assert.equal(describe({ type: 'set-pitch-snap', settings: { root: 2, scale: 'minor' } }, 'applied'), 'Key snapping on (D minor): done');
 assert.equal(describe({ type: 'set-pitch-snap', settings: null }, 'queued', undefined, 'immediate'), 'Key snapping off: applying in the audio engine');
 assert.equal(describe({ type: 'snap-notes', trackId: 'synth-2' }, 'queued', undefined, 'next-loop'), 'Snap existing notes on Synth 2: applies at the next loop');
 assert.equal(describe({ type: 'tempo', bpm: 100 }, 'queued'), 'Tempo 100 BPM: applies at the next loop', 'other operations keep the old wording');
});

test('provisional preview uses the shared snap while raw MIDI stays unchanged', () => {
 const raw = [60, 61, 68];
 const key = { root: 0, scale: 'major' as const };
 assert.deepEqual(raw.map(m => snapMidiToScale(m, null)), raw, 'Off previews raw pitch');
 assert.deepEqual(raw.map(m => snapMidiToScale(m, key)), [60, 60, 67]);
 assert.deepEqual(raw, [60, 61, 68]);
});

test('UI key choice, explicit snap and Undo round-trip through the command client and real engine', { skip: !ready }, async () => {
 const { EngineCore } = await import('../apps/web/src/engine/core.ts');
 const { FirmwareAudio } = await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const module = await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
 const metadata = JSON.parse(readFileSync(`${dir}/metadata.json`, 'utf8'));
 const start = createSession();
 start.tracks[0].notes = [{ id: 'a', step: 0, duration: 2, midi: 61, velocity: 0.7 }, { id: 'b', step: 8, duration: 2, midi: 68, velocity: 0.7 }];
 const listeners: ((m: ClientMessage) => void)[] = [];
 const core = new EngineCore(new FirmwareAudio(module), metadata, start, 'c', m => listeners.forEach(l => l(m)));
 let n = 0;
 const sent: SessionCommand[] = [];
 const client = new CommandClient({ dispatch: (c: SessionCommand) => { sent.push(c); return core.dispatch(c); }, getSession: () => core.getSession() }, () => `k${++n}`);
 const results: string[] = [];
 client.onResult = r => results.push(`${r.status}: ${r.text}`);
 listeners.push(m => client.handle(m));
 let frame = 0;
 const render = (frames: number) => { for (let d = 0; d < frames; d += 128) { core.render(new Float32Array(128), new Float32Array(128), frame); frame += 128; } };
 const loop = Math.ceil(44100 * 960 / 120);
 client.send({ type: 'play', playing: true });
 render(1280);

 client.send({ type: 'set-pitch-snap', settings: withRoot(null, '0') }, 'immediate');
 assert.deepEqual(core.getSession().pitchSnap, { root: 0, scale: 'major' });
 assert.deepEqual(core.getSession().tracks[0].notes.map(x => x.midi), [61, 68], 'choosing a key leaves existing notes alone');

 client.send({ type: 'snap-notes', trackId: 'synth-1' }, 'next-loop');
 assert.deepEqual(core.getSession().tracks[0].notes.map(x => x.midi), [61, 68], 'snap waits for the loop');
 render(loop + 256);
 assert.deepEqual(core.getSession().tracks[0].notes.map(x => x.midi), [60, 67]);
 assert.deepEqual(core.getSession().tracks[0].notes.map(x => [x.id, x.step, x.duration]), [['a', 0, 2], ['b', 8, 2]], 'only pitch changes');

 client.send({ type: 'undo' }, 'immediate');
 assert.deepEqual(core.getSession().tracks[0].notes.map(x => x.midi), [61, 68], 'Undo reverts the snap');
 assert.deepEqual(core.getSession().pitchSnap, { root: 0, scale: 'major' }, 'Undo keeps the chosen key');
 assert.ok(results.some(r => r === 'applied: Snap existing notes on Synth 1: done'), results.join('\n'));
 assert.ok(sent.every(c => c.operation.type !== 'set-pitch-snap' || c.boundary === 'immediate'));
});
