import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, type ClientMessage, type Transport } from '../packages/contracts/src/index.ts';
import { boundaryTiming, gridTiming, summarizeTiming } from '../apps/web/src/input/grid-timing.ts';
import { NoteSegmenter, YinTracker } from '../apps/web/src/input/pitch.ts';
import { PerformanceRecorder } from '../apps/web/src/input/recorder.ts';

const SR = 44100, STEP = SR / 8; // 120 BPM sixteenth = 125 ms

test('boundary timing: signed offset from the rounded step and distance to the rounding threshold', () => {
 assert.deepEqual(boundaryTiming(0, 0, 120, SR), { step: 0, offsetMs: 0, thresholdMs: 62.5 });
 assert.deepEqual(boundaryTiming(Math.round(0.060 * SR), 0, 120, SR), { step: 0, offsetMs: 60, thresholdMs: 2.5 });
 assert.deepEqual(boundaryTiming(Math.round(0.070 * SR), 0, 120, SR), { step: 1, offsetMs: -55, thresholdMs: 7.5 });
 assert.deepEqual(boundaryTiming(1000 + 3 * STEP - Math.round(0.01 * SR), 1000, 120, SR), { step: 3, offsetMs: -10, thresholdMs: 52.5 });
 const e = gridTiming({ kind: 'note', midi: 60, start: 0, end: Math.round(0.4375 * SR) }, 0, 120, SR);
 assert.equal(e.nearThreshold, true, 'an end exactly on a midpoint is flagged');
 assert.equal(gridTiming({ kind: 'onset', start: Math.round(2 * STEP) }, 0, 120, SR).nearThreshold, false);
});

/** WS1's synthetic fixture (docs/reviews/PITCH-BOUNDARY-DIAGNOSTIC.md): C4/E4/G4 at a phase within the sixteenth. */
function phrase(phaseMs: number) {
 const input = new Float32Array(3 * SR);
 const notes: [number, number, number][] = [[1 + phaseMs / 1000, 0.375, 60], [1.5 + phaseMs / 1000, 0.375, 64], [2 + phaseMs / 1000, 0.5, 67]];
 for (const [at, duration, midi] of notes) {
  let p = 0;
  for (let i = 0; i < duration * SR; i++) {
   const t = i / SR, index = Math.round(at * SR) + i;
   p += 2 * Math.PI * 440 * 2 ** ((midi - 69 + 0.1 * Math.sin(2 * Math.PI * 5 * t)) / 12) / SR;
   const env = Math.min(1, t / 0.015, (duration - t) / 0.015);
   for (let h = 1; h <= 4; h++) input[index] += 0.15 * env * Math.sin(h * p) / (h * h);
  }
 }
 const yin = new YinTracker({ sampleRate: SR }), seg = new NoteSegmenter({ sampleRate: SR, hop: yin.hop, noiseFloorDb: -60 });
 const found = [];
 for (let i = 0; i < input.length; i += 1024) found.push(...seg.push(yin.process(input.subarray(i, i + 1024), i)));
 found.push(...seg.flush(input.length));
 return { notes, found };
}

test('every boundary that lands in a neighbouring cell in WS1\'s measured case is flagged near a threshold', () => {
 let crossings = 0;
 for (const phaseMs of [0, 35, 45, 50, 55, 60, 62.5, 65, 70, 75, 85, 100]) {
  const { notes, found } = phrase(phaseMs);
  assert.equal(found.length, 3, `phase ${phaseMs}`);
  found.forEach((n, i) => {
   const [at, duration] = notes[i];
   const entry = gridTiming({ kind: 'note', midi: n.midi, start: n.startFrame, end: n.endFrame }, 0, 120, SR);
   const idealStart = Math.round(at * SR / STEP), idealEnd = Math.round((at + duration) * SR / STEP);
   if (entry.start.step !== idealStart) { crossings++; assert.ok(entry.start.thresholdMs < 10, `phase ${phaseMs} note ${i} start crossed with ${entry.start.thresholdMs} ms margin`); }
   if (entry.end!.step !== idealEnd) { crossings++; assert.ok(entry.end!.thresholdMs < 10, `phase ${phaseMs} note ${i} end crossed with ${entry.end!.thresholdMs} ms margin`); }
  });
 }
 assert.ok(crossings >= 5, `the fixture still reproduces crossings (${crossings})`);
});

test('the recorder keeps recent placements on the engine grid origin without changing them', () => {
 let n = 0;
 const sent: unknown[] = [];
 const recorder = new PerformanceRecorder({ dispatch: c => { sent.push(c); return { type: 'ack', commandId: c.id, status: 'queued', revision: 0 } as ClientMessage; }, newId: () => `e${++n}` });
 const session = createSession(); session.selected = { trackId: 'synth-1' };
 recorder.handle({ type: 'session', session });
 const origin = 441000;
 const t: Transport = { clockId: 'c', sampleRate: SR, currentFrame: origin + 40 * STEP, loopStartFrame: origin, playing: true, recording: true, recordingState: 'recording', recordingStartFrame: origin + 16 * STEP, recordingTarget: { trackId: 'synth-1' }, recordingLoopStartFrame: origin, captureStartFrame: origin + 16 * STEP, recordingEpoch: 1, pendingCommandIds: [] };
 recorder.handle({ type: 'transport', transport: t });
 // A note starting 61 ms after step 20 (1.5 ms before the threshold) and ending on step 24 exactly.
 recorder.addNotes([{ startFrame: origin + 20 * STEP + Math.round(0.061 * SR), endFrame: origin + 24 * STEP, midi: 64, velocity: 0.8, confidence: 0.9 }], 0, 'c', origin + 40 * STEP);
 const timing = recorder.status().timing;
 assert.equal(timing.length, 1);
 assert.deepEqual([timing[0].start.step, timing[0].start.offsetMs, timing[0].nearThreshold], [20, 61, true]);
 assert.deepEqual([timing[0].end!.step, timing[0].end!.offsetMs], [24, 0]);
 assert.equal(recorder.status().provisional[0].step, 20, 'placement itself is unchanged');
 assert.deepEqual(summarizeTiming(timing), { events: 1, nearThreshold: 1, meanStartOffsetMs: 61, minStartThresholdMs: 1.5 });
});
