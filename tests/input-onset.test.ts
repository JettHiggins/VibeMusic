import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { OnsetDetector, type Onset } from '../apps/web/src/input/onset.ts';
import { defaultCalibration, estimateLatency, measureNoiseFloor } from '../apps/web/src/input/calibration.ts';

const SR = 44100;
function rng(seed: number) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const dbToAmp = (db: number) => 10 ** (db / 20);

type Kind = 'kick' | 'snare' | 'hat';
/** Vocal-percussion-like hits: pitched-down thump, noisy snare, short bright hat. */
function addHit(buffer: Float32Array, at: number, kind: Kind, peakDb: number, random: () => number) {
 const amp = dbToAmp(peakDb);
 const length = kind === 'hat' ? 0.06 * SR : kind === 'snare' ? 0.2 * SR : 0.3 * SR;
 let phase = 0, hp = 0, prev = 0;
 for (let i = 0; i < length && at + i < buffer.length; i++) {
  const t = i / SR;
  const attack = Math.min(1, i / (0.0015 * SR));
  let s: number;
  if (kind === 'kick') { phase += 2 * Math.PI * (55 + 120 * Math.exp(-t * 30)) / SR; s = Math.sin(phase) * Math.exp(-t * 12); }
  else if (kind === 'snare') { s = ((random() * 2 - 1) * 0.8 + Math.sin(2 * Math.PI * 190 * t) * 0.3) * Math.exp(-t * 18); }
  else { const n = random() * 2 - 1; hp = 0.6 * (hp + n - prev); prev = n; s = hp * 2 * Math.exp(-t * 60); }
  buffer[at + i] += s * amp * attack;
 }
}
function noise(length: number, db: number, random: () => number) { const a = dbToAmp(db) * Math.sqrt(3); return Float32Array.from({ length }, () => (random() * 2 - 1) * a); }
function run(buffer: Float32Array, startFrame: number, chunk: number, options: Partial<ConstructorParameters<typeof OnsetDetector>[0]> = {}) {
 const detector = new OnsetDetector({ sampleRate: SR, noiseFloorDb: -60, ...options });
 const onsets: Onset[] = [];
 for (let i = 0; i < buffer.length; i += chunk) onsets.push(...detector.process(buffer.subarray(i, i + chunk), startFrame + i));
 return onsets;
}

test('beatboxed kick, snare and hats are located within 2 ms without double triggers', () => {
 const random = rng(7), buffer = noise(SR * 4, -62, random);
 const kinds: Kind[] = ['kick', 'hat', 'snare', 'hat'];
 const truth = Array.from({ length: 16 }, (_, i) => Math.round(0.3 * SR + i * 0.22 * SR + (i % 3) * 37));
 truth.forEach((at, i) => addHit(buffer, at, kinds[i % 4], -12 - (i % 4) * 3, random));
 const start = 1_000_000;
 const onsets = run(buffer, start, 128);
 assert.equal(onsets.length, truth.length, `found ${onsets.map(o => o.frame - start)}`);
 onsets.forEach((onset, i) => assert.ok(Math.abs(onset.frame - start - truth[i]) <= 0.002 * SR, `hit ${i}: ${onset.frame - start} vs ${truth[i]}`));
 assert.ok(onsets.every(o => o.confidence >= 0.6), `confidences ${onsets.map(o => o.confidence.toFixed(2))}`);
});

test('quiet and loud hits are both detected and velocity follows level', () => {
 const random = rng(11), buffer = noise(SR * 3, -65, random);
 const levels = [-6, -30, -10, -34, -18, -26];
 levels.forEach((db, i) => addHit(buffer, Math.round(0.25 * SR + i * 0.4 * SR), 'snare', db, random));
 const onsets = run(buffer, 0, 1024, { noiseFloorDb: -63 });
 assert.equal(onsets.length, levels.length);
 const byLevel = onsets.map((o, i) => [levels[i], o.velocity] as const).sort((a, b) => a[0] - b[0]);
 for (let i = 1; i < byLevel.length; i++) assert.ok(byLevel[i][1] >= byLevel[i - 1][1], `velocity not monotonic: ${byLevel}`);
});

