import type { ClientMessage, ServerMessage, SessionCommand, Transport } from '@voicesynth/contracts';
import { calibrationProgress, calibrationStatus, clickPlan, defaultCalibration, effectiveLatencyFrames, estimateLatency, timingCheck, type CalibrationProgress, type CalibrationStatus, type ClickPlan, type InputCalibration } from './calibration.ts';
import { MicCheck, type MicCheckState } from './mic-check.ts';
import { buildMicTestReport, type CaptureSettings, type MicTestReport } from './diagnostics.ts';
import { MicrophoneInput, type AnalysisFrame } from './microphone.ts';
import { handleSpeechMessage } from './speech-messages.ts';
import { PerformanceRecorder, type RecorderStatus, type VerificationMode } from './recorder.ts';
import { loadCalibration, saveCalibration } from '../persistence/calibration-store.ts';

export interface EngineLike {
 getAudioContext(): AudioContext | null;
 subscribe(listener: (message: ClientMessage) => void): () => void;
 dispatch(command: SessionCommand): ClientMessage;
}
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
 /** Outcome of the last timing calibration (kept until the next run). */
 calibrationResult: { ok: boolean; text: string; latencyMs?: number; spreadMs?: number; matched?: number; of?: number; suggestTrimMs?: number } | null;
}

/** Owns the microphone → onset → verified performance path for one engine AudioContext. */
export class VoiceInput {
 onChange: (state: VoiceInputState) => void = () => {};
 readonly recorder: PerformanceRecorder;
 private mic: MicrophoneInput | null = null;
 private transport: Transport | null = null;
 private state: VoiceInputState;
 private timings: number[] = [];
 private collector: number[] | null = null;
 private check: MicCheck | null = null;
 private lastUiUpdate = 0;
 private run: { plan: ClickPlan; nodes: OscillatorNode[]; timer: ReturnType<typeof setInterval>; finish: (cancelled: boolean) => void } | null = null;
 private unsubscribe: () => void;

 constructor(private engine: EngineLike, mode: VerificationMode = 'manual') {
  this.recorder = new PerformanceRecorder({ dispatch: c => engine.dispatch(c), newId: () => crypto.randomUUID() }, mode);
  this.state = { microphone: 'off', levelDb: -120, calibration: null, calibrating: null, recorder: this.recorder.status(), analysisP95Ms: null, message: null, micCheck: null, capture: null, readiness: calibrationStatus(null), calibrationRun: null, calibrationResult: null };
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
  handleSpeechMessage(this.recorder,message);
 }
 setSpeechAvailable(available: boolean) { this.recorder.setSpeechAvailable(available); }

 private context() {
  const context = this.engine.getAudioContext();
  if (!context) throw new Error('Enable audio first');
  return context;
 }

