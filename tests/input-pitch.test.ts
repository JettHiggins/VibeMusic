import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { NoteSegmenter, YinTracker, hzToMidi, type PitchFrame, type SungNote } from '../apps/web/src/input/pitch.ts';

const SR = 44100;
function rng(seed: number) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
interface Sung { midi: number; start: number; end: number; vibrato?: number; db?: number }
/** Voice-like tone: harmonics with falling amplitude, soft attack/release, optional vibrato, breath noise. */
function sing(notes: Sung[], seconds: number, noiseDb = -60, seed = 1) {
 const random = rng(seed), out = new Float32Array(Math.round(seconds * SR)), noise = 10 ** (noiseDb / 20);
 for (let i = 0; i < out.length; i++) out[i] = (random() * 2 - 1) * noise * 1.7;
 for (const n of notes) {
  let phase = 0; const a0 = Math.round(n.start * SR), a1 = Math.round(n.end * SR), amp = 10 ** ((n.db ?? -14) / 20);
  for (let i = a0; i < a1 && i < out.length; i++) {
   const t = (i - a0) / SR, env = Math.min(1, t / 0.02, (a1 - i) / SR / 0.02);
   phase += 2 * Math.PI * midiHz(n.midi + (n.vibrato ?? 0) * Math.sin(2 * Math.PI * 5.5 * t)) / SR;
   let s = 0; for (let h = 1; h <= 6; h++) s += Math.sin(h * phase) / (h * h);
   out[i] += s * amp * env * 0.8;
  }
 }
 return out;
}
function analyse(buffer: Float32Array, chunk = 1024, start = 0) {
 const yin = new YinTracker({ sampleRate: SR });
 const seg = new NoteSegmenter({ sampleRate: SR, hop: yin.hop, noiseFloorDb: -60 });
 const frames: PitchFrame[] = [], notes: SungNote[] = [];
 for (let i = 0; i < buffer.length; i += chunk) { const f = yin.process(buffer.subarray(i, i + chunk), start + i); frames.push(...f); notes.push(...seg.push(f)); }
 notes.push(...seg.flush(start + buffer.length));
 return { frames, notes };
}
const ms = (frames: number) => frames / SR * 1000;

test('YIN tracks sung fundamentals across the vocal range within a fifth of a semitone', () => {
 for (const midi of [43, 48, 57, 60, 67, 72, 79]) {
  const { frames } = analyse(sing([{ midi, start: 0, end: 0.5 }], 0.5));
  const voiced = frames.filter(f => f.f0 && f.clarity > 0.8).slice(3, -3);
  assert.ok(voiced.length > 40, `midi ${midi}: ${voiced.length} voiced frames`);
  for (const f of voiced) assert.ok(Math.abs(hzToMidi(f.f0!) - midi) < 0.2, `midi ${midi}: got ${hzToMidi(f.f0!).toFixed(2)}`);
 }
});

test('noise and silence are unvoiced', () => {
 const { frames, notes } = analyse(sing([], 1, -30, 4));
 assert.equal(notes.length, 0);
 assert.ok(frames.filter(f => f.clarity > 0.8).length < frames.length * 0.02);
});

test('a separated phrase yields exact notes with accurate boundaries', () => {
 const phrase: Sung[] = [{ midi: 60, start: 0.2, end: 0.6 }, { midi: 64, start: 0.75, end: 1.1 }, { midi: 67, start: 1.25, end: 1.9 }, { midi: 62, start: 2.0, end: 2.3 }];
 const { notes } = analyse(sing(phrase, 2.6));
 assert.deepEqual(notes.map(n => n.midi), phrase.map(p => p.midi));
 notes.forEach((n, i) => {
  assert.ok(Math.abs(ms(n.startFrame) - phrase[i].start * 1000) < 20, `start ${i}: ${ms(n.startFrame)}`);
  assert.ok(Math.abs(ms(n.endFrame) - phrase[i].end * 1000) < 30, `end ${i}: ${ms(n.endFrame)}`);
  assert.ok(n.confidence >= 0.6 && n.velocity > 0);
 });
});

