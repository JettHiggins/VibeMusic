import { toDb } from './onset.ts';

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
 /** Spread (median absolute deviation) of the tap measurement, frames. */
 latencySpreadFrames: number | null;
 sampleRate: number;
 deviceId: string | null;
}

/** Measure the noise floor as a high percentile of short-window RMS, so a cough does not dominate. */
export function measureNoiseFloor(samples: Float32Array, windowFrames = 1024): number {
 if (samples.length < windowFrames) throw new Error('Not enough audio to measure the noise floor');
 const levels: number[] = [];
 for (let start = 0; start + windowFrames <= samples.length; start += windowFrames) {
  let sum = 0;
  for (let i = start; i < start + windowFrames; i++) sum += samples[i] * samples[i];
  levels.push(toDb(Math.sqrt(sum / windowFrames)));
 }
 levels.sort((a, b) => a - b);
 return levels[Math.min(levels.length - 1, Math.floor(levels.length * 0.9))];
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
