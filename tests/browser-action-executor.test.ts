import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientMessage, type BrowserAction, type BrowserActionAck, type BrowserStatus, type ClientMessage as Client, type Transport } from '../packages/contracts/src/index.ts';
import { VoiceInput, type MicLike } from '../apps/web/src/input/voice-input.ts';
import { BrowserActionRouter, supportsBrowserActions } from '../apps/web/src/integration/browser-actions.ts';
import type { AnalysisFrame } from '../apps/web/src/input/microphone.ts';

const SR = 44100;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function fakeContext() {
 const nodes: { stopped: number; disconnected: boolean }[] = [];
 return {
  nodes,
  sampleRate: SR, currentTime: 10, state: 'running' as AudioContextState, baseLatency: 0.01, outputLatency: 0.04, destination: {},
  createOscillator() { const n = { frequency: { value: 0 }, stopped: 0, disconnected: false, connect: (g: unknown) => g, start() {}, stop() { n.stopped++; }, disconnect() { n.disconnected = true; } }; nodes.push(n); return n; },
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d: unknown) => d, disconnect() {} }; },
 };
}
function fakeMic() {
 const mic = {
  onAnalysis: (_: AnalysisFrame) => {}, onError: (_: Error) => {}, inputLatencySeconds: 0.01, deviceId: 'mic-a', captureSettings: null,
  starts: [] as (string | undefined)[], speechStreams: [] as string[], speechStops: 0,
  noise: {} as { resolve?: (db: number) => void; reject?: (error: Error) => void },
  async startMicrophone(_device?: string, profile?: string) { mic.starts.push(profile); }, async startTestSignal() {}, configure() {}, flush() {}, reset() {},
  measureNoiseFloor() { return new Promise<number>((resolve, reject) => { mic.noise.resolve = resolve; mic.noise.reject = reject; }); },
  startSpeech(config: { streamId: string }) { mic.speechStreams.push(config.streamId); },
  stopSpeech() { mic.speechStops++; },
  stop() {}, dispose() {},
 };
 return mic satisfies MicLike;
}
const idle = (patch: Partial<Transport> = {}): Transport => ({ clockId: 'clock', sampleRate: SR, currentFrame: 1000, loopStartFrame: 0, playing: false, recording: false, recordingState: 'idle', pendingCommandIds: [], ...patch } as Transport);

async function setup() {
 const ctx = fakeContext(), mic = fakeMic();
 const listeners: ((m: Client) => void)[] = [];
 const engine = { getAudioContext: () => ctx as unknown as AudioContext, subscribe: (l: (m: Client) => void) => { listeners.push(l); return () => {}; }, dispatch: () => ({ type: 'ack', commandId: 'x', status: 'queued', revision: 0 }) as Client };
 const voice = new VoiceInput(engine, 'manual', { createMic: () => mic, tickMs: 5, speechResumeMs: 300 });
 const emit = (m: Client) => listeners.forEach(l => l(m));
 const out: (BrowserStatus | BrowserActionAck)[] = [];
 voice.subscribeBrowserActions(m => { assert.ok(ClientMessage.safeParse(m).success, `schema-valid ${JSON.stringify(m)}`); out.push(m); });
 emit({ type: 'transport', transport: idle() });
 await voice.enableMicrophone();
 let n = 0;
 const act = (operation: BrowserAction['operation'], patch: Partial<BrowserAction> = {}): BrowserAction => {
  const action: BrowserAction = { type: 'browser-action', id: `a${++n}`, clockId: 'clock', expectedInputRevision: voice.getBrowserStatus()!.inputRevision, operation, ...patch };
  voice.handleBrowserAction(action); return action;
 };
 const acks = (id: string) => out.filter((m): m is BrowserActionAck => m.type === 'browser-action-ack' && m.id === id).map(m => m.status);
 const statuses = () => out.filter((m): m is BrowserStatus => m.type === 'browser-status');
 const until = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await sleep(5); assert.ok(fn(), 'condition reached'); };
 return { ctx, mic, voice, emit, out, act, acks, statuses, until };
}