test('legato pitch changes split at the change; vibrato does not', () => {
 const { notes } = analyse(sing([{ midi: 57, start: 0.1, end: 0.6, vibrato: 0.5 }, { midi: 59, start: 0.6, end: 1.1, vibrato: 0.5 }, { midi: 62, start: 1.1, end: 1.6 }], 1.8));
 assert.deepEqual(notes.map(n => n.midi), [57, 59, 62]);
 assert.ok(Math.abs(ms(notes[1].startFrame) - 600) < 30, `legato boundary ${ms(notes[1].startFrame)}`);
 assert.ok(Math.abs(ms(notes[2].startFrame) - 1100) < 30);
});

test('wide vibrato (±0.6 semitone) held notes stay single notes', () => {
 const held: Sung[] = [{ midi: 57, start: 0.2, end: 1.0, vibrato: 0.6 }, { midi: 64, start: 1.1, end: 1.9, vibrato: 0.6 }, { midi: 62, start: 2.0, end: 2.8, vibrato: 0.6 }];
 const { notes } = analyse(sing(held, 3.1));
 assert.deepEqual(notes.map(n => n.midi), [57, 64, 62]);
 notes.forEach((n, i) => assert.ok(Math.abs(ms(n.endFrame) - held[i].end * 1000) < 40, `end ${i}`));
});

test('repeated notes on one pitch separated by an articulation dip stay distinct', () => {
 const { notes } = analyse(sing([{ midi: 65, start: 0.1, end: 0.4 }, { midi: 65, start: 0.42, end: 0.7 }, { midi: 65, start: 0.72, end: 1.0 }], 1.2));
 assert.equal(notes.length, 3, `notes ${JSON.stringify(notes.map(n => [ms(n.startFrame), ms(n.endFrame)]))}`);
 assert.ok(notes.every(n => n.midi === 65));
});

test('octave errors inside a held note are folded back and blips are discarded', () => {
 const seg = new NoteSegmenter({ sampleRate: SR, hop: 256, noiseFloorDb: -60 });
 const frames: PitchFrame[] = Array.from({ length: 80 }, (_, i) => ({ frame: i * 256, f0: midiHz(i % 9 === 4 ? 72 : 60), clarity: 0.95, rmsDb: -15 }));
 const notes = [...seg.push(frames), ...seg.flush(80 * 256)];
 assert.deepEqual(notes.map(n => n.midi), [60]);
 const blip = new NoteSegmenter({ sampleRate: SR, hop: 256, noiseFloorDb: -60 });
 const short: PitchFrame[] = Array.from({ length: 8 }, (_, i) => ({ frame: i * 256, f0: midiHz(64), clarity: 0.95, rmsDb: -15 }));
 assert.deepEqual([...blip.push(short), ...blip.flush(8 * 256)], []);
});

test('notes are independent of capture block size and of the absolute start frame', () => {
 const audio = sing([{ midi: 62, start: 0.1, end: 0.5 }, { midi: 69, start: 0.6, end: 0.9 }], 1.1);
 const reference = analyse(audio, 1024, 0).notes;
 for (const chunk of [128, 333, 4096]) assert.deepEqual(analyse(audio, chunk, 0).notes, reference, `chunk ${chunk}`);
 const shifted = analyse(audio, 1024, 777_777).notes;
 assert.deepEqual(shifted.map(n => [n.startFrame - 777_777, n.endFrame - 777_777, n.midi]), reference.map(n => [n.startFrame, n.endFrame, n.midi]));
});

test('p95 pitch analysis per 1024-frame block stays below the 50 ms target', () => {
 const audio = sing(Array.from({ length: 20 }, (_, i) => ({ midi: 55 + (i % 12), start: i * 0.5, end: i * 0.5 + 0.4 })), 10);
 const yin = new YinTracker({ sampleRate: SR }), seg = new NoteSegmenter({ sampleRate: SR, hop: yin.hop });
 const times: number[] = [];
 for (let i = 0; i < audio.length; i += 1024) { const t = performance.now(); seg.push(yin.process(audio.subarray(i, i + 1024), i)); times.push(performance.now() - t); }
 times.sort((a, b) => a - b);
 assert.ok(times[Math.floor(times.length * 0.95)] < 50, `p95 ${times[Math.floor(times.length * 0.95)]}`);
});