 private async connect(start: (mic: MicrophoneInput) => Promise<void>, kind: 'on' | 'test-signal') {
  const context = this.context();
  this.update({ microphone: 'starting', message: null });
  try {
   this.mic ??= new MicrophoneInput(context);
   this.mic.onAnalysis = frame => this.onAnalysis(frame);
   this.mic.onError = error => this.update({ message: error.message, ...(error.message.includes('disconnected') ? { microphone: 'off' as const } : {}) });
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

 async calibrateNoise() {
  if (!this.mic || !this.state.calibration) throw new Error('Enable the microphone first');
  this.update({ calibrating: 'noise', message: 'Stay quiet for two seconds…' });
  try {
   const noiseFloorDb = await this.mic.measureNoiseFloor(1.5);
   const calibration: InputCalibration = { ...this.state.calibration, noiseFloorDb, noiseSource: 'measured' };
   this.mic.configure(noiseFloorDb); saveCalibration(calibration);
   this.check?.reset();
   this.update({ calibration, message: `Noise floor ${noiseFloorDb.toFixed(1)} dBFS${noiseFloorDb > -45 ? ' (noisy room: quiet hits may be missed)' : ''}` });
  } catch (error) { this.update({ message: String(error) }); }
  finally { this.update({ calibrating: null }); }
 }

 /**
  * Guided timing calibration: a visible 3-second countdown, 4 practice clicks (not scored), then 8
  * measured clicks, with progress and Cancel. The performer taps or says "t" with each click; this
  * measures the full round trip they experience. A failed or cancelled run keeps the previous
  * valid calibration.
  */
 async calibrateLatency(options: { countdown?: number; practice?: number; measured?: number; interval?: number; verify?: boolean } = {}) {
  const context = this.context();
  const blocked = !this.mic || !this.state.calibration ? 'Enable the microphone first.' : this.transport?.playing ? 'Stop playback before calibrating timing.' : this.run ? 'Calibration is already running.' : null;
  if (blocked) { this.update({ calibrationResult: { ok: false, text: blocked } }); return; }
  if (!this.mic || !this.state.calibration) return;
  const plan = clickPlan(context.currentTime + 0.05, options);
  const nodes: OscillatorNode[] = [];
  plan.all.forEach((when, i) => {
   const practice = i < plan.practice.length;
   const osc = context.createOscillator(), gain = context.createGain();
   osc.frequency.value = practice ? 800 : (i - plan.practice.length) % 4 ? 1000 : 1500;
   gain.gain.setValueAtTime(0.0001, when); gain.gain.exponentialRampToValueAtTime(0.5, when + 0.002); gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
   osc.connect(gain).connect(context.destination); osc.start(when); osc.stop(when + 0.06);
   nodes.push(osc);
  });
  this.collector = [];
  const previous = this.state.calibration;
  this.update({ calibrating: 'latency', calibrationRun: calibrationProgress(plan, context.currentTime), message: null });
  const cancelled = await new Promise<boolean>(resolve => {
   const timer = setInterval(() => {
    const progress = calibrationProgress(plan, context.currentTime);
    this.update({ calibrationRun: progress });
    if (context.currentTime >= plan.end + 0.4) resolve(false);
   }, 100);
   this.run = { plan, nodes, timer, finish: resolve };
  });
  const run = this.run!; this.run = null; clearInterval(run.timer);
  const onsets = this.collector ?? []; this.collector = null;
  if (cancelled) {
   for (const n of run.nodes) { try { n.stop(); } catch { /* already stopped */ } }
   this.update({ calibrating: null, calibrationRun: null, calibration: previous, calibrationResult: { ok: false, text: 'Calibration cancelled; the previous timing was kept.' } });
   return;
  }
  const sr = context.sampleRate;
  try {
   const estimate = estimateLatency(plan.measured.map(t => Math.round(t * sr)), onsets, { sampleRate: sr });
   if (options.verify) {
    // Tap test against the current settings: report the residual, keep the calibration.
    const check = timingCheck(estimate.latencyFrames, previous);
    this.update({ calibration: previous, calibrationResult: { ok: check.verdict === 'on-time', text: `${check.text} (${estimate.matched}/${plan.measured.length} taps matched)`, ...(check.verdict === 'on-time' ? {} : { suggestTrimMs: check.suggestedTrimMs }) } });
    return;
   }
   const calibration: InputCalibration = { ...previous, latencyFrames: estimate.latencyFrames, latencySpreadFrames: estimate.spreadFrames, latencySource: 'tap-along' };
   saveCalibration(calibration);
   const latencyMs = estimate.latencyFrames / sr * 1000, spreadMs = estimate.spreadFrames / sr * 1000;
   this.update({ calibration, calibrationResult: { ok: true, latencyMs, spreadMs, matched: estimate.matched, of: plan.measured.length,
    text: `Offset ${latencyMs.toFixed(0)} ms, consistency ±${spreadMs.toFixed(0)} ms, ${estimate.matched}/${plan.measured.length} taps matched` } });
  } catch (error) {
   this.update({ calibration: previous, calibrationResult: { ok: false, text: `${error instanceof Error ? error.message : String(error)}. The previous timing was kept.` } });
  } finally { this.update({ calibrating: null, calibrationRun: null }); }
 }

 /** Stops a running timing calibration; the previous calibration stays in effect. */
 cancelCalibration() { this.run?.finish(true); }

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

 stopMicrophone() { this.mic?.stop(); this.update({ microphone: 'off', levelDb: -120 }); }
 dispose() { this.unsubscribe(); this.mic?.dispose(); this.mic = null; }
}