test('VoiceInput is a complete adapter: no status before the audio clock, then a schema-valid snapshot', async () => {
 const listeners: ((m: Client) => void)[] = [];
 const voice = new VoiceInput({ getAudioContext: () => null, subscribe: l => { listeners.push(l); return () => {}; }, dispatch: () => ({ type: 'ack', commandId: 'x', status: 'queued', revision: 0 }) });
 assert.ok(supportsBrowserActions(voice), 'main.tsx will attach the executor');
 assert.equal(voice.getBrowserStatus(), null);
 listeners.forEach(l => l({ type: 'transport', transport: idle() }));
 const status = voice.getBrowserStatus()!;
 assert.ok(ClientMessage.safeParse(status).success);
 assert.deepEqual([status.available, status.microphone, status.profile, status.calibration, status.activeAction], [true, 'off', 'noisy-room', null, null]);
});

test('agent noise calibration reports real phases, publishes the new status before complete and advances the revision', async () => {
 const s = await setup();
 const before = s.voice.getBrowserStatus()!;
 const action = s.act({ type: 'calibrate-input', mode: 'noise' });
 assert.deepEqual(s.acks(action.id), ['running']);
 await sleep(15);
 assert.equal(s.voice.getBrowserStatus()!.activeAction?.phase, 'countdown');
 s.ctx.currentTime += 3.01; await sleep(20);
 assert.equal(s.voice.getBrowserStatus()!.activeAction?.phase, 'measuring');
 assert.equal(s.voice.getBrowserStatus()!.inputRevision, before.inputRevision, 'progress alone does not change the revision');
 s.mic.noise.resolve!(-52);
 await s.until(() => s.acks(action.id).length === 2);
 assert.deepEqual(s.acks(action.id), ['running', 'complete']);
 const lastStatus = s.out.map(m => m.type).lastIndexOf('browser-status'), completeAt = s.out.findIndex(m => m.type === 'browser-action-ack' && m.status === 'complete');
 assert.ok(lastStatus < completeAt, 'status precedes the terminal acknowledgment');
 const after = s.voice.getBrowserStatus()!;
 assert.ok(after.inputRevision > before.inputRevision);
 assert.deepEqual([after.calibration?.noiseMeasured, after.calibration?.noiseFloorDb, after.activeAction], [true, -52, null]);
 const ack = s.out.find((m): m is BrowserActionAck => m.type === 'browser-action-ack' && m.status === 'complete')!;
 assert.equal(ack.inputRevision, after.inputRevision);
 assert.match(ack.reason!, /Noise floor -52.0 dBFS/);
});

test('insufficient quiet is rejected with its cause and keeps the previous calibration', async () => {
 const s = await setup();
 const floor = s.voice.getState().calibration!.noiseFloorDb;
 const action = s.act({ type: 'calibrate-input', mode: 'noise' });
 await sleep(15); s.ctx.currentTime += 3.01; await sleep(20);
 s.mic.noise.reject!(new Error('Not enough quiet audio to measure room noise'));
 await s.until(() => s.acks(action.id).length === 2);
 assert.deepEqual(s.acks(action.id), ['running', 'rejected']);
 assert.match((s.out.at(-1) as BrowserActionAck).reason!, /Not enough quiet audio/);
 assert.equal(s.voice.getState().calibration!.noiseFloorDb, floor);
});

test('stale revision, wrong clock, duplicates and conflicting ID reuse never rerun or mutate', async () => {
 const s = await setup();
 const rev = s.voice.getBrowserStatus()!.inputRevision;
 const stale = s.act({ type: 'set-input-offset', milliseconds: 20 }, { expectedInputRevision: rev + 5 });
 const clock = s.act({ type: 'set-input-offset', milliseconds: 20 }, { clockId: 'old-clock' });
 assert.deepEqual([s.acks(stale.id), s.acks(clock.id)], [['rejected'], ['rejected']]);
 assert.equal(s.voice.getState().calibration!.offsetAdjustMs ?? 0, 0);
 const ok = s.act({ type: 'set-input-offset', milliseconds: 20 });
 await s.until(() => s.acks(ok.id).includes('complete'));
 assert.equal(s.voice.getState().calibration!.offsetAdjustMs, 20);
 const revAfter = s.voice.getBrowserStatus()!.inputRevision;
 s.voice.handleBrowserAction(ok);
 assert.deepEqual(s.acks(ok.id), ['running', 'complete', 'complete'], 'duplicate replays the recorded outcome');
 assert.equal(s.voice.getBrowserStatus()!.inputRevision, revAfter, 'duplicate did not rerun');
 s.voice.handleBrowserAction({ ...ok, operation: { type: 'set-input-offset', milliseconds: -40 } });
 assert.equal(s.acks(ok.id).at(-1), 'rejected');
 assert.equal(s.voice.getState().calibration!.offsetAdjustMs, 20);
});