test('steady background noise and sub-gate rustle produce no onsets', () => {
 const random = rng(3), buffer = noise(SR * 3, -45, random);
 for (let i = 0; i < 6; i++) addHit(buffer, Math.round((0.3 + i * 0.4) * SR), 'hat', -44, random);
 assert.deepEqual(run(buffer, 0, 256, { noiseFloorDb: -45 }), []);
});

test('results are independent of capture block size', () => {
 const random = rng(19), buffer = noise(SR * 2, -60, random);
 for (let i = 0; i < 7; i++) addHit(buffer, Math.round((0.2 + i * 0.25) * SR + i * 13), i % 2 ? 'kick' : 'snare', -14, random);
 const reference = run(buffer, 500, 128).map(o => o.frame);
 for (const chunk of [1, 77, 1024, 4096]) assert.deepEqual(run(buffer, 500, chunk).map(o => o.frame), reference, `chunk ${chunk}`);
});

test('flams closer than the retrigger guard count once; separated hits count twice', () => {
 const random = rng(23), buffer = noise(SR * 2, -62, random);
 addHit(buffer, 0.3 * SR, 'snare', -12, random); addHit(buffer, 0.3 * SR + 0.03 * SR, 'snare', -12, random);
 addHit(buffer, 1.0 * SR, 'snare', -12, random); addHit(buffer, 1.0 * SR + 0.12 * SR, 'snare', -12, random);
 assert.equal(run(buffer, 0, 128).length, 3);
});

test('a weak transient does not mask a clearly louder hit inside the retrigger guard', () => {
 const random = rng(41), buffer = noise(SR * 2, -62, random);
 addHit(buffer, 0.5 * SR, 'hat', -44, random);
 addHit(buffer, 0.5 * SR + 0.04 * SR, 'kick', -10, random);
 const onsets = run(buffer, 0, 128);
 assert.ok(onsets.some(o => Math.abs(o.frame - (0.54 * SR)) <= 0.002 * SR), `onsets ${onsets.map(o => o.frame)}`);
});

test('a decaying pitch sweep does not retrigger, in digital silence or in noise', () => {
 for (const floor of [null, -60]) {
  const random = rng(53), buffer = floor === null ? new Float32Array(SR * 3) : noise(SR * 3, floor, random);
  const truth = [0.2, 0.7, 0.95, 1.6, 2.1].map(s => Math.round(s * SR));
  for (const at of truth) {
   let phase = 0;
   for (let k = 0; k < 0.18 * SR; k++) { const t = k / SR; phase += 2 * Math.PI * (55 + 110 * Math.exp(-t * 30)) / SR; buffer[at + k] += Math.sin(phase) * Math.exp(-t * 14) * 0.5 * Math.min(1, k / 60) * Math.min(1, (0.18 * SR - k) / (0.04 * SR)); }
  }
  const onsets = run(buffer, 0, 128);
  assert.deepEqual(onsets.map(o => Math.round((o.frame) / SR * 100)), truth.map(f => Math.round(f / SR * 100)), `noise floor ${floor}`);
 }
});

test('discontinuous capture is rejected instead of silently skewing timestamps', () => {
 const detector = new OnsetDetector({ sampleRate: SR });
 detector.process(new Float32Array(128), 0);
 assert.throws(() => detector.process(new Float32Array(128), 1000), /Non-contiguous/);
 detector.reset(); detector.process(new Float32Array(128), 1000);
});

