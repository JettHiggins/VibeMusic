import { fft, toDb } from './onset.ts';

/**
 * Monophonic singing → notes. YIN pitch per hop (FFT-based difference function, so it is cheap
 * enough for the analysis worker), then a streaming segmenter with confidence filtering,
 * hysteresis, octave-error folding, re-articulation splits and a minimum duration.
 * Frames are raw capture-worklet frames; latency is compensated later, once, by the recorder.
 */
export interface PitchFrame { frame: number; f0: number | null; clarity: number; rmsDb: number }
export interface SungNote { startFrame: number; endFrame: number; midi: number; velocity: number; confidence: number }
export interface PitchOptions {
 sampleRate: number;
 /** Analysis window; lowest detectable f0 ≈ sampleRate / maxLag. */
 window?: number;
 hop?: number;
 minHz?: number;
 maxHz?: number;
 /** YIN absolute threshold on the cumulative mean normalised difference. */
 threshold?: number;
 noiseFloorDb?: number;
 gateDb?: number;
 minClarity?: number;
 minNoteMs?: number;
}

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
/** Segmenter defaults: a voiced frame needs this clarity and this many dB above the noise floor. */
export const PITCH_GATE_DB = 15;
/** A held, periodic note can soften without becoming a fresh note or opening on room noise. */
export const PITCH_HOLD_MARGIN_DB = 6;
export const MIN_PITCH_CLARITY = 0.8;
/** Clear periodic humming needs slightly less excess level than uncertain voiced input. */
export function pitchGateDb(noiseFloorDb: number, clarity: number, holding: boolean, gateDb = PITCH_GATE_DB) {
 return noiseFloorDb + gateDb - (holding ? PITCH_HOLD_MARGIN_DB : clarity >= 0.9 ? 3 : 0);
}

/**
 * Live pitch diagnosis for one analysis block, so a singer can see why no notes appear:
 * silent / too quiet for the gate / pitch unclear (speech, breath, noise) / a usable pitch.
 */
export type PitchState = 'silent' | 'quiet' | 'unclear' | 'pitch';
export interface PitchReading { state: PitchState; midi: number | null; clarity: number; levelDb: number; gateDb: number; holding: boolean }
export function readPitch(frames: PitchFrame[], noiseFloorDb: number, holding: boolean, gateDb = PITCH_GATE_DB, minClarity = MIN_PITCH_CLARITY): PitchReading | null {
 if (!frames.length) return null;
 // The loudest frame represents the block; its pitch is the one a singer would expect to see.
 const f = frames.reduce((a, b) => (b.rmsDb > a.rmsDb ? b : a));
 const gate = pitchGateDb(noiseFloorDb, f.clarity, holding, gateDb);
 const midi = f.f0 ? Math.round(hzToMidi(f.f0)) : null;
 const state: PitchState = f.rmsDb < noiseFloorDb + 6 ? 'silent' : f.rmsDb < gate ? 'quiet' : !f.f0 || f.clarity < minClarity ? 'unclear' : 'pitch';
 return { state, midi, clarity: f.clarity, levelDb: f.rmsDb, gateDb: gate, holding };
}

export class YinTracker {
 readonly hop: number;
 private readonly w: number;
 private readonly minLag: number;
 private readonly maxLag: number;
 private readonly n: number;
 private readonly threshold: number;
 private readonly ring: Float32Array;
 private written = 0;
 private first: number | null = null;
 private sinceHop = 0;
 private readonly aRe: Float64Array; private readonly aIm: Float64Array;
 private readonly bRe: Float64Array; private readonly bIm: Float64Array;
 private readonly d: Float64Array;

 constructor(private options: PitchOptions) {
  const sr = options.sampleRate;
  this.w = options.window ?? 1024;
  this.hop = options.hop ?? 256;
  this.minLag = Math.max(2, Math.floor(sr / (options.maxHz ?? 1100)));
  this.maxLag = Math.ceil(sr / (options.minHz ?? 75));
  this.threshold = options.threshold ?? 0.15;
  let n = 1; while (n < this.w + this.maxLag + 1) n <<= 1;
  this.n = n;
  this.ring = new Float32Array(n * 2);
  this.aRe = new Float64Array(n); this.aIm = new Float64Array(n); this.bRe = new Float64Array(n); this.bIm = new Float64Array(n);
  this.d = new Float64Array(this.maxLag + 2);
 }

 reset() { this.written = 0; this.first = null; this.sinceHop = 0; }

 process(samples: Float32Array, startFrame: number): PitchFrame[] {
  if (this.first === null) this.first = startFrame;
  else if (startFrame !== this.first + this.written) throw new Error('Non-contiguous capture; reset the tracker');
  const out: PitchFrame[] = [];
  const span = this.w + this.maxLag;
  for (let i = 0; i < samples.length; i++) {
   this.ring[this.written % this.ring.length] = samples[i];
   this.written++;
   if (++this.sinceHop >= this.hop) { this.sinceHop = 0; if (this.written >= span) out.push(this.analyse(this.written - span)); }
  }
  return out;
 }

