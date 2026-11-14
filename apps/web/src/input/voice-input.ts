import type { ClientMessage, ServerMessage, SessionCommand, Transport } from '@voicesynth/contracts';
import { calibrationProgress, calibrationStatus, clickPlan, defaultCalibration, effectiveLatencyFrames, estimateLatency, timingCheck, type CalibrationProgress, type CalibrationStatus, type InputCalibration } from './calibration.ts';
import { MicCheck, type MicCheckState } from './mic-check.ts';
import { buildMicTestReport, type CaptureSettings, type MicTestReport } from './diagnostics.ts';
import type { AnalysisFrame } from './microphone.ts';
import { handleSpeechMessage } from './speech-messages.ts';
import { PerformanceRecorder, type RecorderStatus, type VerificationMode } from './recorder.ts';
import { TimedRun, type RunTimers } from './timed-run.ts';
import { loadCalibration, saveCalibration } from '../persistence/calibration-store.ts';

export interface EngineLike {
 getAudioContext(): AudioContext | null;
 subscribe(listener: (message: ClientMessage) => void): () => void;
 dispatch(command: SessionCommand): ClientMessage;
}
/** The parts of MicrophoneInput this class uses (injectable so lifecycle tests run in Node). */
export interface MicLike {
 onAnalysis: (frame: AnalysisFrame) => void;
 onError: (error: Error) => void;
 inputLatencySeconds: number;
 deviceId: string | null;
 captureSettings: CaptureSettings | null;
 startMicrophone(deviceId?: string): Promise<void>;
 startTestSignal(buffer: AudioBuffer, when: number): Promise<void>;
 configure(noiseFloorDb: number, sensitivity?: number): void;
 measureNoiseFloor(seconds?: number): Promise<number>;
 flush(frame: number): void;
 stop(): void;
 dispose(): void;
}
export interface VoiceInputOptions {
 createMic?: (context: AudioContext) => MicLike | Promise<MicLike>;
 timers?: RunTimers;
 tickMs?: number;
}
/** Silence measurement: a quiet preparation countdown, then the measurement itself (no clicks). */
export type SilenceProgress = { phase: 'countdown'; countdownLeft: number } | { phase: 'measuring' };
export interface VoiceInputState {
 microphone: 'off' | 'starting' | 'on' | 'test-signal';
 levelDb: number;
 calibration: InputCalibration | null;
 calibrating: 'noise' | 'latency' | null;
 recorder: RecorderStatus;
 analysisP95Ms: number | null;
 message: string | null;
 /** Live level/detection check for real-microphone testing. */
 micCheck: MicCheckState | null;
 /** What the browser granted for the capture track; null for test signals. */
 capture: CaptureSettings | null;
 readiness: CalibrationStatus;
 /** A guided timing calibration in progress, for the countdown/progress display. */
 calibrationRun: CalibrationProgress | null;
 /** A guided silence measurement in progress. */
 silenceRun: SilenceProgress | null;
 /** Outcome of the last calibration step (kept until the next run). */
 calibrationResult: { ok: boolean; text: string; latencyMs?: number; spreadMs?: number; matched?: number; of?: number; suggestTrimMs?: number } | null;
}

const SILENCE_COUNTDOWN = 3, SILENCE_SECONDS = 1.5;

/** Owns the microphone → onset → verified performance path for one engine AudioContext. */
export class VoiceInput {
 onChange: (state: VoiceInputState) => void = () => {};
 readonly recorder: PerformanceRecorder;
 private mic: MicLike | null = null;
 private transport: Transport | null = null;
 private state: VoiceInputState;
 private timings: number[] = [];
 private collector: number[] | null = null;
 private check: MicCheck | null = null;
 private lastUiUpdate = 0;
 /** The one guided run (timing or silence) that may be active. */
 private run: TimedRun | null = null;
 private unsubscribe: () => void;
 private createMic: (context: AudioContext) => MicLike | Promise<MicLike>;

