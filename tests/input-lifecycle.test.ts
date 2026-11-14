import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClientMessage } from '../packages/contracts/src/index.ts';
import { VoiceInput, type MicLike } from '../apps/web/src/input/voice-input.ts';
import { TimedRun } from '../apps/web/src/input/timed-run.ts';
import { MicCheck } from '../apps/web/src/input/mic-check.ts';
import { buildMicTestReport } from '../apps/web/src/input/diagnostics.ts';
import type { AnalysisFrame } from '../apps/web/src/input/microphone.ts';

const SR = 44100;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Minimal AudioContext double: a controllable clock, a close switch, and click nodes we can inspect. */
function fakeContext() {
 const nodes: { stopped: number; disconnected: boolean }[] = [];
 const ctx = {
  sampleRate: SR, currentTime: 10, state: 'running' as AudioContextState, baseLatency: 0.01, outputLatency: 0.04, destination: {},
  createOscillator() { const n = { frequency: { value: 0 }, stopped: 0, disconnected: false, connect: (g: unknown) => g, start() {}, stop() { n.stopped++; }, disconnect() { n.disconnected = true; } }; nodes.push(n); return n; },
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => d, disconnect() {} }; },
 };
 return { ctx, nodes };
}
function fakeMic(): MicLike & { stops: number; disposed: boolean; noise: { resolve?: (db: number) => void } } {
 const mic = {
  onAnalysis: (_: AnalysisFrame) => {}, onError: (_: Error) => {}, inputLatencySeconds: 0.01, deviceId: 'mic-a', captureSettings: null,
  stops: 0, disposed: false, noise: {} as { resolve?: (db: number) => void },
  async startMicrophone() {}, async startTestSignal() {}, configure() {}, flush() {}, reset() {},
  measureNoiseFloor() { return new Promise<number>(resolve => { mic.noise.resolve = resolve; }); },
  stop() { mic.stops++; }, dispose() { mic.disposed = true; },
 };
 return mic;
}
async function setup() {
 const { ctx, nodes } = fakeContext();
 const mic = fakeMic();
 const listeners: ((m: ClientMessage) => void)[] = [];
 const engine = { getAudioContext: () => ctx as unknown as AudioContext, subscribe: (l: (m: ClientMessage) => void) => { listeners.push(l); return () => {}; }, dispatch: () => ({ type: 'ack', commandId: 'x', status: 'queued', revision: 0 }) as ClientMessage };
 const voice = new VoiceInput(engine, 'manual', { createMic: () => mic, tickMs: 5 });
 await voice.enableMicrophone();
 // A prior valid calibration that must survive interrupted runs.
 voice.setLatencyFrames(5292);
 return { ctx, nodes, mic, voice, listeners, prior: voice.getState().calibration! };
}

for (const [name, interrupt] of [
 ['stopping the microphone', (s: Awaited<ReturnType<typeof setup>>) => s.voice.stopMicrophone()],
 ['the device disconnecting', (s: Awaited<ReturnType<typeof setup>>) => s.mic.onError(new Error('Microphone disconnected'))],
 ['changing device', (s: Awaited<ReturnType<typeof setup>>) => { void s.voice.enableMicrophone('mic-b'); }],
 ['disposing', (s: Awaited<ReturnType<typeof setup>>) => s.voice.dispose()],
 ['the AudioContext closing', (s: Awaited<ReturnType<typeof setup>>) => { s.ctx.state = 'closed'; }],
] as const) {
 test(`a running timing calibration settles on ${name}, stops scheduled clicks and keeps the previous calibration`, async () => {
  const s = await setup();
  const run = s.voice.calibrateLatency();
  await sleep(15);
  assert.equal(s.voice.getState().calibrating, 'latency');
  assert.equal(s.nodes.length, 12, 'four practice plus eight measured clicks scheduled');
  interrupt(s);
  // Before the fix the interval kept running and, after close, the promise never settled.
  const settled = await Promise.race([run.then(() => true), sleep(500).then(() => false)]);
  assert.ok(settled, 'calibration promise settled');
  assert.ok(s.nodes.every(n => n.disconnected), 'click nodes disconnected');
  if (s.ctx.state !== 'closed') assert.ok(s.nodes.every(n => n.stopped >= 1), 'future clicks stopped');
  const st = s.voice.getState();
  assert.equal(st.calibrating, null);
  assert.equal(st.calibrationRun, null);
  if (name === 'changing device') assert.equal(st.calibration?.deviceId, 'mic-a', 'the new device loads its own calibration (fake mic keeps its id)');
  else assert.equal(st.calibration?.latencyFrames, s.prior.latencyFrames, 'previous timing kept');
  assert.match(st.calibrationResult?.text ?? '', /cancelled; the previous timing was kept/);
 });
}

