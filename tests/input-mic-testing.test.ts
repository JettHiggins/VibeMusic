import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrationStatus, clickPlan, estimateLatency, type InputCalibration } from '../apps/web/src/input/calibration.ts';
import { MicCheck } from '../apps/web/src/input/mic-check.ts';
import { buildMicTestReport } from '../apps/web/src/input/diagnostics.ts';
import type { AnalysisFrame } from '../apps/web/src/input/microphone.ts';

const SR = 44100;
const cal = (over: Partial<InputCalibration> = {}): InputCalibration => ({ version: 1, noiseFloorDb: -60, peakDb: null, latencyFrames: 2734, latencySource: 'default', latencySpreadFrames: null, sampleRate: SR, deviceId: 'mic', ...over });

test('calibration clicks include unscored lead-ins; a real-hardware warm-up no longer fails calibration', () => {
 const plan = clickPlan(1, { leadIn: 2, measured: 10, interval: 0.5 });
 assert.equal(plan.all.length, 12);
 assert.deepEqual(plan.measured, plan.all.slice(2));
 // Reproduced on a Windows laptop: the first clicks after silence arrive ~15-20 dB quieter and
 // are missed; only later clicks are detected, ~120 ms after scheduling.
 const latency = Math.round(0.12 * SR);
 const heard = (clicks: number[], missedFirst: number) => clicks.slice(missedFirst).map((c, i) => Math.round(c * SR) + latency + (i % 2 ? 90 : -90));
 const old = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];
 assert.throws(() => estimateLatency(old.map(c => Math.round(c * SR)), heard(old, 3), { sampleRate: SR }), /matched/, 'old 8-click run with 3 warm-up misses fails');
 const fresh = clickPlan(1);
 const est = estimateLatency(fresh.measured.map(c => Math.round(c * SR)), heard(fresh.all, 3), { sampleRate: SR });
 assert.ok(Math.abs(est.latencyFrames - latency) < 0.004 * SR, `latency ${est.latencyFrames}`);
 assert.ok(est.matched >= 9);
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
  capture: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000, latency: 0.01, channelCount: 1, ...({ deviceId: 'secret-id', label: 'My Headset' } as object) },
  calibration: cal({ noiseSource: 'measured', noiseFloorDb: -38.94, latencySource: 'tap-along', latencyFrames: 5292, latencySpreadFrames: 220 }),
  micCheck: check.state(-38.9),
  recorder: { mode: 'manual', capturing: false, provisional: [], committed: 4, dropped: 1, lastError: null, inFlight: null },
  analysisP95Ms: 3.21,
 });
 assert.equal(report.capture.processingDisabledAsRequested, true);
 assert.equal(report.calibration?.latencyMs, 120);
 assert.equal(report.context.outputLatencyMs, 42);
 const text = JSON.stringify(report);
 assert.ok(!/secret-id|My Headset|deviceId|label/.test(text), 'no device identifiers');
 assert.equal(report.takes.committed, 4);
 assert.equal(report.micCheck.onsetsDetected, 1);
});
