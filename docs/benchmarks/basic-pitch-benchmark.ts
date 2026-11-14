/**
 * Workstream 2 benchmark: streaming YIN (apps/web/src/input/pitch.ts) vs Spotify Basic Pitch on
 * the same synthetic sung phrases. Basic Pitch is NOT a project dependency; install it elsewhere:
 *
 *   mkdir bp && cd bp && npm init -y && npm install --ignore-scripts @spotify/basic-pitch @tensorflow/tfjs
 *   BASIC_PITCH_DIR=$PWD node --import tsx docs/benchmarks/basic-pitch-benchmark.ts   # from the repo root
 *
 * Synthetic voices are a stand-in for real singing; results must be re-checked with recordings.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { NoteSegmenter, YinTracker } from '../../apps/web/src/input/pitch.ts';

const dir = process.env.BASIC_PITCH_DIR;
if (!dir) throw new Error('Set BASIC_PITCH_DIR to a folder with @spotify/basic-pitch and @tensorflow/tfjs installed');
// CommonJS builds: the package's ESM entry pulls a MIDI writer that does not load under Node ESM.
const require = createRequire(join(dir, 'package.json'));
const tf = require('@tensorflow/tfjs');
const bp = require('@spotify/basic-pitch');

const SR = 44100, BP_SR = 22050;
type Note = { midi: number; start: number; end: number };
function rng(seed: number) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function sing(notes: (Note & { vibrato?: number; db?: number })[], seconds: number, seed: number, breathDb = -55) {
 const random = rng(seed), out = new Float32Array(Math.round(seconds * SR)), breath = 10 ** (breathDb / 20);
 for (let i = 0; i < out.length; i++) out[i] = (random() * 2 - 1) * breath * 1.7;
 for (const n of notes) {
  let phase = 0; const a0 = Math.round(n.start * SR), a1 = Math.round(n.end * SR), amp = 10 ** ((n.db ?? -14) / 20);
  for (let i = a0; i < a1 && i < out.length; i++) {
   const t = (i - a0) / SR, env = Math.min(1, t / 0.025, (a1 - i) / SR / 0.025);
   phase += 2 * Math.PI * 440 * 2 ** ((n.midi - 69 + (n.vibrato ?? 0) * Math.sin(2 * Math.PI * 5.5 * t)) / 12) / SR;
   let s = 0; for (let h = 1; h <= 7; h++) s += Math.sin(h * phase) * (h === 2 ? 0.7 : 1) / (h * h);
   out[i] += s * amp * env * 0.8 * (1 + 0.15 * (random() - 0.5));
  }
 }
 return out;
}
const phrase = (midis: number[], dur: number, gap: number, start = 0.2, vibrato = 0.3): Note[] => midis.map((midi, i) => ({ midi, start: start + i * (dur + gap), end: start + i * (dur + gap) + dur, vibrato }));
const cases: { name: string; notes: (Note & { vibrato?: number })[] }[] = [
 { name: 'C major scale, detached', notes: phrase([60, 62, 64, 65, 67, 69, 71, 72], 0.3, 0.08) },
 { name: 'low male range legato', notes: phrase([43, 45, 47, 48, 50, 48, 47, 45], 0.35, 0) },
 { name: 'high female range', notes: phrase([72, 74, 76, 79, 81, 79, 76, 74], 0.25, 0.05) },
 { name: 'repeated pitch (3x E4)', notes: [{ midi: 64, start: 0.2, end: 0.45 }, { midi: 64, start: 0.48, end: 0.73 }, { midi: 64, start: 0.76, end: 1.0 }] },
 { name: 'wide vibrato held notes', notes: phrase([57, 64, 62], 0.8, 0.1, 0.2, 0.6) },
 { name: 'fast 16ths at 120 BPM', notes: phrase([60, 64, 67, 72, 67, 64, 60, 64, 67, 72, 76, 72], 0.12, 0.005, 0.2, 0.1) },
];

function yin(audio: Float32Array) {
 const t = performance.now();
 const tracker = new YinTracker({ sampleRate: SR }), seg = new NoteSegmenter({ sampleRate: SR, hop: tracker.hop, noiseFloorDb: -55 });
 const notes = [];
 for (let i = 0; i < audio.length; i += 1024) notes.push(...seg.push(tracker.process(audio.subarray(i, i + 1024), i)));
 notes.push(...seg.flush(audio.length));
 return { ms: performance.now() - t, notes: notes.map(n => ({ midi: n.midi, start: n.startFrame / SR, end: n.endFrame / SR })) };
}

const modelJson = JSON.parse(readFileSync(join(dir, 'node_modules/@spotify/basic-pitch/model/model.json'), 'utf8'));
const weights = readFileSync(join(dir, 'node_modules/@spotify/basic-pitch/model', modelJson.weightsManifest[0].paths[0]));
const model = tf.loadGraphModel(tf.io.fromMemory({ modelTopology: modelJson.modelTopology, weightSpecs: modelJson.weightsManifest[0].weights, weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength), format: modelJson.format, generatedBy: modelJson.generatedBy, convertedBy: modelJson.convertedBy }));
const basicPitch = new bp.BasicPitch(model);
async function basic(audio: Float32Array) {
 // Basic Pitch expects 22.05 kHz mono; simple 2:1 decimation after a short low-pass.
 const down = new Float32Array(Math.floor(audio.length / 2));
 for (let i = 0; i < down.length; i++) down[i] = 0.25 * (audio[2 * i - 1] ?? 0) + 0.5 * audio[2 * i] + 0.25 * (audio[2 * i + 1] ?? 0);
 const frames: number[][] = [], onsets: number[][] = [], contours: number[][] = [];
 const t = performance.now();
 await basicPitch.evaluateModel(down, (f: number[][], o: number[][], c: number[][]) => { frames.push(...f); onsets.push(...o); contours.push(...c); }, () => {});
 const events = bp.noteFramesToTime(bp.addPitchBendsToNoteEvents(contours, bp.outputToNotesPoly(frames, onsets, 0.5, 0.3, 5, true, null, null, true)));
 const ms = performance.now() - t;
 // Monophonic comparison: keep the strongest note when Basic Pitch reports overlaps (harmonics).
 const notes = events.map((e: { pitchMidi: number; startTimeSeconds: number; durationSeconds: number; amplitude: number }) => ({ midi: e.pitchMidi, start: e.startTimeSeconds, end: e.startTimeSeconds + e.durationSeconds, amp: e.amplitude }))
  .sort((a: { amp: number }, b: { amp: number }) => b.amp - a.amp)
  .filter((n: Note, i: number, all: Note[]) => !all.slice(0, i).some(m => n.start < m.end && n.end > m.start))
  .sort((a: Note, b: Note) => a.start - b.start);
 return { ms, notes, raw: events.length };
}

function score(truth: Note[], found: Note[]) {
 const used = new Set<number>(); let hits = 0, onsetErr = 0, offsetErr = 0;
 for (const t of truth) {
  const i = found.findIndex((f, k) => !used.has(k) && f.midi === t.midi && Math.abs(f.start - t.start) <= 0.05);
  if (i < 0) continue;
  used.add(i); hits++; onsetErr += Math.abs(found[i].start - t.start); offsetErr += Math.abs(found[i].end - t.end);
 }
 const precision = found.length ? hits / found.length : 0, recall = hits / truth.length;
 return { precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, onsetMs: hits ? onsetErr / hits * 1000 : NaN, offsetMs: hits ? offsetErr / hits * 1000 : NaN };
}

const rows: string[] = [];
const total = { yin: { f1: 0, ms: 0 }, bp: { f1: 0, ms: 0 }, seconds: 0 };
await basic(new Float32Array(SR)); // warm-up (graph compilation)
for (const [k, c] of cases.entries()) {
 const seconds = Math.max(...c.notes.map(n => n.end)) + 0.3;
 const audio = sing(c.notes, seconds, k + 1);
 const y = yin(audio), b = await basic(audio);
 const ys = score(c.notes, y.notes), bs = score(c.notes, b.notes);
 total.yin.f1 += ys.f1; total.bp.f1 += bs.f1; total.yin.ms += y.ms; total.bp.ms += b.ms; total.seconds += seconds;
 const f = (s: ReturnType<typeof score>) => `${s.f1.toFixed(2)} (P ${s.precision.toFixed(2)} R ${s.recall.toFixed(2)}) | ${isNaN(s.onsetMs) ? '–' : s.onsetMs.toFixed(0)} / ${isNaN(s.offsetMs) ? '–' : s.offsetMs.toFixed(0)}`;
 rows.push(`| ${c.name} | ${c.notes.length} | ${f(ys)} | ${f(bs)} |`);
}
console.log('| Case | Notes | YIN F1 | YIN onset/offset err ms | Basic Pitch F1 | BP onset/offset err ms |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(r.replace(/ \| (\d)/g, ' | $1'));
console.log(`\nMean F1: YIN ${(total.yin.f1 / cases.length).toFixed(2)}, Basic Pitch ${(total.bp.f1 / cases.length).toFixed(2)}`);
console.log(`Processing per second of audio (Node, tfjs CPU backend): YIN ${(total.yin.ms / total.seconds).toFixed(1)} ms, Basic Pitch ${(total.bp.ms / total.seconds).toFixed(1)} ms`);
console.log(`tfjs backend: ${tf.getBackend()}`);
