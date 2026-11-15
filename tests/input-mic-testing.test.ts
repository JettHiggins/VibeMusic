import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationProgress, calibrationStatus, clickPlan, effectiveLatencyFrames, estimateLatency, type InputCalibration } from '../apps/web/src/input/calibration.ts';
import { MicCheck } from '../apps/web/src/input/mic-check.ts';
import { buildMicTestReport } from '../apps/web/src/input/diagnostics.ts';
import type { AnalysisFrame } from '../apps/web/src/input/microphone.ts';

const SR = 44100;
const cal = (over: Partial<InputCalibration> = {}): InputCalibration => ({ version: 1, noiseFloorDb: -60, peakDb: null, latencyFrames: 2734, latencySource: 'default', latencySpreadFrames: null, sampleRate: SR, deviceId: 'mic', ...over });

test('guided calibration: countdown, unscored practice clicks, and a real-hardware warm-up no longer fails it', () => {
 const plan = clickPlan(1, { countdown: 3, practice: 4, measured: 8, interval: 0.5 });
 assert.equal(plan.countdownEnd, 4);
 assert.deepEqual(plan.practice, [4, 4.5, 5, 5.5]);
 assert.equal(plan.measured.length, 8);
 assert.equal(plan.measured[0], 6);
 assert.equal(plan.end, 10);
 // Reproduced on a Windows laptop: the first clicks after silence arrive ~15-20 dB quieter and
 // are missed; only later clicks are detected, ~120 ms after scheduling.
 const latency = Math.round(0.12 * SR);
 const heard = (clicks: number[], missedFirst: number) => clicks.slice(missedFirst).map((c, i) => Math.round(c * SR) + latency + (i % 2 ? 90 : -90));
 const old = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];
 assert.throws(() => estimateLatency(old.map(c => Math.round(c * SR)), heard(old, 3), { sampleRate: SR }), /matched/, 'old 8-click run with 3 warm-up misses fails');
 const est = estimateLatency(plan.measured.map(c => Math.round(c * SR)), heard(plan.all, 3), { sampleRate: SR });
 assert.ok(Math.abs(est.latencyFrames - latency) < 0.004 * SR, `latency ${est.latencyFrames}`);
 assert.equal(est.matched, 8, 'the warm-up misses fall inside the practice clicks');
});

test('calibration progress drives the countdown, practice and measured displays', () => {
 const plan = clickPlan(10);
 assert.deepEqual(calibrationProgress(plan, 10.2), { phase: 'countdown', countdownLeft: 3, practiceDone: 0, measuredDone: 0, measuredTotal: 8 });
 assert.equal(calibrationProgress(plan, 12.5).countdownLeft, 1);
 assert.equal(calibrationProgress(clickPlan(10.05), 10).countdownLeft, 3, 'never shows more than the countdown length');
 assert.deepEqual(calibrationProgress(plan, 13.6), { phase: 'practice', countdownLeft: 0, practiceDone: 2, measuredDone: 0, measuredTotal: 8 });
 assert.deepEqual(calibrationProgress(plan, 16.1), { phase: 'measuring', countdownLeft: 0, practiceDone: 4, measuredDone: 3, measuredTotal: 8 });
 assert.equal(calibrationProgress(plan, plan.end + 0.1).phase, 'analysing');
});

test('manual recording-offset trim is added to the measured latency and never goes negative', () => {
 assert.equal(effectiveLatencyFrames(cal({ latencyFrames: 5292 })), 5292);
 assert.equal(effectiveLatencyFrames(cal({ latencyFrames: 5292, offsetAdjustMs: 20 })), 5292 + 882);
 assert.equal(effectiveLatencyFrames(cal({ latencyFrames: 441, offsetAdjustMs: -50 })), 0);
});