test('guided silence measurement: quiet countdown, then measurement; cancel keeps the previous floor', async () => {
 const s = await setup();
 const first = s.voice.calibrateNoise(3);
 await sleep(15);
 assert.deepEqual(s.voice.getState().silenceRun, { phase: 'countdown', countdownLeft: 3 });
 assert.equal(s.nodes.length, 0, 'no clicks during silence measurement');
 s.ctx.currentTime += 3.01;
 await sleep(20);
 assert.deepEqual(s.voice.getState().silenceRun, { phase: 'measuring' });
 s.mic.noise.resolve!(-41.2);
 await first;
 assert.equal(s.voice.getState().calibration?.noiseFloorDb, -41.2);
 assert.equal(s.voice.getState().calibration?.noiseSource, 'measured');
 assert.match(s.voice.getState().calibrationResult!.text, /Noise floor -41.2 dBFS \(noisy room/);
 // Cancel during the countdown and during the measurement: the measured floor survives both.
 const second = s.voice.calibrateNoise(3);
 await sleep(15); s.voice.cancelCalibration(); await second;
 assert.equal(s.voice.getState().calibration?.noiseFloorDb, -41.2);
 const third = s.voice.calibrateNoise(3);
 await sleep(15); s.ctx.currentTime += 3.01; await sleep(20);
 s.voice.cancelCalibration(); s.mic.noise.resolve!(-20); await third;
 assert.equal(s.voice.getState().calibration?.noiseFloorDb, -41.2);
 assert.match(s.voice.getState().calibrationResult!.text, /previous noise floor was kept/);
 assert.equal(s.voice.getState().silenceRun, null);
});

test('only one guided run at a time', async () => {
 const s = await setup();
 const run = s.voice.calibrateLatency();
 await sleep(10);
 await s.voice.calibrateNoise();
 assert.match(s.voice.getState().calibrationResult!.text, /already running/);
 s.voice.cancelCalibration(); await run;
});

test('TimedRun settles once whichever way it ends and runs cleanups exactly once', async () => {
 let now = 0, closed = false, ticks = 0, cleaned = 0;
 const done = new TimedRun({ now: () => now, closed: () => closed }, 1, () => { ticks++; }, 2);
 done.onEnd(() => cleaned++);
 now = 1; assert.equal(await done.settled, 'done'); done.cancel();
 assert.equal(cleaned, 1); assert.ok(ticks >= 1);
 const closing = new TimedRun({ now: () => 0, closed: () => closed }, 1, () => {}, 2);
 closed = true; assert.equal(await closing.settled, 'cancelled');
 let late = 0; closing.onEnd(() => late++); assert.equal(late, 1, 'cleanup registered after the end runs immediately');
});

const frame = (analysedThrough: number, processedThrough: number, levelDb: number, extra: Partial<AnalysisFrame> = {}): AnalysisFrame => ({ onsets: [], notes: [], analysedThrough, processedThrough, levelDb, analysisMs: 1, ...extra });

test('mic check ages readings by real processed time even while a sustained note holds the verification watermark', () => {
 const check = new MicCheck(SR, 2);
 const noteStart = 10 * SR;
 // A loud consonant, then a long held note: analysedThrough stays at the note start for 5 s.
 check.add(frame(noteStart, noteStart, -6, { pitch: { state: 'pitch', midi: 64, clarity: 0.95, levelDb: -6, gateDb: -45, holding: true } }));
 for (let t = 1; t <= 50; t++) check.add(frame(noteStart, noteStart + t * 0.1 * SR, -30, { pitch: { state: 'quiet', midi: 60, clarity: 0.9, levelDb: -30, gateDb: -24, holding: true } }));
 const s = check.state(-39);
 assert.equal(Math.round(s.peakDb), -30, 'the old -6 dBFS peak expired after 2 s of real time');
 assert.equal(s.pitch?.state, 'quiet', 'the stale usable-pitch reading was replaced');
});

test('the copied test report includes the manual trim and the effective compensation', () => {
 const report = buildMicTestReport({
  now: new Date(0), browser: 'test', context: { sampleRate: SR },
  capture: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  calibration: { version: 1, noiseFloorDb: -40, peakDb: null, latencyFrames: 5292, latencySource: 'tap-along', latencySpreadFrames: 100, sampleRate: SR, deviceId: 'secret', noiseSource: 'measured', offsetAdjustMs: 30 },
  micCheck: new MicCheck(SR).state(-40), recorder: { mode: 'manual', capturing: false, provisional: [], committed: 0, dropped: 0, lastError: null, inFlight: null }, analysisP95Ms: null,
 });
 assert.equal(report.calibration?.latencyMs, 120);
 assert.equal(report.calibration?.offsetAdjustMs, 30);
 assert.equal(report.calibration?.effectiveLatencyMs, 150);
 assert.ok(!JSON.stringify(report).includes('secret'));
});


test('VoiceInput resets at raw cutoff with effective latency once and preserves backend Undo identity',async()=>{
 const s=await setup();
 s.voice.setOffsetAdjust(30);
 const resets:number[]=[],flushes:number[]=[];s.mic.reset=f=>resets.push(f);s.mic.flush=f=>flushes.push(f);
 const emit=(m:ClientMessage)=>s.listeners.forEach(l=>l(m));
 const transport={clockId:'clock',sampleRate:SR,currentFrame:100000,loopStartFrame:0,playing:true,recording:true,recordingState:'recording' as const,recordingStartFrame:88200,recordingTarget:{trackId:'drums' as const,lane:'kick' as const},recordingEpoch:1,captureStartFrame:88200,recordingLoopStartFrame:0,pendingCommandIds:[]};
 emit({type:'session',session:(await import('../packages/contracts/src/index.ts')).createSession()});
 emit({type:'transport',transport});
 const latency=5292+Math.round(.03*SR);
 assert.deepEqual(resets,[88200+latency]);
 s.mic.onAnalysis({onsets:[{frame:90000+latency,velocity:.8,confidence:1,levelDb:-12}],notes:[],analysedThrough:100000+latency,levelDb:-12,analysisMs:1});
 const command={id:'backend-utterance:cmd',expectedRevision:0,boundary:'immediate' as const,operation:{type:'undo' as const}};
 const prepared=s.voice.prepareCommand(command);
 assert.equal(prepared.id,command.id);assert.deepEqual(prepared.operation,{type:'undo',discardCaptureOnly:true});
 emit({type:'transport',transport:{...transport,recordingEpoch:2,captureStartFrame:100001}});
 assert.deepEqual(resets,[88200+latency,100001+latency]);
 assert.equal(s.voice.recorder.status().provisional.length,0);
 assert.equal(flushes.length,0,'live reset never flushes old held singing');
 assert.deepEqual(s.voice.prepareCommand(command).operation,{type:'undo'});
 s.voice.dispose();
});


test('Undo discards an open sung note before it has produced any completed note event',async()=>{
 const s=await setup();const emit=(m:ClientMessage)=>s.listeners.forEach(l=>l(m));
 emit({type:'transport',transport:{clockId:'clock',sampleRate:SR,currentFrame:150000,loopStartFrame:0,playing:true,recording:true,recordingState:'recording',recordingStartFrame:88200,recordingTarget:{trackId:'synth-1'},recordingEpoch:1,captureStartFrame:88200,pendingCommandIds:[]}});
 s.mic.onAnalysis({onsets:[],notes:[],analysedThrough:100000+5292,processedThrough:150000,levelDb:-12,analysisMs:1,pitch:{state:'pitch',midi:60,clarity:1,levelDb:-12,gateDb:-45,holding:true}});
 assert.equal(s.voice.recorder.hasPendingCapture,false,'the note is still held inside the worker');
 assert.deepEqual(s.voice.prepareCommand({id:'undo-held',expectedRevision:0,boundary:'immediate',operation:{type:'undo'}}).operation,{type:'undo',discardCaptureOnly:true});
 s.voice.dispose();
});
