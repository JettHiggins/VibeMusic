/**
 * Percussive onset detection for beatboxed drum lanes.
 *
 * Pure and allocation-light so it can run in the analysis worker and in deterministic tests.
 * Frames are absolute AudioContext frames *before* latency compensation; the caller subtracts
 * calibrated latency exactly once when it turns an onset into a PerformanceEvent.
 */
export interface OnsetOptions {
 sampleRate: number;
 /** Hop between detection frames. 128 frames ≈ 2.9 ms at 44.1 kHz. */
 hop?: number;
 /** FFT size for spectral flux. */
 fftSize?: number;
 /** Calibrated background level in dBFS (RMS). Hits must exceed it by gateDb. */
 noiseFloorDb?: number;
 gateDb?: number;
 /** Minimum time between onsets; suppresses double triggers from one hit's decay. */
 retriggerMs?: number;
 /** History used for the adaptive threshold. */
 thresholdMs?: number;
 /** Threshold = median + sensitivity × MAD of recent detection values. */
 sensitivity?: number;
 /** A hit must rise this far above the quietest recent level; decays and sweeps never qualify. */
 riseDb?: number;
}
export interface Onset {
 /** Uncompensated capture frame of the transient's rise. */
 frame: number;
 velocity: number;
 confidence: number;
 /** Peak hop RMS in dBFS, useful for UI meters and calibration. */
 levelDb: number;
}

const EPS = 1e-12;
export const toDb = (rms: number) => 20 * Math.log10(Math.max(rms, EPS));

