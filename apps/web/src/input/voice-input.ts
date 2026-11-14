import type { ClientMessage, ServerMessage, SessionCommand, Transport } from '@voicesynth/contracts';
import { defaultCalibration, estimateLatency, type InputCalibration } from './calibration.ts';
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
 private unsubscribe: () => void;

 constructor(private engine: EngineLike, mode: VerificationMode = 'manual') {
  this.recorder = new PerformanceRecorder({ dispatch: c => engine.dispatch(c), newId: () => crypto.randomUUID() }, mode);
  this.state = { microphone: 'off', levelDb: -120, calibration: null, calibrating: null, recorder: this.recorder.status(), analysisP95Ms: null, message: null };
  this.recorder.onChange = recorder => this.update({ recorder });
  this.unsubscribe = engine.subscribe(message => {
   if (message.type === 'transport') {
    const was = this.transport?.recordingState;
    this.transport = message.transport;
    // When a take closes, finish the note being sung so it is kept (clamped to the cut-off).
    if (was === 'recording' && message.transport.recordingState !== 'recording') this.mic?.flush(message.transport.currentFrame + (this.state.calibration?.latencyFrames ?? 0));
   }
   this.recorder.handle(message);
  });
 }

 getState() { return this.state; }
 private update(patch: Partial<VoiceInputState>) { this.state = { ...this.state, ...patch }; this.onChange(this.state); }

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
   this.update({ microphone: kind, calibration });
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
   const { latencyFrames } = this.state.calibration, clock = this.transport.clockId;
   if (frame.notes.length) this.recorder.addNotes(frame.notes, latencyFrames, clock, frame.analysedThrough);
   this.recorder.addOnsets(frame.onsets, latencyFrames, clock, frame.analysedThrough);
  }
  const sorted = [...this.timings].sort((a, b) => a - b);
  this.update({ levelDb: frame.levelDb, analysisP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null });
 }

 async calibrateNoise() {
  if (!this.mic || !this.state.calibration) throw new Error('Enable the microphone first');
  this.update({ calibrating: 'noise', message: 'Stay quiet for two seconds…' });
  try {
   const noiseFloorDb = await this.mic.measureNoiseFloor(1.5);
   const calibration = { ...this.state.calibration, noiseFloorDb };
   this.mic.configure(noiseFloorDb); saveCalibration(calibration);
   this.update({ calibration, message: `Noise floor ${noiseFloorDb.toFixed(1)} dBFS` });
  } catch (error) { this.update({ message: String(error) }); }
  finally { this.update({ calibrating: null }); }
 }

 /** Tap or say “t” along with eight clicks; measures the full round trip the performer experiences. */
 async calibrateLatency(clicks = 8, interval = 0.5) {
  const context = this.context();
  if (!this.mic || !this.state.calibration) throw new Error('Enable the microphone first');
  if (this.transport?.playing) throw new Error('Stop playback before calibrating latency');
  this.update({ calibrating: 'latency', message: 'Tap along with the eight clicks…' });
  this.collector = [];
  const start = context.currentTime + 1;
  const clickFrames: number[] = [];
  for (let i = 0; i < clicks; i++) {
   const when = start + i * interval;
   const osc = context.createOscillator(), gain = context.createGain();
   osc.frequency.value = i % 4 ? 1000 : 1500;
   gain.gain.setValueAtTime(0.0001, when); gain.gain.exponentialRampToValueAtTime(0.5, when + 0.002); gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
   osc.connect(gain).connect(context.destination); osc.start(when); osc.stop(when + 0.06);
   clickFrames.push(Math.round(when * context.sampleRate));
  }
  await new Promise(resolve => setTimeout(resolve, (1 + clicks * interval + 0.6) * 1000));
  const onsets = this.collector; this.collector = null;
  try {
   const estimate = estimateLatency(clickFrames, onsets, { sampleRate: context.sampleRate });
   const calibration: InputCalibration = { ...this.state.calibration, latencyFrames: estimate.latencyFrames, latencySpreadFrames: estimate.spreadFrames, latencySource: 'tap-along' };
   saveCalibration(calibration);
   this.update({ calibration, message: `Latency ${(estimate.latencyFrames / context.sampleRate * 1000).toFixed(0)} ms (±${(estimate.spreadFrames / context.sampleRate * 1000).toFixed(0)} ms, ${estimate.matched}/${clicks} taps)` });
  } catch (error) { this.update({ message: String(error instanceof Error ? error.message : error) }); }
  finally { this.update({ calibrating: null }); }
 }

 /** Diagnostic override, e.g. when the test signal path has zero round-trip latency. */
 setLatencyFrames(latencyFrames: number) { if (this.state.calibration) this.update({ calibration: { ...this.state.calibration, latencyFrames } }); }

 stopMicrophone() { this.mic?.stop(); this.update({ microphone: 'off', levelDb: -120 }); }
 dispose() { this.unsubscribe(); this.mic?.dispose(); this.mic = null; }
}
