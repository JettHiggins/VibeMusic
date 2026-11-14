import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, type PerformanceEvent } from '../packages/contracts/src/index.ts';
import { commitPerformance, type RecordingWindow } from '../apps/web/src/engine/performance.ts';
import { defaultCalibration, effectiveLatencyFrames, timingCheck, type InputCalibration } from '../apps/web/src/input/calibration.ts';

const SR = 44100, STEP = SR * 60 / (120 * 4), START = 441000;
const window: RecordingWindow = { startFrame: START, endFrame: null, loopStartFrame: START, tempo: 120, target: { trackId: 'drums', lane: 'kick' } };
/** A performer hitting intended steps with natural ±15 ms timing, heard and captured with `latencyMs` round trip. */
function take(latencyMs: number, compensationFrames: number) {
 const intended = [2, 4, 8, 10, 12, 16, 20, 24, 26, 28, 32, 36, 40, 42, 44, 48, 52, 56, 58, 60];
 const human = intended.map((_, i) => [-15, -8, 0, 6, 12, 15][i % 6]);
 const events: PerformanceEvent[] = intended.map((s, i) => ({ kind: 'onset', id: `h${i}`, target: window.target, clockId: 'c', confidence: 0.9, velocity: 0.8,
  captureFrame: Math.round(START + s * STEP + (human[i] + latencyMs) / 1000 * SR - compensationFrames) }));
 const session = commitPerformance(createSession(), { type: 'commit-performance', events, excludedSpans: [], verifiedThroughFrame: START + 70 * STEP }, window, 'c', START + 70 * STEP);
 const got = session.tracks[3].hits.map(h => h.step).sort((a, b) => a - b);
 return { intended, got, wrong: got.filter((s, i) => s !== intended[i]).length };
}

test('cause of late hits: compensating ~120 ms real latency with the 62 ms browser estimate moves hits a step late', () => {
 // Values measured on a tested Windows laptop: browser estimate 62 ms, measured round trip ~120 ms.
 const estimate = defaultCalibration({ sampleRate: SR, baseLatency: 0.01, outputLatency: 0.042 }, 0.01);
 assert.equal(Math.round(estimate.latencyFrames / SR * 1000), 62);
 const uncalibrated = take(120, effectiveLatencyFrames(estimate));
 assert.ok(uncalibrated.wrong >= 4, `only ${uncalibrated.wrong} hits moved`);
 assert.ok(uncalibrated.got.some((s, i) => s === uncalibrated.intended[i] + 1), 'moved hits land one step late');
 const calibrated = take(120, effectiveLatencyFrames({ ...estimate, latencyFrames: Math.round(0.12 * SR), latencySource: 'tap-along' }));
 assert.equal(calibrated.wrong, 0, `calibrated: ${calibrated.got}`);
});

test('the manual trim fixes a residual offset the tap test reports', () => {
 const cal: InputCalibration = { ...defaultCalibration({ sampleRate: SR }, 0), latencyFrames: Math.round(0.07 * SR), latencySource: 'tap-along' };
 // Real round trip 120 ms, calibrated to 70 ms (e.g. calibrated with different headphones).
 const check = timingCheck(Math.round(0.12 * SR), cal);
 assert.equal(check.verdict, 'late');
 assert.equal(Math.round(check.residualMs), 50);
 assert.equal(check.suggestedTrimMs, 50);
 assert.match(check.text, /recorded 50 ms late/);
 assert.ok(take(120, effectiveLatencyFrames(cal)).wrong > 0);
 const trimmed = { ...cal, offsetAdjustMs: check.suggestedTrimMs };
 assert.equal(take(120, effectiveLatencyFrames(trimmed)).wrong, 0);
 assert.equal(timingCheck(Math.round(0.12 * SR), trimmed).verdict, 'on-time');
 assert.equal(timingCheck(Math.round(0.05 * SR), trimmed).verdict, 'early');
});