test('recording readiness requires measured silence and tap calibration, except for test signals', () => {
 assert.deepEqual(calibrationStatus(cal()).missing, ['measure-silence', 'calibrate-timing']);
 assert.equal(calibrationStatus(cal()).ready, false);
 assert.deepEqual(calibrationStatus(cal({ noiseSource: 'measured' })).missing, ['calibrate-timing']);
 assert.match(calibrationStatus(cal({ noiseSource: 'measured' })).advice, /land late/);
 assert.equal(calibrationStatus(cal({ noiseSource: 'measured', latencySource: 'tap-along' })).ready, true);
 assert.equal(calibrationStatus(cal({ deviceId: 'test-signal' })).ready, true);
 assert.equal(calibrationStatus(null).ready, false);
 // Calibrations saved before noiseSource existed still load, and ask for a fresh silence measurement.
 assert.deepEqual(calibrationStatus(cal({ latencySource: 'tap-along' })).missing, ['measure-silence']);
});

const frame = (end: number, levelDb: number, extra: Partial<AnalysisFrame> = {}): AnalysisFrame => ({ onsets: [], notes: [], analysedThrough: end, levelDb, analysisMs: 1, ...extra });

test('mic check flags the levels seen in real testing: too quiet, no signal, clipping, noisy room', () => {
 const check = new MicCheck(SR);
 // Real session: floor about -39 dBFS and performance peaks of -46..-30 dBFS: nothing could be detected.
 for (let i = 1; i <= 40; i++) check.add(frame(i * 1024, -46 + (i % 5)));
 assert.equal(check.state(-38.9).verdict, 'no-signal');
 check.add(frame(41 * 1024, -30));
 const quiet = check.state(-38.9);
 assert.equal(quiet.verdict, 'too-quiet');
 assert.match(quiet.advice, /above -27 dBFS/);
 assert.equal(quiet.noisyRoom, true);
 check.add(frame(42 * 1024, -12, { onsets: [{ frame: 1, velocity: 0.8, confidence: 0.9, levelDb: -12 }] }));
 const good = check.state(-38.9);
 assert.equal(good.verdict, 'ok');
 assert.equal(good.onsetsDetected, 1);
 assert.match(good.advice, /noisy/);
 assert.equal(check.state(-60).advice, 'Level is good.');
 check.add(frame(43 * 1024, -0.2));
 assert.equal(check.state(-60).verdict, 'clipping');
 // The window forgets old peaks.
 const late = new MicCheck(SR, 1);
 late.add(frame(1024, -10)); late.add(frame(SR * 3, -70));
 assert.equal(late.state(-60).verdict, 'no-signal');
});

test('mic check reports weak hits and detected sung notes', () => {
 const check = new MicCheck(SR);
 check.add(frame(1024, -20, { onsets: [{ frame: 1, velocity: 0.3, confidence: 0.45, levelDb: -20 }] }));
 assert.match(check.state(-60).advice, /weak/);
 check.add(frame(2048, -18, { notes: [{ startFrame: 0, endFrame: SR / 2, midi: 64, velocity: 0.7, confidence: 0.9 }] }));
 const s = check.state(-60);
 assert.equal(s.notesDetected, 1);
 assert.equal(s.lastNote?.midi, 64);
 assert.equal(Math.round(s.lastNote!.durationMs), 500);
});

test('the mic test report holds measurements only', () => {
 const check = new MicCheck(SR); check.add(frame(1024, -14, { onsets: [{ frame: 1, velocity: 0.8, confidence: 0.9, levelDb: -14 }] }));
 const report = buildMicTestReport({
  now: new Date('2026-11-14T00:00:00Z'), browser: 'Chrome 140 / Windows',
  context: { sampleRate: SR, baseLatency: 0.01, outputLatency: 0.042 },
  capture: { echoCancellation: false, noiseSuppression: true, autoGainControl: false, sampleRate: 48000, latency: 0.01, channelCount: 1, ...({ deviceId: 'secret-id', label: 'My Headset' } as object) },
  processingProfile: 'noisy-room',
  calibration: cal({ noiseSource: 'measured', noiseFloorDb: -38.94, latencySource: 'tap-along', latencyFrames: 5292, latencySpreadFrames: 220 }),
  micCheck: check.state(-38.9),
  recorder: { mode: 'manual', capturing: false, provisional: [], timing: [], committed: 4, dropped: 1, lastError: null, inFlight: null },
  analysisP95Ms: 3.21,
 });
 assert.equal(report.capture.processingProfile, 'noisy-room');
 assert.equal(report.capture.processingMatchesProfile, true);
 assert.equal(report.calibration?.latencyMs, 120);
 assert.equal(report.context.outputLatencyMs, 42);
 const text = JSON.stringify(report);
 assert.ok(!/secret-id|My Headset|deviceId|label/.test(text), 'no device identifiers');
 assert.equal(report.takes.committed, 4);
 assert.equal(report.micCheck.onsetsDetected, 1);
 assert.equal(report.micCheck.foregroundDb, null);
});