 private at(i: number) { return this.ring[i % this.ring.length]; }

 /** Analyse the window starting at absolute sample index `start` (relative to first). */
 private analyse(start: number): PitchFrame {
  const { w, n, maxLag, minLag, d } = this;
  const span = w + maxLag;
  this.aRe.fill(0); this.aIm.fill(0); this.bRe.fill(0); this.bIm.fill(0);
  let energy = 0;
  for (let j = 0; j < span; j++) { const x = this.at(start + j); this.bRe[j] = x; if (j < w) { this.aRe[j] = x; energy += x * x; } }
  fft(this.aRe, this.aIm); fft(this.bRe, this.bIm);
  // Cross-correlation c(τ) = Σ a_j b_{j+τ} = IFFT(conj(A)·B); inverse via conjugated forward FFT.
  for (let k = 0; k < n; k++) {
   const re = this.aRe[k] * this.bRe[k] + this.aIm[k] * this.bIm[k];
   const im = this.aRe[k] * this.bIm[k] - this.aIm[k] * this.bRe[k];
   this.aRe[k] = re; this.aIm[k] = -im;
  }
  fft(this.aRe, this.aIm);
  // Sliding energy of b over [τ, τ+w).
  let shifted = energy;
  d[0] = 0;
  let running = 0;
  let best = -1, bestValue = Infinity, firstBelow = -1;
  const cmnd = new Float64Array(maxLag + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxLag; tau++) {
   const out = this.at(start + tau - 1), inn = this.at(start + tau - 1 + w);
   shifted += inn * inn - out * out;
   const c = this.aRe[tau] / n;
   d[tau] = Math.max(0, energy + shifted - 2 * c);
   running += d[tau];
   cmnd[tau] = running > 0 ? d[tau] * tau / running : 1;
   if (tau >= minLag) {
    if (cmnd[tau] < bestValue) { bestValue = cmnd[tau]; best = tau; }
    if (firstBelow < 0 && cmnd[tau] < this.threshold) firstBelow = tau;
   }
  }
  let tau = firstBelow;
  if (tau > 0) while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++;
  else tau = best;
  const frame = this.first! + start + Math.floor(w / 2);
  const rmsDb = toDb(Math.sqrt(energy / w));
  if (tau <= minLag || tau >= maxLag) return { frame, f0: null, clarity: 0, rmsDb };
  // Parabolic interpolation around the dip for sub-sample lag.
  const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
  const denom = a - 2 * b + c;
  const refined = denom > 0 ? tau + 0.5 * (a - c) / denom : tau;
  return { frame, f0: this.options.sampleRate / refined, clarity: Math.max(0, Math.min(1, 1 - b)), rmsDb };
 }
}

interface Open { start: number; pitches: number[]; clarity: number[]; peakDb: number; minSincePeak: number; minFrame: number; lastVoiced: number; lastUnvoiced: number | null }

/** Streaming note segmentation over PitchFrames. */
export class NoteSegmenter {
 private open: Open | null = null;
 private candidate: PitchFrame[] = [];
 private unvoiced = 0;
 private deviating: PitchFrame[] = [];
 private readonly hopFrames: number;
 private readonly minFrames: number;
 private readonly gate: number;
 private readonly minClarity: number;
 private noiseFloorDb: number;

 constructor(private options: PitchOptions & { hop: number }) {
  this.hopFrames = options.hop;
  this.minFrames = Math.round((options.minNoteMs ?? 70) * options.sampleRate / 1000);
  this.noiseFloorDb = options.noiseFloorDb ?? -60;
  this.gate = options.gateDb ?? PITCH_GATE_DB;
  this.minClarity = options.minClarity ?? MIN_PITCH_CLARITY;
 }

 setNoiseFloor(db: number) { this.noiseFloorDb = db; }

 /** Frame at which an open note began, if any (its frames are not final yet). */
 get openStart() { return this.open?.start ?? this.candidate[0]?.frame ?? null; }

 /** View-only estimate: it must never enter the finalized-note queue. */
 get liveNote(): SungNote | null {
  return this.open ? this.noteAt(this.open.lastVoiced + this.hopFrames / 2) : null;
 }

 push(frames: PitchFrame[]): SungNote[] {
  const notes: SungNote[] = [];
  for (const f of frames) this.step(f, notes);
  return notes;
 }

 /** End any open note at `frame` (take stopped or audio gap). */
 flush(frame: number): SungNote[] {
  const notes: SungNote[] = [];
  if (this.open) this.close(Math.min(frame, this.open.lastVoiced + this.hopFrames), notes);
  this.candidate = []; this.deviating = []; this.unvoiced = 0;
  return notes;
 }