/** In-place iterative radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array) {
 const n = re.length;
 for (let i = 1, j = 0; i < n; i++) {
  let bit = n >> 1;
  for (; j & bit; bit >>= 1) j ^= bit;
  j ^= bit;
  if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
 }
 for (let len = 2; len <= n; len <<= 1) {
  const angle = -2 * Math.PI / len, wr = Math.cos(angle), wi = Math.sin(angle);
  for (let i = 0; i < n; i += len) {
   let cr = 1, ci = 0;
   for (let k = 0; k < len / 2; k++) {
    const a = i + k, b = a + len / 2;
    const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
    re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
   }
  }
 }
}

function median(values: number[]) {
 const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
 return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface Candidate { hopEnd: number; flux: number; threshold: number; rmsDb: number }

export class OnsetDetector {
 readonly hop: number;
 readonly fftSize: number;
 private readonly sampleRate: number;
 private readonly gateDb: number;
 private readonly retriggerFrames: number;
 private readonly historyLength: number;
 private readonly sensitivity: number;
 private readonly riseDb: number;
 private readonly riseHops: number;
 /** Recent hop RMS levels (dBFS), newest last. */
 private levels: number[] = [];
 private noiseFloorDb: number;
 /** Ring of raw samples covering the FFT window plus rise-search lookback. */
 private readonly ring: Float32Array;
 private written = 0;
 /** Absolute frame of ring sample 0 once written > ring.length is handled via modulo. */
 private firstFrame: number | null = null;
 private sinceHop = 0;
 private readonly window: Float64Array;
 private readonly re: Float64Array;
 private readonly im: Float64Array;
 private previousMagnitude: Float64Array;
 private hasPrevious = false;
 private history: number[] = [];
 private lastOnset = -Infinity;
 private lastLevelDb = -Infinity;
 /** Detection function samples awaiting one hop of lookahead for local-max picking. */
 private pending: Candidate[] = [];
 // One-pole high-pass removes DC/rumble without smearing transients.
 private hpPrevIn = 0;
 private hpPrevOut = 0;
 private readonly hpCoef: number;

 constructor(options: OnsetOptions) {
  this.sampleRate = options.sampleRate;
  this.hop = options.hop ?? 128;
  this.fftSize = options.fftSize ?? 512;
  if (this.fftSize & (this.fftSize - 1)) throw new Error('fftSize must be a power of two');
  this.noiseFloorDb = options.noiseFloorDb ?? -60;
  this.gateDb = options.gateDb ?? 12;
  this.retriggerFrames = Math.round((options.retriggerMs ?? 70) * this.sampleRate / 1000);
  this.historyLength = Math.max(8, Math.round((options.thresholdMs ?? 250) * this.sampleRate / 1000 / this.hop));
  this.sensitivity = options.sensitivity ?? 6;
  this.riseDb = options.riseDb ?? 9;
  this.riseHops = Math.max(4, Math.round(0.05 * this.sampleRate / this.hop));
  this.ring = new Float32Array(this.fftSize * 2);
  this.window = Float64Array.from({ length: this.fftSize }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / this.fftSize));
  this.re = new Float64Array(this.fftSize);
  this.im = new Float64Array(this.fftSize);
  this.previousMagnitude = new Float64Array(this.fftSize / 2 + 1);
  this.hpCoef = Math.exp(-2 * Math.PI * 40 / this.sampleRate);
 }

 setNoiseFloor(db: number) { this.noiseFloorDb = db; }

 /**
  * Feed contiguous mono samples whose first sample is at `startFrame`.
  * A discontinuity (dropout or new clock) must call reset() first.
  */
 process(samples: Float32Array, startFrame: number): Onset[] {
  if (this.firstFrame === null) this.firstFrame = startFrame;
  else if (startFrame !== this.firstFrame + this.written) throw new Error('Non-contiguous capture; reset the detector');
  const found: Onset[] = [];
  for (let i = 0; i < samples.length; i++) {
   const x = samples[i];
   const y = this.hpCoef * (this.hpPrevOut + x - this.hpPrevIn);
   this.hpPrevIn = x; this.hpPrevOut = y;
   this.ring[this.written % this.ring.length] = y;
   this.written++;
   if (++this.sinceHop >= this.hop) {
    this.sinceHop = 0;
    if (this.written >= this.fftSize) {
     const onset = this.analyseHop();
     if (onset) found.push(onset);
    }
   }
  }
  return found;
 }

 reset() {
  this.written = 0; this.firstFrame = null; this.sinceHop = 0; this.hasPrevious = false;
  this.history = []; this.pending = []; this.levels = []; this.lastOnset = -Infinity; this.lastLevelDb = -Infinity; this.hpPrevIn = 0; this.hpPrevOut = 0;
 }

 private sample(index: number) { return this.ring[((index % this.ring.length) + this.ring.length) % this.ring.length]; }

 private analyseHop(): Onset | null {
  const n = this.fftSize, end = this.written;
  let energy = 0;
  for (let i = 0; i < n; i++) {
   const s = this.sample(end - n + i);
   this.re[i] = s * this.window[i]; this.im[i] = 0;
  }
  // Energy over the newest hop gives a level with transient-scale time resolution.
  for (let i = end - this.hop; i < end; i++) { const s = this.sample(i); energy += s * s; }
  const rmsDb = toDb(Math.sqrt(energy / this.hop));
  fft(this.re, this.im);
  let flux = 0;
  const bins = n / 2 + 1;
  for (let k = 1; k < bins; k++) {
   const magnitude = Math.log1p(1000 * Math.hypot(this.re[k], this.im[k]));
   if (this.hasPrevious) flux += Math.max(0, magnitude - this.previousMagnitude[k]);
   this.previousMagnitude[k] = magnitude;
  }
  if (!this.hasPrevious) { this.hasPrevious = true; return null; }
  flux /= bins;
  const threshold = this.history.length < 4 ? Infinity : (() => {
   const m = median(this.history);
   const mad = median(this.history.map(v => Math.abs(v - m)));
   return Math.max(m + this.sensitivity * Math.max(mad, 1e-3), m * 1.5 + 0.02);
  })();
  this.history.push(flux);
  if (this.history.length > this.historyLength) this.history.shift();
  this.pending.push({ hopEnd: end, flux, threshold, rmsDb });
  this.levels.push(rmsDb);
  if (this.levels.length > this.riseHops + 3) this.levels.shift();
  if (this.pending.length < 3) return null;
  // Decide the middle candidate once its successor is known (one hop of lookahead).
  const [before, peak, after] = this.pending;
  this.pending.shift();
  if (!(peak.flux > peak.threshold && peak.flux >= before.flux && peak.flux > after.flux)) return null;
  const levelDb = Math.max(peak.rmsDb, after.rmsDb);
  if (levelDb < this.noiseFloorDb + this.gateDb) return null;
  // Spectral change alone also fires on decaying pitch sweeps; a percussive hit is an energy rise.
  const quietest = Math.min(...this.levels.slice(0, -2));
  if (levelDb - quietest < this.riseDb) return null;
  const frame = this.refine(peak.hopEnd);
  // Within the guard, only a clearly louder hit counts: a weak transient (a lip click, a decay
  // artefact) must not mask the real hit that follows it.
  if (frame - this.lastOnset < this.retriggerFrames && levelDb < this.lastLevelDb + 12) return null;
  this.lastOnset = frame; this.lastLevelDb = levelDb;
  const ratio = peak.flux / peak.threshold;
  const confidence = Math.min(1, Math.max(0, 0.5 + 0.25 * Math.log2(ratio)) * Math.min(1, (levelDb - this.noiseFloorDb) / (this.gateDb + 12)) + 0.15);
  const velocity = Math.min(1, Math.max(0.05, (levelDb - (this.noiseFloorDb + this.gateDb)) / Math.max(6, -6 - (this.noiseFloorDb + this.gateDb)) * 0.9 + 0.1));
  return { frame: this.firstFrame! + frame, velocity, confidence: Math.min(1, confidence), levelDb };
 }

 /** Locate the rise: first sample before the peak hop's end exceeding a fraction of the local peak. */
 private refine(hopEnd: number) {
  const start = Math.max(0, hopEnd - this.fftSize, this.written - this.ring.length + 1);
  const stop = Math.min(this.written, hopEnd + this.hop);
  let peak = 0;
  for (let i = start; i < stop; i++) peak = Math.max(peak, Math.abs(this.sample(i)));
  // Background level just before the window distinguishes rise from noise.
  let noise = 0;
  const noiseStart = Math.max(this.written - this.ring.length + 1, start - this.hop);
  for (let i = noiseStart; i < start; i++) noise = Math.max(noise, Math.abs(this.sample(i)));
  const level = Math.max(peak * 0.2, noise * 1.5);
  for (let i = start; i < stop; i++) if (Math.abs(this.sample(i)) >= level) return i;
  return hopEnd - this.hop;
 }
}