test('p95 analysis time per 1024-frame block stays far below the 50 ms target', () => {
 const random = rng(5), buffer = noise(SR * 10, -60, random);
 for (let i = 0; i < 40; i++) addHit(buffer, Math.round((0.1 + i * 0.24) * SR), 'snare', -15, random);
 const detector = new OnsetDetector({ sampleRate: SR });
 const times: number[] = [];
 for (let i = 0; i < buffer.length; i += 1024) { const t = performance.now(); detector.process(buffer.subarray(i, i + 1024), i); times.push(performance.now() - t); }
 times.sort((a, b) => a - b);
 const p95 = times[Math.floor(times.length * 0.95)];
 assert.ok(p95 < 50, `p95 ${p95.toFixed(2)} ms`);
});

test('noise floor uses a robust percentile of short windows', () => {
 const random = rng(9), buffer = noise(SR, -50, random);
 const floor = measureNoiseFloor(buffer);
 assert.ok(floor > -53 && floor < -47, `floor ${floor}`);
 addHit(buffer, 0.5 * SR, 'hat', -10, random);
 assert.ok(measureNoiseFloor(buffer) < -45, 'a single short hit must not dominate');
 assert.throws(() => measureNoiseFloor(new Float32Array(10)));
});

test('tap-along latency is the median click-to-onset offset and rejects inconsistent taps', () => {
 const clicks = Array.from({ length: 8 }, (_, i) => 10_000 + i * 22050);
 const offsets = [5100, 5300, 5000, 5200, 5150, 4900, 5250, 5050];
 const onsets = clicks.map((c, i) => c + offsets[i]).concat([12_345]);
 const estimate = estimateLatency(clicks, onsets, { sampleRate: SR });
 assert.equal(estimate.matched, 8); assert.ok(Math.abs(estimate.latencyFrames - 5150) <= 100); assert.ok(estimate.spreadFrames < 250);
 assert.throws(() => estimateLatency(clicks, onsets.slice(0, 3), { sampleRate: SR }), /matched/);
 const erratic = clicks.map((c, i) => c + (i % 2 ? 2000 : 9000));
 assert.throws(() => estimateLatency(clicks, erratic, { sampleRate: SR }), /inconsistent/);
});

test('detected onsets drive tap-along latency end to end', () => {
 const random = rng(31), buffer = noise(SR * 5, -60, random);
 const latency = 0.118 * SR;
 const clicks = Array.from({ length: 8 }, (_, i) => Math.round(0.3 * SR + i * 0.5 * SR));
 clicks.forEach((c, i) => addHit(buffer, Math.round(c + latency + (i % 2 ? 60 : -60)), 'snare', -15, random));
 const onsets = run(buffer, 0, 128).map(o => o.frame);
 const estimate = estimateLatency(clicks, onsets, { sampleRate: SR });
 assert.ok(Math.abs(estimate.latencyFrames - latency) <= 0.003 * SR, `latency ${estimate.latencyFrames} vs ${latency}`);
});

test('decaying kick chirps do not retrigger at different capture-hop phases',()=>{
 for(const offset of [0,23,79,127,255,511]){
  const buffer=new Float32Array(3*SR),truth=[0.5,1,1.5,2.5].map(seconds=>Math.round(seconds*SR)+offset);
  for(const at of truth)for(let n=0;n<0.2*SR&&at+n<buffer.length;n++){
   const t=n/SR;
   buffer[at+n]+=0.5*Math.sin(2*Math.PI*(60+100*Math.exp(-30*t))*t)*Math.exp(-14*t)*Math.min(1,t/0.002)*Math.min(1,(0.2-t)/0.05);
  }
  const found=run(buffer,1000,1024);
  assert.equal(found.length,truth.length,`phase ${offset}: ${found.map(onset=>onset.frame-1000)}`);
 }
});

test('diagnostic buffers bypass round-trip latency while real microphone defaults retain it',()=>{
 const context={sampleRate:44100,baseLatency:0.02,outputLatency:0.2};
 assert.equal(defaultCalibration(context,0.01,'real-device').latencyFrames,10143);
 assert.equal(defaultCalibration(context,0,'test-signal').latencyFrames,0);
});