test('live pitch diagnosis explains why singing does or does not become notes', async () => {
 const { readPitch } = await import('../apps/web/src/input/pitch.ts');
 const f = (rmsDb: number, f0: number | null, clarity: number) => ({ frame: 0, rmsDb, f0, clarity });
 // Noisy room from real testing: floor -39 dBFS; clear periodic input uses the -27 dBFS acquisition gate.
 assert.equal(readPitch([f(-44, 220, 0.9)], -39, false)!.state, 'silent');
 const quiet = readPitch([f(-30, 220, 0.95)], -39, false)!;
 assert.deepEqual([quiet.state, quiet.midi, quiet.gateDb], ['quiet', 57, -27]);
 assert.equal(readPitch([f(-20, 220, 0.6)], -39, false)!.state, 'unclear');
 assert.equal(readPitch([f(-20, null, 0)], -39, false)!.state, 'unclear');
 const ok = readPitch([f(-40, 110, 0.9), f(-18, 261.63, 0.93)], -39, true)!;
 assert.deepEqual([ok.state, ok.midi, ok.holding], ['pitch', 60, true]);
 assert.equal(readPitch([], -39, false), null);

 const check = new MicCheck(SR);
 assert.match(check.state(-39).pitchAdvice, /Sing or hum/);
 check.add(frame(1024, -30, { pitch: quiet }));
 assert.match(check.state(-39).pitchAdvice, /notes need -27 dBFS: sing louder or closer, or reduce room noise/);
 check.add(frame(2048, -20, { pitch: readPitch([f(-20, 220, 0.6)], -39, false) }));
 assert.match(check.state(-39).pitchAdvice, /clarity 0.60, needs 0.80/);
 check.add(frame(3072, -18, { pitch: ok }));
 assert.match(check.state(-39).pitchAdvice, /Hearing C4 \(clarity 0.93\): note being held/);
 // A momentary quieter frame does not hide a usable pitch heard just before it.
 check.add(frame(4096, -40, { pitch: readPitch([f(-44, null, 0)], -39, true) }));
 assert.match(check.state(-39).pitchAdvice, /Hearing C4/);

 const reference = new MicCheck(SR);
 for (let i = 0; i < 30; i++) reference.add(frame((i + 1) * Math.round(SR * 0.025), -30, { pitch: quiet }));
 const lowMargin = reference.state(-39);
 assert.equal(lowMargin.foregroundDb, -30);
 assert.equal(lowMargin.foregroundMarginDb, 9);
 assert.match(lowMargin.foregroundAdvice, /9 dB above room noise; notes need about 12 dB/);
 const clearReference = new MicCheck(SR);
 const normalPitch = readPitch([f(-18, 220, 0.95)], -39, false)!;
 for (let i = 0; i < 30; i++) clearReference.add(frame((i + 1) * Math.round(SR * 0.025), -18, { pitch: normalPitch }));
 assert.equal(clearReference.state(-39).foregroundMarginDb, 21);
 assert.match(clearReference.state(-39).foregroundAdvice, /clears the pitch level gate/);
 const referenceReport = buildMicTestReport({
  browser: 'test', context: { sampleRate: SR }, capture: {}, processingProfile: 'noisy-room', calibration: cal({ noiseFloorDb: -39 }),
  micCheck: clearReference.state(-39), recorder: { mode: 'manual', capturing: false, provisional: [], timing: [], committed: 0, dropped: 0, lastError: null, inFlight: null }, analysisP95Ms: null,
 });
 assert.equal(referenceReport.micCheck.foregroundMarginDb, 21);
});