 constructor(private engine: EngineLike, mode: VerificationMode = 'manual', private options: VoiceInputOptions = {}) {
  this.createMic = options.createMic ?? (async context => new (await import('./microphone.ts')).MicrophoneInput(context));
  this.recorder = new PerformanceRecorder({ dispatch: c => engine.dispatch(c), newId: () => crypto.randomUUID() }, mode);
  this.state = { microphone: 'off', levelDb: -120, calibration: null, calibrating: null, recorder: this.recorder.status(), analysisP95Ms: null, message: null, micCheck: null, capture: null, readiness: calibrationStatus(null), calibrationRun: null, silenceRun: null, calibrationResult: null };
  this.recorder.onChange = recorder => this.update({ recorder });
  this.unsubscribe = engine.subscribe(message => {
   if (message.type === 'transport') {
    const was = this.transport?.recordingState;
    this.transport = message.transport;
    // When a take closes, finish the note being sung so it is kept (clamped to the cut-off).
    if (was === 'recording' && message.transport.recordingState !== 'recording') this.mic?.flush(message.transport.currentFrame + (this.state.calibration ? effectiveLatencyFrames(this.state.calibration) : 0));
   }
   this.recorder.handle(message);
  });
 }

 getState() { return this.state; }
 private update(patch: Partial<VoiceInputState>) {
  this.state = { ...this.state, ...patch };
  if ('calibration' in patch) this.state.readiness = calibrationStatus(this.state.calibration);
  this.onChange(this.state);
 }

 /** Server messages from the agent coordinator; command spans exclude speech from takes. */
 handleServerMessage(message: ServerMessage) {
  handleSpeechMessage(this.recorder, message);
 }
 setSpeechAvailable(available: boolean) { this.recorder.setSpeechAvailable(available); }

 private context() {
  const context = this.engine.getAudioContext();
  if (!context) throw new Error('Enable audio first');
  return context;
 }