test('calibration needs stopped playback and idle capture; profile and offset may change during playback', async () => {
 const s = await setup();
 s.emit({ type: 'transport', transport: idle({ playing: true }) });
 const cal = s.act({ type: 'calibrate-input', mode: 'timing' });
 assert.deepEqual(s.acks(cal.id), ['rejected']);
 assert.match((s.out.at(-1) as BrowserActionAck).reason!, /Stop playback/);
 const profile = s.act({ type: 'set-input-profile', profile: 'music' });
 await s.until(() => s.acks(profile.id).includes('complete'));
 assert.equal(s.voice.getBrowserStatus()!.profile, 'music');
 assert.equal(s.mic.starts.at(-1), 'music', 'the microphone was reopened with the music constraints');
 s.emit({ type: 'transport', transport: idle({ playing: true, recording: true, recordingState: 'recording', recordingEpoch: 1 }) });
 const during = s.act({ type: 'set-input-offset', milliseconds: 10 });
 assert.deepEqual(s.acks(during.id), ['rejected']);
 assert.match((s.out.at(-1) as BrowserActionAck).reason!, /stop recording/i);
});

test('cancel-input-action cancels only the named action, which reports cancelled and keeps the previous calibration', async () => {
 const s = await setup();
 const prior = s.voice.getState().calibration!;
 const run = s.act({ type: 'calibrate-input', mode: 'full' });
 await sleep(15);
 const wrong = s.act({ type: 'cancel-input-action', actionId: 'not-running' });
 assert.deepEqual(s.acks(wrong.id), ['rejected']);
 assert.ok(s.voice.getBrowserStatus()!.activeAction, 'unrelated cancel left the action running');
 const second = s.act({ type: 'set-input-offset', milliseconds: 5 });
 assert.deepEqual(s.acks(second.id), ['rejected'], 'one mutating action at a time');
 const cancel = s.act({ type: 'cancel-input-action', actionId: run.id });
 await s.until(() => s.acks(cancel.id).length === 1);
 assert.deepEqual(s.acks(run.id), ['running', 'cancelled']);
 assert.deepEqual(s.acks(cancel.id), ['complete']);
 assert.equal(s.voice.getState().calibration, prior, 'nothing invented on cancel');
 assert.equal(s.voice.getBrowserStatus()!.activeAction, null);
});

test('disconnect cancels agent-owned work but never a calibration started from the screen', async () => {
 const s = await setup();
 const manual = s.voice.calibrateNoise(3);
 await sleep(10);
 s.voice.cancelBrowserActions('Agent disconnected');
 await sleep(10);
 assert.equal(s.voice.getState().silenceRun?.phase, 'countdown', 'manual run survives');
 const refused = s.act({ type: 'calibrate-input', mode: 'noise' });
 assert.deepEqual(s.acks(refused.id), ['rejected'], 'agent cannot start over a manual run');
 s.voice.cancelCalibration(); await manual;

 const agent = s.act({ type: 'calibrate-input', mode: 'timing' });
 await sleep(15);
 s.voice.cancelBrowserActions('Agent disconnected');
 await s.until(() => s.acks(agent.id).length === 2);
 assert.deepEqual(s.acks(agent.id), ['running', 'cancelled']);
});

test('input changes restart hands-free speech on a fresh stream without dropping the agent socket', async () => {
 const s = await setup();
 let resets = 0;
 s.voice.configureSpeechSender(() => {}, () => { resets++; }, async () => {});
 s.voice.setSpeechAvailable(true); s.voice.setHandsFree(true);
 const firstStream = s.mic.speechStreams.at(-1)!;
 s.voice.handleServerMessage({ type: 'speech-status', streamId: firstStream, available: true, provider: 'SCRIPTED' });
 assert.equal(s.voice.getState().speech.status, 'ready');
 const action = s.act({ type: 'set-input-offset', milliseconds: 30 });
 await s.until(() => s.mic.speechStreams.length === 2);
 assert.equal(s.voice.getBrowserStatus()!.activeAction?.phase, 'reconnecting');
 const secondStream = s.mic.speechStreams.at(-1)!;
 assert.notEqual(secondStream, firstStream);
 s.voice.handleServerMessage({ type: 'speech-status', streamId: secondStream, available: true, provider: 'SCRIPTED' });
 await s.until(() => s.acks(action.id).length === 2);
 assert.deepEqual(s.acks(action.id), ['running', 'complete']);
 assert.equal(resets, 0, 'the socket (and so this action) was never torn down');
 assert.equal(s.voice.getState().speech.status, 'ready');
 assert.doesNotMatch((s.out.at(-1) as BrowserActionAck).reason!, /not ready/);
});