 private voiced(f: PitchFrame) { return f.f0 !== null && f.clarity >= this.minClarity && f.rmsDb >= pitchGateDb(this.noiseFloorDb, f.clarity, this.open !== null, this.gate); }
 private median(values: number[]) { const s = [...values].sort((a, b) => a - b); return s[s.length >> 1]; }

 private step(f: PitchFrame, notes: SungNote[]) {
  const half = this.hopFrames / 2;
  if (!this.voiced(f)) {
   this.candidate = []; this.deviating = [];
   if (this.open) this.open.lastUnvoiced = f.frame;
   if (this.open && ++this.unvoiced >= 6) this.close(this.open.lastVoiced + half, notes);
   return;
  }
  let m = hzToMidi(f.f0!);
  if (!this.open) {
   // Onset: three consecutive voiced frames that agree within a semitone.
   if (this.candidate.length && Math.abs(hzToMidi(this.candidate[0].f0!) - m) > 1) this.candidate = [];
   this.candidate.push(f);
   if (this.candidate.length >= 3) {
    const c = this.candidate; this.candidate = [];
    this.open = { start: c[0].frame - half, pitches: c.map(x => hzToMidi(x.f0!)), clarity: c.map(x => x.clarity), peakDb: Math.max(...c.map(x => x.rmsDb)), minSincePeak: Infinity, minFrame: 0, lastVoiced: f.frame, lastUnvoiced: null };
   }
   return;
  }
  const o = this.open;
  this.unvoiced = 0;
  const centre = this.median(o.pitches);
  // Octave errors: a jump of ~12 semitones relative to the held note is folded back.
  if (Math.abs(Math.abs(m - centre) - 12) < 0.7) m += m > centre ? -12 : 12;
  // Re-articulation needs a recent break in periodic voicing as well as an envelope dip/rise.
  // A confident, continuously voiced swell is still one held note, even if its level varies.
  if (f.rmsDb > o.peakDb) { o.peakDb = f.rmsDb; o.minSincePeak = Infinity; }
  else if (f.rmsDb < o.minSincePeak) { o.minSincePeak = f.rmsDb; o.minFrame = f.frame; }
  if (o.lastUnvoiced !== null && f.frame - o.lastUnvoiced <= this.options.sampleRate * 0.06 && o.minSincePeak < o.peakDb - 9 && f.rmsDb > o.minSincePeak + 6) {
   const split = o.minFrame;
   this.close(split, notes);
   this.open = { start: split, pitches: [m], clarity: [f.clarity], peakDb: f.rmsDb, minSincePeak: Infinity, minFrame: 0, lastVoiced: f.frame, lastUnvoiced: null };
   this.deviating = [];
   return;
  }
  // A semitone change must be observable before reaching its exact centre: quiet/noisy YIN
  // frames can stay just shy of a full semitone. Keep the 12-hop (~70 ms) persistence test
  // so brief excursions from wide vibrato still cannot become a new note. Anchor this
  // comparison to the held MIDI note, not a momentarily biased raw vibrato median.
  if (Math.abs(m - Math.round(centre)) > 0.65) {
   this.deviating.push({ ...f, f0: 440 * 2 ** ((m - 69) / 12) });
   // Forget the mixed-pitch transition instead of letting its first frame veto a settled note forever.
   if (this.deviating.length > 12) this.deviating.shift();
   if (this.deviating.length >= 12 && this.deviating.every(x => Math.abs(hzToMidi(x.f0!) - hzToMidi(this.deviating[0].f0!)) <= 1)) {
    const d = this.deviating; this.deviating = [];
    this.close(d[0].frame - half, notes);
    this.open = { start: d[0].frame - half, pitches: d.map(x => hzToMidi(x.f0!)), clarity: d.map(x => x.clarity), peakDb: Math.max(...d.map(x => x.rmsDb)), minSincePeak: Infinity, minFrame: 0, lastVoiced: f.frame, lastUnvoiced: null };
   }
   return;
  }
  this.deviating = [];
  o.pitches.push(m); o.clarity.push(f.clarity); o.lastVoiced = f.frame;
 }

 private close(end: number, notes: SungNote[]) {
  const note = end - this.open!.start >= this.minFrames ? this.noteAt(end) : null;
  this.open = null; this.unvoiced = 0;
  if (note) notes.push(note);
 }

 private noteAt(end: number): SungNote | null {
  const o = this.open!;
  const midi = Math.round(this.median(o.pitches));
  if (midi < 0 || midi > 127) return null;
  const clarity = o.clarity.reduce((a, b) => a + b, 0) / o.clarity.length;
  const velocity = Math.min(1, Math.max(0.1, (o.peakDb - (this.noiseFloorDb + this.gate)) / Math.max(6, -6 - (this.noiseFloorDb + this.gate)) * 0.9 + 0.1));
  return { startFrame: Math.round(o.start), endFrame: Math.round(end), midi, velocity, confidence: Math.min(1, Math.max(0, (clarity - 0.5) * 2)) };
 }
}