 private async connect(start: (mic: MicLike) => Promise<void>, kind: 'on' | 'test-signal') {
  const context = this.context();
  // A different stream or device would invalidate a measurement in progress.
  this.cancelCalibration();
  this.update({ microphone: 'starting', message: null });
  try {
   this.mic ??= await this.createMic(context);
   this.mic.onAnalysis = frame => this.onAnalysis(frame);
   this.mic.onError = error => {
    const disconnected = error.message.includes('disconnected');
    if (disconnected) this.cancelCalibration();
    this.update({ message: error.message, ...(disconnected ? { microphone: 'off' as const } : {}) });
   };
   await start(this.mic);
   const calibration = (kind === 'on' ? loadCalibration(this.mic.deviceId) : null) ?? defaultCalibration(context, this.mic.inputLatencySeconds, this.mic.deviceId);
   this.mic.configure(calibration.noiseFloorDb);
   this.check = new MicCheck(context.sampleRate);
   this.update({ microphone: kind, calibration, capture: this.mic.captureSettings, micCheck: null });
  } catch (error) {
   this.update({ microphone: 'off', message: error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in the address bar, then try again.' : String(error) });
   throw error;
  }
 }

 enableMicrophone(deviceId?: string) { return this.connect(mic => mic.startMicrophone(deviceId), 'on'); }
 /** Diagnostic: feed a known buffer through the identical analysis path. */
 enableTestSignal(buffer: AudioBuffer, when: number) { return this.connect(mic => mic.startTestSignal(buffer, when), 'test-signal'); }

 private onAnalysis(frame: AnalysisFrame) {
  this.timings.push(frame.analysisMs); if (this.timings.length > 400) this.timings.shift();
  if (this.collector) { this.collector.push(...frame.onsets.map(o => o.frame)); }
  else if (this.transport && this.state.calibration) {
   const latencyFrames = effectiveLatencyFrames(this.state.calibration), clock = this.transport.clockId;
   if (frame.notes.length) this.recorder.addNotes(frame.notes, latencyFrames, clock, frame.analysedThrough);
   this.recorder.addOnsets(frame.onsets, latencyFrames, clock, frame.analysedThrough);
  }
  this.check?.add(frame);
  // Analysis frames arrive ~43 times a second; the UI only needs ~10 updates a second.
  const now = performance.now();
  if (now - this.lastUiUpdate < 100) return;
  this.lastUiUpdate = now;
  const sorted = [...this.timings].sort((a, b) => a - b);
  this.update({ levelDb: frame.levelDb, analysisP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null, micCheck: this.check?.state(this.state.calibration?.noiseFloorDb ?? -60) ?? null });
 }

 private startRun(context: AudioContext, endAt: number, onTick: () => void) {
  const run = new TimedRun({ now: () => context.currentTime, closed: () => context.state === 'closed' }, endAt, onTick, this.options.tickMs ?? 100, this.options.timers);
  this.run = run;
  run.onEnd(() => { if (this.run === run) this.run = null; });
  return run;
 }

 /**
  * Guided silence measurement: a visible preparation countdown ("stay quiet"), then 1.5 s of
  * measurement. Cancel (or losing the mic) keeps the previous noise floor. No clicks are played.
  */
 async calibrateNoise(countdown = SILENCE_COUNTDOWN) {
  const context = this.context();
  const blocked = !this.mic || !this.state.calibration ? 'Enable the microphone first.' : this.run ? 'A calibration is already running.' : null;
  if (blocked) { this.update({ calibrationResult: { ok: false, text: blocked } }); return; }
  const mic = this.mic!, previous = this.state.calibration!;
  // Nothing writes the calibration until a run succeeds, so "keeping" it means leaving it untouched
  // (restoring a snapshot could undo a trim made meanwhile, or apply one device's values to another).
  const keep = (text: string) => this.update({ calibrationResult: { ok: false, text } });
  this.update({ calibrating: 'noise', silenceRun: { phase: 'countdown', countdownLeft: countdown }, calibrationResult: null, message: null });
  try {
   const prepEnd = context.currentTime + countdown;
   const prep = this.startRun(context, prepEnd, () => this.update({ silenceRun: { phase: 'countdown', countdownLeft: Math.max(1, Math.min(countdown, Math.ceil(prepEnd - context.currentTime))) } }));
   if (await prep.settled === 'cancelled') { keep('Silence measurement cancelled; the previous noise floor was kept.'); return; }
   this.update({ silenceRun: { phase: 'measuring' } });
   // The measurement promise cannot be aborted, so a parallel run lets Cancel win the race.
   const measuring = this.startRun(context, Number.POSITIVE_INFINITY, () => {});
   const outcome = await Promise.race([mic.measureNoiseFloor(SILENCE_SECONDS).then(db => ({ db }), (error: unknown) => ({ error })), measuring.settled.then(() => null)]);
   const cancelled = !measuring.active; measuring.cancel();
   if (cancelled || outcome === null) { keep('Silence measurement cancelled; the previous noise floor was kept.'); return; }
   if ('error' in outcome) { keep(`${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}. The previous noise floor was kept.`); return; }
   const calibration: InputCalibration = { ...(this.state.calibration ?? previous), noiseFloorDb: outcome.db, noiseSource: 'measured' };
   mic.configure(outcome.db); saveCalibration(calibration);
   this.check?.reset();
   this.update({ calibration, calibrationResult: { ok: true, text: `Noise floor ${outcome.db.toFixed(1)} dBFS${outcome.db > -45 ? ' (noisy room: quiet hits may be missed)' : ''}` } });
  } finally { this.update({ calibrating: null, silenceRun: null }); }
 }

 /**
  * Guided timing calibration: a visible 3-second countdown, 4 practice clicks (not scored), then 8
  * measured clicks, with progress and Cancel. The performer taps or says "t" with each click; this
  * measures the full round trip they experience. A failed or cancelled run (including stopping or
  * losing the microphone, changing device, disposing, or the AudioContext closing) keeps the
  * previous valid calibration and stops any scheduled clicks.
  */
 async calibrateLatency(options: { countdown?: number; practice?: number; measured?: number; interval?: number; verify?: boolean } = {}) {
  const context = this.context();
  const blocked = !this.mic || !this.state.calibration ? 'Enable the microphone first.' : this.transport?.playing ? 'Stop playback before calibrating timing.' : this.run ? 'A calibration is already running.' : null;
  if (blocked) { this.update({ calibrationResult: { ok: false, text: blocked } }); return; }
  const previous = this.state.calibration!;
  const plan = clickPlan(context.currentTime + 0.05, options);
  const run = this.startRun(context, plan.end + 0.4, () => this.update({ calibrationRun: calibrationProgress(plan, context.currentTime) }));
  plan.all.forEach((when, i) => {
   const practice = i < plan.practice.length;
   const osc = context.createOscillator(), gain = context.createGain();
   osc.frequency.value = practice ? 800 : (i - plan.practice.length) % 4 ? 1000 : 1500;
   gain.gain.setValueAtTime(0.0001, when); gain.gain.exponentialRampToValueAtTime(0.5, when + 0.002); gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
   osc.connect(gain).connect(context.destination); osc.start(when); osc.stop(when + 0.06);
   run.onEnd(() => { if (context.state !== 'closed' && context.currentTime < when + 0.06) { try { osc.stop(); } catch { /* already stopped */ } } osc.disconnect(); gain.disconnect(); });
  });
  this.collector = [];
  this.update({ calibrating: 'latency', calibrationRun: calibrationProgress(plan, context.currentTime), calibrationResult: null, message: null });
  const outcome = await run.settled;
  const onsets = this.collector ?? []; this.collector = null;
  try {
   if (outcome === 'cancelled') {
    this.update({ calibrationResult: { ok: false, text: 'Calibration cancelled; the previous timing was kept.' } });
    return;
   }
   const sr = context.sampleRate;
   const estimate = estimateLatency(plan.measured.map(t => Math.round(t * sr)), onsets, { sampleRate: sr });
   if (options.verify) {
    // Tap test against the current settings: report the residual, keep the calibration.
    const check = timingCheck(estimate.latencyFrames, previous);
    this.update({ calibrationResult: { ok: check.verdict === 'on-time', text: `${check.text} (${estimate.matched}/${plan.measured.length} taps matched)`, ...(check.verdict === 'on-time' ? {} : { suggestTrimMs: check.suggestedTrimMs }) } });
    return;
   }
   const calibration: InputCalibration = { ...(this.state.calibration ?? previous), latencyFrames: estimate.latencyFrames, latencySpreadFrames: estimate.spreadFrames, latencySource: 'tap-along' };
   saveCalibration(calibration);
   const latencyMs = estimate.latencyFrames / sr * 1000, spreadMs = estimate.spreadFrames / sr * 1000;
   this.update({ calibration, calibrationResult: { ok: true, latencyMs, spreadMs, matched: estimate.matched, of: plan.measured.length,
    text: `Offset ${latencyMs.toFixed(0)} ms, consistency ±${spreadMs.toFixed(0)} ms, ${estimate.matched}/${plan.measured.length} taps matched` } });
  } catch (error) {
   this.update({ calibrationResult: { ok: false, text: `${error instanceof Error ? error.message : String(error)}. The previous timing was kept.` } });
  } finally { this.update({ calibrating: null, calibrationRun: null }); }
 }

 /** Stops a running timing calibration or silence measurement; previous settings stay in effect. */
 cancelCalibration() { this.run?.cancel(); }

 /** Per-device manual recording-offset trim (ms), persisted with the calibration. */
 setOffsetAdjust(ms: number) {
  if (!this.state.calibration) return;
  const calibration: InputCalibration = { ...this.state.calibration, offsetAdjustMs: Math.max(-150, Math.min(150, Math.round(ms))) };
  if (calibration.deviceId !== 'test-signal') saveCalibration(calibration);
  this.update({ calibration });
 }

 /** Diagnostic override, e.g. when the test signal path has zero round-trip latency. */
 setLatencyFrames(latencyFrames: number) { if (this.state.calibration) this.update({ calibration: { ...this.state.calibration, latencyFrames } }); }

 /** Opt-in, measurements-only report for posting microphone test results (no audio, no device IDs). */
 testReport(): MicTestReport {
  const context = this.context();
  return buildMicTestReport({
   browser: navigator.userAgent, context, capture: this.state.capture ?? {}, calibration: this.state.calibration,
   micCheck: this.check?.state(this.state.calibration?.noiseFloorDb ?? -60) ?? new MicCheck(context.sampleRate).state(-60),
   recorder: this.recorder.status(), analysisP95Ms: this.state.analysisP95Ms,
  });
 }

 stopMicrophone() { this.cancelCalibration(); this.mic?.stop(); this.update({ microphone: 'off', levelDb: -120 }); }
 dispose() { this.cancelCalibration(); this.unsubscribe(); this.mic?.dispose(); this.mic = null; }
}