test('speech that does not come back is reported honestly rather than as ready', async () => {
 const s = await setup();
 s.voice.configureSpeechSender(() => {}, () => {}, async () => {});
 s.voice.setSpeechAvailable(true); s.voice.setHandsFree(true);
 s.voice.handleServerMessage({ type: 'speech-status', streamId: s.mic.speechStreams.at(-1)!, available: true, provider: 'SCRIPTED' });
 const action = s.act({ type: 'set-input-offset', milliseconds: -30 });
 await s.until(() => s.acks(action.id).length === 2);
 assert.equal(s.acks(action.id)[1], 'complete', 'the offset itself was applied');
 assert.match((s.out.at(-1) as BrowserActionAck).reason!, /Hands-free speech is not ready yet/);
});

test('the real WS1 router forwards executor status and outcomes for the current clock', async () => {
 const s = await setup();
 const sent: Client[] = [];
 const router = new BrowserActionRouter(m => sent.push(m), () => true, () => 'clock', e => { throw e; });
 router.setAdapter(s.voice);
 router.connectionChanged(true);
 assert.equal(sent[0]?.type, 'browser-status');
 const action: BrowserAction = { type: 'browser-action', id: 'routed-1', clockId: 'clock', expectedInputRevision: s.voice.getBrowserStatus()!.inputRevision, operation: { type: 'set-input-offset', milliseconds: 12 } };
 router.handle(action);
 for (let i = 0; i < 50 && !sent.some(m => m.type === 'browser-action-ack' && m.status === 'complete'); i++) await sleep(5);
 assert.deepEqual(sent.filter(m => m.type === 'browser-action-ack').map(m => (m as BrowserActionAck).status), ['running', 'complete']);
 assert.equal((sent.filter(m => m.type === 'browser-status').at(-1) as BrowserStatus).calibration?.offsetAdjustMs, 12);
 router.dispose();
});

test('review: disconnect cannot cancel a screen calibration started during speech reconnect', async () => {
 const s = await setup();
 s.voice.configureSpeechSender(() => {}, () => {}, async () => {});
 s.voice.setSpeechAvailable(true); s.voice.setHandsFree(true);
 s.voice.handleServerMessage({ type: 'speech-status', streamId: s.mic.speechStreams.at(-1)!, available: true, provider: 'SCRIPTED' });
 const action = s.act({ type: 'set-input-offset', milliseconds: 20 });
 await s.until(() => s.voice.getBrowserStatus()!.activeAction?.phase === 'reconnecting');
 const manual = s.voice.calibrateNoise();
 await sleep(15);
 const started = s.voice.getState().calibrating === 'noise';
 s.voice.cancelBrowserActions('Agent disconnected');
 await sleep(15);
 const survived = s.voice.getState().calibrating === 'noise';
 s.voice.cancelCalibration(); await manual;
 await s.until(() => s.acks(action.id).length === 2);
 assert.ok(!started || survived, 'either refuse a manual start during agent work, or preserve its ownership on disconnect');
});

test('review: starting a take cancels pending calibration before its result can alter input settings', async () => {
 const s = await setup();
 const prior = s.voice.getState().calibration!;
 const action = s.act({ type: 'calibrate-input', mode: 'noise' });
 await sleep(15); s.ctx.currentTime += 3.01; await sleep(20);
 assert.equal(s.voice.getState().silenceRun?.phase, 'measuring');
 s.emit({ type: 'transport', transport: idle({ playing: true, recordingState: 'armed', recordingEpoch: 1 }) });
 s.mic.noise.resolve!(-43);
 await s.until(() => s.acks(action.id).length === 2);
 assert.equal(s.voice.getState().calibration, prior, 'a late calibration result must not change the settings of an armed take');
 assert.ok(['cancelled','rejected'].includes(s.acks(action.id).at(-1)!));
});

