import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createSession, type ClientMessage, type SessionCommand } from '../packages/contracts/src/index.ts';
import { CommandClient, describe } from '../apps/web/src/ui/command-client.ts';

const dir = 'apps/web/public/engine';
const ready = existsSync(`${dir}/voicesynth.wasm`);

async function harness() {
 const { EngineCore } = await import('../apps/web/src/engine/core.ts');
 const module = await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
 const { FirmwareAudio } = await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const metadata = JSON.parse(readFileSync(`${dir}/metadata.json`, 'utf8'));
 const listeners: ((m: ClientMessage) => void)[] = [];
 const core = new EngineCore(new FirmwareAudio(module), metadata, createSession(), 'c', m => listeners.forEach(l => l(m)));
 let n = 0;
 const sent:SessionCommand[]=[];
 const client = new CommandClient({ dispatch: (c: SessionCommand) => { sent.push(c);return core.dispatch(c); }, getSession: () => core.getSession() }, () => `c${++n}`);
 const results: string[] = [];
 client.onResult = r => results.push(`${r.status}: ${r.text}`);
 listeners.push(m => client.handle(m));
 let frame = 0;
 const render = (frames: number) => { for (let d = 0; d < frames; d += 128) { core.render(new Float32Array(128), new Float32Array(128), frame); frame += 128; } };
 // Another UI path (e.g. a mute button elsewhere) that bypasses the client.
 const other = (operation: SessionCommand['operation']) => core.dispatch({ id: `o${++n}`, expectedRevision: core.getSession().revision, boundary: 'immediate', operation });
 const loop = Math.ceil(44100 * 960 / 120);
 client.send({ type: 'play', playing: true });
 render(1280);
 return { core, client, results, render, other, loop, sent };
}

test('an unrelated edit never re-issues next-beat Record or moves its deadline', { skip: !ready }, async () => {
 const { core, client, results, render, other, sent } = await harness();
 client.send({ type: 'record', target: { trackId: 'drums', lane: 'snare' } }, 'next-beat');
 render(128);
 other({ type: 'mute', trackId: 'synth-2', muted: true });
 // Before the fix the record was rejected as stale here and recording stayed idle.
 let frames = 0;
 while (core.transport().recordingState !== 'recording' && frames < 44100 * 9) { render(1280); frames += 1280; }
 assert.equal(core.transport().recordingState, 'recording');
 assert.ok(frames < 44100 * .6, 'starts at the next beat');
 assert.equal(sent.filter(c=>c.operation.type==='record').length,1,'the pinned intent is sent only once');
 assert.deepEqual(core.transport().recordingTarget, { trackId: 'drums', lane: 'snare' });
 assert.ok(!results.some(r => r.startsWith('rejected')), results.join('\n'));
});

test('explicit Clear is immediate and never replayed; queued Undo is never re-issued', { skip: !ready }, async () => {
 const { core, client, results, render, loop } = await harness();
 const kicksBefore = core.getSession().tracks[3].hits.length;
 client.send({ type: 'tempo', bpm: 100 }, 'next-loop');
 client.send({ type: 'clear', target: { trackId: 'synth-1' } }, 'immediate');
 render(loop * 3);
 assert.equal(core.getSession().tempo, 100);
 assert.ok(results.some(r => r === 'applied: Clear Synth 1: done'), results.join('\n'));
 assert.equal(core.getSession().tracks[3].hits.length, kicksBefore);
 // Undo competing with another queued change is reported, not silently re-applied.
 results.length = 0;
 client.send({ type: 'tempo', bpm: 110 }, 'next-loop');
 client.send({ type: 'undo' }, 'next-loop');
 render(loop * 2);
 assert.equal(core.getSession().tempo, 110);
 assert.ok(results.some(r => r.startsWith('rejected: Undo not applied')), results.join('\n'));
 assert.equal(results.filter(r => r.startsWith('retrying: Undo')).length, 0);
});

test('status text is plain language', () => {
 assert.equal(describe({ type: 'tempo', bpm: 100 }, 'queued'), 'Tempo 100 BPM: applies at the next loop');
 assert.equal(describe({ type: 'record', target: { trackId: 'drums', lane: 'kick' } }, 'queued'), 'Record Kick: armed (next beat, or four count-in beats from stopped)');
 assert.equal(describe({ type: 'clear', target: { trackId: 'drums', lane: 'snare' } }, 'rejected', 'Error: Stale revision'), 'Clear Snare not applied: the session changed before it could apply; press it again');
 assert.equal(describe({ type: 'tempo', bpm: 90 }, 'rejected', 'Error: Stop recording before changing tempo'), 'Tempo 90 BPM not applied: stop recording before changing tempo');
});

test('engine receipts that reject immediately are reported once', () => {
 const session = createSession();
 const client = new CommandClient({ dispatch: c => ({ type: 'ack', commandId: c.id, status: 'rejected', revision: 0, reason: 'Enable audio first' }), getSession: () => session }, () => 'x');
 const out: string[] = []; client.onResult = r => out.push(r.text);
 client.send({ type: 'tempo', bpm: 90 }, 'next-loop');
 assert.deepEqual(out, ['Tempo 90 BPM not applied: Enable audio first']);
});

test('an engine that never answers (stale or crashed worklet) is reported with what to do', async () => {
 const session = createSession();
 const client = new CommandClient({ dispatch: c => ({ type: 'ack', commandId: c.id, status: 'queued', revision: 0 }), getSession: () => session }, () => 'silent', 3, 30);
 const out: string[] = []; client.onResult = r => out.push(r.text);
 client.send({ type: 'record', target: { trackId: 'synth-1' } }, 'next-loop');
 await new Promise(r => setTimeout(r, 60));
 assert.equal(out.length, 1);
 assert.match(out[0], /^Record Synth 1 got no answer from the audio engine\. If you pulled new code, restart npm run dev/);
});

test('an answered command is not reported as unanswered', async () => {
 const session = createSession();
 let client: CommandClient;
 client = new CommandClient({ dispatch: c => { queueMicrotask(() => client.handle({ type: 'ack', commandId: c.id, status: 'applied', revision: 1 })); return { type: 'ack', commandId: c.id, status: 'queued', revision: 0 }; }, getSession: () => session }, () => 'ok', 3, 30);
 const out: string[] = []; client.onResult = r => out.push(r.text);
 client.send({ type: 'mute', trackId: 'drums', muted: true });
 await new Promise(r => setTimeout(r, 60));
 assert.deepEqual(out, ['Mute Drums: done']);
});

test('engine rejections read as actionable sentences', () => {
 assert.equal(describe({ type: 'load-session', session: createSession() }, 'rejected', 'Error: Overlapping monophonic notes'), 'Load session not applied: synth tracks play one note at a time, and this would overlap two notes (remove the overlap or use another synth track)');
 assert.equal(describe({ type: 'undo' }, 'rejected', 'Error: Nothing to undo'), 'Undo not applied: there is nothing to undo');
});
