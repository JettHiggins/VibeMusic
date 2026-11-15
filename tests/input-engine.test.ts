import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createSession, type ClientMessage, type SessionCommand } from '../packages/contracts/src/index.ts';
import { EngineCore } from '../apps/web/src/engine/core.ts';
import { OnsetDetector } from '../apps/web/src/input/onset.ts';
import { PerformanceRecorder } from '../apps/web/src/input/recorder.ts';

const dir = 'apps/web/public/engine';
const ready = existsSync(`${dir}/voicesynth.wasm`);
const SR = 44100;

/**
 * Full drum slice against real SLOOP WASM: record kick → count-in → beatboxed audio (with
 * simulated round-trip latency, a little human timing error and a spoken "Groove stop" span) →
 * onset analysis → verified batch → engine quantization at the loop boundary → playback continues.
 */
test('beatboxed kick take lands on the grid in the real engine and playback continues after stop', { skip: !ready }, async () => {
 const module = await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
 const { FirmwareAudio } = await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const metadata = JSON.parse(readFileSync(`${dir}/metadata.json`, 'utf8'));
 const session = createSession();
 const messages: ClientMessage[] = [];
 const listeners: ((m: ClientMessage) => void)[] = [];
 const core: EngineCore = new EngineCore(new FirmwareAudio(module), metadata, session, 'clock', m => { messages.push(m); listeners.forEach(l => l(m)); });
 let n = 0;
 const recorder = new PerformanceRecorder({ dispatch: c => core.dispatch(c), newId: () => `e${++n}` }, 'speech');
 listeners.push(m => recorder.handle(m));
 recorder.handle({ type: 'session', session: core.getSession() });
 recorder.setSpeechAvailable(true);
 const detector = new OnsetDetector({ sampleRate: SR, noiseFloorDb: -60 });
 const latency = 0.09 * SR; // output + input round trip the performer experiences
 const stepFrames = SR * 60 / (120 * 4);
 const loop = stepFrames * 64;
 let frame = 0;
 const mic: number[] = [];
 /** Advance the engine and feed the "microphone" for the same span, block by block. */
 const run = (frames: number, hits: number[]) => {
  for (let done = 0; done < frames; done += 128) {
   const l = new Float32Array(128), r = new Float32Array(128);
   core.render(l, r, frame);
   const block = new Float32Array(128);
   for (let i = 0; i < 128; i++) {
    const f = frame + i;
    let s = (Math.sin(f * 12.9898) * 43758.5453 % 1) * 0.001;
    for (const at of hits) { const t = f - at; if (t >= 0 && t < 0.2 * SR) s += Math.sin(2 * Math.PI * (60 + 100 * Math.exp(-t / SR * 30)) * t / SR) * Math.exp(-t / SR * 14) * 0.4 * Math.min(1, t / 60) * Math.min(1, (0.2 * SR - t) / (0.05 * SR)); }
    block[i] = s; mic.push(s);
   }
   const onsets = detector.process(block, frame);
   frame += 128;
   recorder.addOnsets(onsets, latency, 'clock', frame);
   if (frame % 2048 === 0) { const t: ClientMessage = { type: 'transport', transport: core.transport() }; recorder.handle(t); }
  }
 };
 const command = (id: string, operation: SessionCommand['operation'], boundary: SessionCommand['boundary'] = 'immediate'): SessionCommand => ({ id, expectedRevision: core.getSession().revision, boundary, operation });

 core.dispatch(command('rec', { type: 'record', target: { trackId: 'drums', lane: 'kick' } }, 'next-loop'));
 run(128, []);
 assert.equal(core.transport().recordingState, 'armed');
 // Count-in loop, then the take begins on the next four-bar downbeat.
 run(Math.ceil(loop) + 2048, []);
 const t = core.transport();
 assert.equal(t.recordingState, 'recording');
 const takeStart = t.recordingStartFrame!;
 // Performer hits on steps 0, 6, 8 and 14 of bar 1 and step 4 of bar 3 — up to ±10 ms off — heard through latency.
 const intended = [0, 6, 8, 14, 36];
 const human = [0.006, -0.008, 0.004, 0.01, -0.005];
 const heardAt = intended.map((s, i) => Math.round(takeStart + s * stepFrames + human[i] * SR + latency));
 // A "Groove stop" utterance at step 48 is excluded even though it is percussive.
 const speechAt = Math.round(takeStart + 48 * stepFrames + latency);
 run(Math.ceil(takeStart + 52 * stepFrames + latency - frame), [...heardAt, speechAt]);
 recorder.addCommandSpan({ clockId: 'clock', startFrame: Math.round(takeStart + 47.5 * stepFrames), endFrame: Math.round(takeStart + 50 * stepFrames) });
 recorder.verifyThrough('clock', frame - 1);
 core.dispatch(command('stop', { type: 'stop-recording' }));
 // Let the verified batch apply at the next loop boundary while playback keeps running.
 run(Math.ceil(loop), []); // the complete verified take must land by the following loop
 const kicks = core.getSession().tracks[3].hits.filter(h => h.lane === 'kick').map(h => h.step).sort((a, b) => a - b);
 assert.deepEqual(kicks, intended);
 assert.equal(core.transport().playing, true, 'playback continues after Groove stop');
 assert.equal(core.transport().recordingState, 'idle');
 assert.equal(recorder.status().lastError, null);
 const applied = messages.filter(m => m.type === 'ack' && m.status === 'applied').length;
 assert.ok(applied >= 3);
 // The real engine output stays finite and audible.
 const l = new Float32Array(4096), r = new Float32Array(4096); core.render(l, r, frame);
 assert.ok(l.every(Number.isFinite) && l.some(v => v !== 0));
 assert.ok(mic.length > 0);
});