for (const [mode, change] of [
 ['timing', { playing: true }],
 ['timing', { recordingState: 'armed', recordingEpoch: 1 }],
 ['check-timing', { recording: true, recordingState: 'recording', playing: true, recordingEpoch: 1 }],
] as const) {
 test(`agent ${mode} calibration is cancelled when ${Object.keys(change).join('/')} changes, stopping its clicks and keeping timing`, async () => {
  const s = await setup();
  const prior = s.voice.getState().calibration!;
  const action = s.act({ type: 'calibrate-input', mode });
  await sleep(15);
  assert.equal(s.ctx.nodes.length, 12, 'clicks scheduled');
  s.emit({ type: 'transport', transport: idle(change) });
  await s.until(() => s.acks(action.id).length === 2);
  assert.equal(s.acks(action.id)[1], 'cancelled');
  assert.match((s.out.at(-1) as BrowserActionAck).reason!, /(Playback started|Recording was armed or started), so the measurement was cancelled; the previous timing was kept/);
  assert.ok(s.ctx.nodes.every(n => n.disconnected && n.stopped >= 1), 'future clicks stopped and disconnected');
  assert.equal(s.voice.getState().calibration, prior);
  assert.equal(s.voice.getState().calibrating, null);
 });
}

test('full calibration: Record armed after the noise step keeps the measured floor and cancels the timing step and its clicks', async () => {
 const s = await setup();
 const action = s.act({ type: 'calibrate-input', mode: 'full' });
 await sleep(15); s.ctx.currentTime += 3.01; await sleep(20);
 // Arming exactly as the floor arrives: the measurement completes first, then the take blocks timing.
 s.mic.noise.resolve!(-50);
 await s.until(() => s.voice.getState().calibration!.noiseSource === 'measured');
 s.emit({ type: 'transport', transport: idle({ recordingState: 'armed', recordingEpoch: 1 }) });
 await s.until(() => s.acks(action.id).length === 2);
 assert.equal(s.acks(action.id)[1], 'cancelled');
 assert.equal(s.voice.getState().calibration!.noiseFloorDb, -50, 'the completed noise step stays applied');
 assert.equal(s.voice.getState().calibration!.latencySource, 'default', 'timing untouched');
 assert.ok(s.ctx.nodes.every(n => n.disconnected), 'timing clicks stopped and disconnected');
});

test('full calibration: a late noise result after Play is discarded and the timing step is never reached', async () => {
 const s = await setup();
 const prior = s.voice.getState().calibration!;
 const action = s.act({ type: 'calibrate-input', mode: 'full' });
 await sleep(15); s.ctx.currentTime += 3.01; await sleep(20);
 s.emit({ type: 'transport', transport: idle({ playing: true }) });
 s.mic.noise.resolve!(-43); // late callback after cancellation
 await s.until(() => s.acks(action.id).length === 2);
 assert.equal(s.acks(action.id)[1], 'cancelled');
 assert.equal(s.voice.getState().calibration, prior);
 assert.equal(s.ctx.nodes.length, 0, 'timing clicks were never scheduled');
});

test('screen controls are locked while an agent action runs and a screen start is refused without touching it', async () => {
 const s = await setup();
 const action = s.act({ type: 'calibrate-input', mode: 'noise' });
 await sleep(15);
 assert.equal(s.voice.getState().inputActionRunning, true, 'the Input inspector disables Measure silence and calibration');
 const manual = await s.voice.calibrateLatency();
 assert.equal(manual.status, 'rejected');
 assert.match(manual.text, /agent is changing input settings/);
 assert.equal(s.voice.getBrowserStatus()!.activeAction?.phase, 'countdown', 'agent run continues');
 s.voice.cancelBrowserActions('Agent disconnected');
 await s.until(() => s.acks(action.id).length === 2);
 assert.equal(s.voice.getState().inputActionRunning, false);
 // With the agent gone the screen path works again and the agent flag did not leak into it.
 const again = s.voice.calibrateNoise(3);
 await sleep(15);
 s.voice.cancelBrowserActions('Agent disconnected');
 await sleep(10);
 assert.equal(s.voice.getState().silenceRun?.phase, 'countdown', 'screen run is not agent-owned');
 s.voice.cancelCalibration(); await again;
});

test('a screen timing calibration is also cancelled when a take is armed', async () => {
 const s = await setup();
 const prior = s.voice.getState().calibration!;
 const run = s.voice.calibrateLatency();
 await sleep(15);
 s.emit({ type: 'transport', transport: idle({ recordingState: 'armed', recordingEpoch: 1 }) });
 const outcome = await run;
 assert.equal(outcome.status, 'cancelled');
 assert.equal(s.voice.getState().calibration, prior);
 assert.ok(s.ctx.nodes.every(n => n.disconnected));
});
