import { toDb } from './onset.ts';
import type { PitchReading } from './pitch.ts';

/** Per-device calibration persisted by the UI (not musical state; never contains audio). */
export interface InputCalibration {
 version: 1;
 /** Background RMS level in dBFS measured while the user is silent. */
 noiseFloorDb: number;
 /** Peak level of the loudest calibration hit, dBFS. Used for level feedback only. */
 peakDb: number | null;
 /**
  * Frames to subtract from capture-worklet frames to align with the music the user heard
  * (output + input round trip, including the performer's habitual offset when tap-measured).
  */
 latencyFrames: number;
 latencySource: 'default' | 'tap-along';
 /** Whether noiseFloorDb was measured on this device (absent in calibrations saved before this field). */
 noiseSource?: 'default' | 'measured';
 /**
  * Manual recording-offset trim per device, in ms, added to the measured latency. Positive moves
  * recorded events earlier. Absent means 0.
  */
 offsetAdjustMs?: number;
 /** Spread (median absolute deviation) of the tap measurement, frames. */
 latencySpreadFrames: number | null;
 sampleRate: number;
 deviceId: string | null;
}

/** Estimate steady room noise, excluding brief level bursts rather than raising every detector's gate.
 * A sufficiently steady majority is required: otherwise keep the prior calibration and retry. */
export function measureNoiseFloor(samples: Float32Array, windowFrames = 1024): number {
 if (samples.length < windowFrames) throw new Error('Not enough audio to measure the noise floor');
 const levels: number[] = [];
 for (let start = 0; start + windowFrames <= samples.length; start += windowFrames) {
  let sum = 0;
  for (let i = start; i < start + windowFrames; i++) sum += samples[i] * samples[i];
  levels.push(toDb(Math.sqrt(sum / windowFrames)));
 }
 levels.sort((a, b) => a - b);
 const centre = levels[Math.floor((levels.length - 1) * 0.5)];
 // Six dB allows ordinary short-window room variation but rejects a cough/handling burst.
 const steady = levels.filter(db => Math.abs(db - centre) <= 6);
 if (steady.length < Math.ceil(levels.length * 0.75)) {
  throw new Error('Room noise changed too much during measurement; wait for steady room noise and try again');
 }
 return steady[Math.min(steady.length - 1, Math.floor(steady.length * 0.9))];
}

/** Keep recognized/open sung notes out of room-noise calibration. */
export function isQuietCalibrationFrame(pitch: PitchReading | null, noteOpen: boolean): boolean {
 return !noteOpen && pitch !== null && pitch.state !== 'pitch' && !(pitch.midi !== null && pitch.clarity >= 0.8);
}

export interface LatencyEstimate { latencyFrames: number; spreadFrames: number; matched: number }

/**
 * Pair each scheduled click (AudioContext frame) with the first captured onset that follows it
 * within maxLatencyFrames, then take the median offset. Requires enough consistent pairs.
 */
export function estimateLatency(clickFrames: number[], onsetFrames: number[], options: { sampleRate: number; maxLatencyMs?: number; minMatches?: number; maxSpreadMs?: number }): LatencyEstimate {
 const maxLatency = Math.round((options.maxLatencyMs ?? 400) * options.sampleRate / 1000);
 // Allow slightly early taps: performers anticipate clicks by a few milliseconds.
 const early = Math.round(0.03 * options.sampleRate);
 const onsets = [...onsetFrames].sort((a, b) => a - b);
 const used = new Set<number>();
 const offsets: number[] = [];
 for (const click of [...clickFrames].sort((a, b) => a - b)) {
  const index = onsets.findIndex((onset, i) => !used.has(i) && onset >= click - early && onset <= click + maxLatency);
  if (index >= 0) { used.add(index); offsets.push(onsets[index] - click); }
 }
 const minMatches = options.minMatches ?? 6;
 if (offsets.length < minMatches) throw new Error(`Only ${offsets.length} of ${clickFrames.length} clicks were matched; tap louder or reduce background noise`);
 offsets.sort((a, b) => a - b);
 const median = offsets[offsets.length >> 1];
 const deviations = offsets.map(o => Math.abs(o - median)).sort((a, b) => a - b);
 const spread = deviations[deviations.length >> 1];
 const maxSpread = Math.round((options.maxSpreadMs ?? 25) * options.sampleRate / 1000);
 if (spread > maxSpread) throw new Error(`Taps were inconsistent (±${Math.round(spread / options.sampleRate * 1000)} ms); try again`);
 return { latencyFrames: Math.max(0, median), spreadFrames: spread, matched: offsets.length };
}

/** Browser-reported latency is a starting point until the performer calibrates. */
export function defaultCalibration(context: { sampleRate: number; baseLatency?: number; outputLatency?: number }, inputLatencySeconds = 0, deviceId: string | null = null): InputCalibration {
 const seconds = deviceId==='test-signal'?0:(context.baseLatency ?? 0) + (context.outputLatency ?? 0) + inputLatencySeconds;
 return { version: 1, noiseFloorDb: -60, peakDb: null, latencyFrames: Math.round(seconds * context.sampleRate), latencySource: 'default', latencySpreadFrames: null, sampleRate: context.sampleRate, deviceId };
}