/**
 * Milestone 3 acceptance against real SLOOP WASM: sing a four-bar melody onto synth-1, then sing
 * a corrected phrase in bar 3 only. Untouched notes survive; the corrected phrase replaces bar 3.
 */
test('a sung melody records, and a re-sung phrase replaces only that phrase', { skip: !ready }, async () => {
 const { YinTracker, NoteSegmenter } = await import('../apps/web/src/input/pitch.ts');
 const module = await WebAssembly.compile(readFileSync(`${dir}/voicesynth.wasm`));
 const { FirmwareAudio } = await import(pathToFileURL(resolve(`${dir}/preview-worklet.js`)).href);
 const metadata = JSON.parse(readFileSync(`${dir}/metadata.json`, 'utf8'));
 const listeners: ((m: ClientMessage) => void)[] = [];
 const core: EngineCore = new EngineCore(new FirmwareAudio(module), metadata, createSession(), 'clock', m => listeners.forEach(l => l(m)));
 let n = 0;
 const recorder = new PerformanceRecorder({ dispatch: c => core.dispatch(c), newId: () => `m${++n}` }, 'manual');
 listeners.push(m => recorder.handle(m));
 recorder.handle({ type: 'session', session: core.getSession() });
 const yin = new YinTracker({ sampleRate: SR });
 const segmenter = new NoteSegmenter({ sampleRate: SR, hop: yin.hop, noiseFloorDb: -60 });
 const latency = 0.07 * SR, stepFrames = SR * 60 / (120 * 4), loop = stepFrames * 64;
 let frame = 0;
 type Sung = { midi: number; from: number; to: number };
 let singing: { notes: Sung[]; origin: number } = { notes: [], origin: 0 };
 const phases = new Map<Sung, number>();
 /** Voice-like tone with ±0.3 semitone vibrato; phase is integrated per sample (no chirp). */
 const voice = (f: number) => {
  let s = Math.sin(f * 12.9898) * 43758.5453 % 1 * 0.0005;
  for (const note of singing.notes) {
   const a = singing.origin + note.from * stepFrames + latency, b = singing.origin + note.to * stepFrames + latency;
   if (f < a || f >= b) continue;
   const t = (f - a) / SR, env = Math.min(1, t / 0.02, (b - f) / SR / 0.02), hz = 440 * 2 ** ((note.midi - 69 + 0.3 * Math.sin(2 * Math.PI * 5.5 * t)) / 12);
   const phase = (phases.get(note) ?? 0) + 2 * Math.PI * hz / SR; phases.set(note, phase);
   for (let h = 1; h <= 5; h++) s += Math.sin(h * phase) / (h * h) * 0.15 * env;
  }
  return s;
 };
 const run = (frames: number) => {
  for (let done = 0; done < frames; done += 128) {
   const l = new Float32Array(128), r = new Float32Array(128);
   core.render(l, r, frame);
   const block = new Float32Array(128);
   for (let i = 0; i < 128; i++) block[i] = voice(frame + i);
   const notes = segmenter.push(yin.process(block, frame));
   frame += 128;
   const open = segmenter.openStart;
   recorder.addNotes(notes, latency, 'clock', open === null ? frame : Math.min(frame, open));
   if (frame % 2048 === 0) recorder.handle({ type: 'transport', transport: core.transport() });
  }
 };
 const command = (id: string, operation: SessionCommand['operation'], boundary: SessionCommand['boundary'] = 'immediate'): SessionCommand => ({ id, expectedRevision: core.getSession().revision, boundary, operation });
 const take = (id: string, notes: Sung[]) => {
  core.dispatch(command(`${id}-rec`, { type: 'record', target: { trackId: 'synth-1' } }, 'next-loop'));
  run(128);
  while (core.transport().recordingState !== 'recording') run(128);
  const start = core.transport().recordingStartFrame!;
  singing = { notes, origin: start };
  run(Math.ceil(start + loop - frame));
  recorder.handle({ type: 'transport', transport: core.transport() });
  core.dispatch(command(`${id}-stop`, { type: 'stop-recording' }));
  recorder.addNotes(segmenter.flush(frame), latency, 'clock', frame);
  recorder.handle({ type: 'transport', transport: core.transport() });
  singing = { notes: [], origin: 0 };
  // All completed, verified notes must be available on the following loop.
  run(Math.ceil(SR * 0.1));
 };
 const melody: Sung[] = [[60, 0, 6], [62, 8, 12], [64, 12, 16], [67, 16, 24], [65, 24, 30], [64, 32, 36], [62, 36, 40], [60, 40, 46], [62, 48, 56], [60, 56, 62.5]].map(([midi, from, to]) => ({ midi, from, to }));
 take('first', melody);
 const notes = () => core.getSession().tracks[0].notes.map(x => [x.step, x.duration, x.midi]).sort((a, b) => a[0] - b[0]);
 assert.deepEqual(notes(), melody.map(m => [Math.round(m.from), Math.round(m.to) - Math.round(m.from), m.midi]), 'first take');
 assert.equal(recorder.status().lastError, null);
 // Correct bar 3 only: a different three-note phrase.
 const fix: Sung[] = [[67, 32, 36], [69, 36, 40], [71, 40, 46]].map(([midi, from, to]) => ({ midi, from, to }));
 take('fix', fix);
 const expected = [...melody.filter(m => m.from < 32 || m.from >= 48), ...fix].map(m => [Math.round(m.from), Math.round(m.to) - Math.round(m.from), m.midi]).sort((a, b) => a[0] - b[0]);
 assert.deepEqual(notes(), expected, 'only bar 3 replaced');
 assert.equal(core.transport().playing, true, 'playback continues');
 assert.equal(recorder.status().lastError, null);
});
