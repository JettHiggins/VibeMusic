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