/**
 * Guided calibration plan: a visible countdown, practice clicks that are never scored (performers
 * need them to lock in, and real hardware attenuates the first sounds after silence: on a tested
 * Windows laptop the first clicks reached the mic 15–20 dB quieter), then the measured clicks.
 */
export interface ClickPlan { countdown: number; countdownEnd: number; practice: number[]; measured: number[]; all: number[]; end: number }
export function clickPlan(startSeconds: number, options: { countdown?: number; practice?: number; measured?: number; interval?: number } = {}): ClickPlan {
 const countdown = options.countdown ?? 3, practice = options.practice ?? 4, measured = options.measured ?? 8, interval = options.interval ?? 0.5;
 const first = startSeconds + countdown;
 const all = Array.from({ length: practice + measured }, (_, i) => first + i * interval);
 return { countdown, countdownEnd: first, practice: all.slice(0, practice), measured: all.slice(practice), all, end: all[all.length - 1] + interval };
}

export type CalibrationPhase = 'countdown' | 'practice' | 'measuring' | 'analysing';
export interface CalibrationProgress { phase: CalibrationPhase; countdownLeft: number; practiceDone: number; measuredDone: number; measuredTotal: number }
/** Where a run is at time `now` (AudioContext seconds), for the progress display. */
export function calibrationProgress(plan: ClickPlan, now: number): CalibrationProgress {
 const done = (clicks: number[]) => clicks.filter(t => t <= now).length;
 const measuredTotal = plan.measured.length;
 if (now < plan.countdownEnd) return { phase: 'countdown', countdownLeft: Math.min(plan.countdown, Math.ceil(plan.countdownEnd - now)), practiceDone: 0, measuredDone: 0, measuredTotal };
 const practiceDone = done(plan.practice), measuredDone = done(plan.measured);
 const phase: CalibrationPhase = now >= plan.end ? 'analysing' : practiceDone < plan.practice.length ? 'practice' : 'measuring';
 return { phase, countdownLeft: 0, practiceDone, measuredDone, measuredTotal };
}

/** Frames to subtract from capture frames: measured latency plus the manual per-device trim. */
export function effectiveLatencyFrames(calibration: InputCalibration): number {
 return Math.max(0, Math.round(calibration.latencyFrames + (calibration.offsetAdjustMs ?? 0) * calibration.sampleRate / 1000));
}

export type CalibrationStep = 'measure-silence' | 'calibrate-timing';
export interface CalibrationStatus { ready: boolean; missing: CalibrationStep[]; advice: string }
/**
 * Whether a microphone is calibrated well enough for a take. The browser's latency estimate is a
 * starting point only: on tested hardware it was 62 ms against a measured ~120 ms round trip,
 * which places every hit about a 32nd note late at 120 BPM. Test signals bypass both issues.
 */
export function calibrationStatus(calibration: InputCalibration | null): CalibrationStatus {
 if (!calibration) return { ready: false, missing: ['measure-silence', 'calibrate-timing'], advice: 'Enable the microphone first.' };
 if (calibration.deviceId === 'test-signal') return { ready: true, missing: [], advice: 'Diagnostic test signal: no calibration needed.' };
 const missing: CalibrationStep[] = [];
 if (calibration.noiseSource !== 'measured') missing.push('measure-silence');
 if (calibration.latencySource !== 'tap-along') missing.push('calibrate-timing');
 const advice = !missing.length ? 'Calibrated.'
  : missing.length === 2 ? 'Measure silence, then calibrate timing, before recording: uncalibrated takes land late.'
  : missing[0] === 'measure-silence' ? 'Measure silence so quiet hits are not mistaken for background noise.'
  : 'Calibrate timing before recording: the browser estimate is usually too short, so hits land late.';
 return { ready: !missing.length, missing, advice };
}

/**
 * Repeatable tap test against the *current* compensation: how far the performer's taps still land
 * from the clicks after the effective latency is removed. Positive residual = recorded late.
 */
export interface TimingCheck { residualMs: number; suggestedTrimMs: number; verdict: 'on-time' | 'late' | 'early'; text: string }
export function timingCheck(measuredLatencyFrames: number, calibration: InputCalibration, toleranceMs = 10): TimingCheck {
 const residualMs = (measuredLatencyFrames - effectiveLatencyFrames(calibration)) / calibration.sampleRate * 1000;
 const suggestedTrimMs = Math.max(-150, Math.min(150, Math.round((calibration.offsetAdjustMs ?? 0) + residualMs)));
 const verdict = Math.abs(residualMs) <= toleranceMs ? 'on-time' : residualMs > 0 ? 'late' : 'early';
 const text = verdict === 'on-time' ? `Taps land within ${Math.abs(residualMs).toFixed(0)} ms of the clicks: timing is good.`
  : `Taps are recorded ${Math.abs(residualMs).toFixed(0)} ms ${verdict} with the current settings.`;
 return { residualMs, suggestedTrimMs, verdict, text };
}
