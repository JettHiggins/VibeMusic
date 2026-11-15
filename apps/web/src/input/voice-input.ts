import type { BrowserAction, BrowserActionAck, BrowserActionAdapter, BrowserStatus, ClientMessage, ServerMessage, SessionCommand, Transport } from '@voicesynth/contracts';
import { calibrationProgress, calibrationStatus, clickPlan, defaultCalibration, effectiveLatencyFrames, estimateLatency, timingCheck, type CalibrationProgress, type CalibrationStatus, type InputCalibration } from './calibration.ts';
import { MicCheck, type MicCheckState } from './mic-check.ts';
import { buildMicTestReport, type CaptureSettings, type MicTestReport } from './diagnostics.ts';
import type { AnalysisFrame } from './microphone.ts';
import type { ProcessingProfile } from './processing-profile.ts';
import { SpeechSession, SPEECH_PENDING_SECONDS } from './speech-session.ts';
import type { SpeechResult } from './speech-worker.ts';
import { handleSpeechMessage } from './speech-messages.ts';
import { PerformanceRecorder, type RecorderStatus, type VerificationMode } from './recorder.ts';
import { TimedRun, type RunTimers } from './timed-run.ts';
import { loadCalibration, saveCalibration } from '../persistence/calibration-store.ts';

export interface EngineLike {
 getAudioContext(): AudioContext | null;
 getSession?(): {revision:number};
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
 startMicrophone(deviceId?: string, profile?: ProcessingProfile): Promise<void>;
 startTestSignal(buffer: AudioBuffer, when: number): Promise<void>;
 configure(noiseFloorDb: number, sensitivity?: number): void;
 measureNoiseFloor(seconds?: number): Promise<number>;
 flush(frame: number): void;
 reset(frame: number): void;
 startSpeech?(config:{streamId:string;clockId:string;latencyFrames:number},onResult:(result:SpeechResult)=>void):void;
 stopSpeech?():void;
 stop(): void;
 dispose(): void;
}
export interface VoiceInputOptions {
 createMic?: (context: AudioContext) => MicLike | Promise<MicLike>;
 timers?: RunTimers;
 tickMs?: number;
 /** How long an agent input action waits for restarted speech to report ready (default 8 s). */
 speechResumeMs?: number;
}
/** How a guided calibration ended. Only `complete` means new measurements were applied (or, for a check, measured). */
export interface CalibrationOutcome { status: 'complete' | 'cancelled' | 'rejected'; text: string }
type InputActionKind = NonNullable<BrowserStatus['activeAction']>['kind'];
type InputActionPhase = NonNullable<BrowserStatus['activeAction']>['phase'];
interface AgentInputAction { id: string; kind: InputActionKind; phase: InputActionPhase; cancelled: boolean; done: Promise<void>; runs: Set<TimedRun> }
const MAX_ACTION_RECORDS = 4096;
type MutatingInputOperation = Exclude<BrowserAction['operation'], { type: 'cancel-input-action' }>;
/** Silence measurement: a quiet preparation countdown, then the measurement itself (no clicks). */
export type SilenceProgress = { phase: 'countdown'; countdownLeft: number } | { phase: 'measuring' };
export interface VoiceInputState {
 speech: {enabled:boolean;status:'off'|'waiting'|'ready'|'unavailable';message:string|null};
 microphone: 'off' | 'starting' | 'on' | 'test-signal';
 processingProfile: ProcessingProfile;
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
 /** An agent-requested input action is running; screen calibration and input controls wait for it. */
 inputActionRunning: boolean;
}

const SILENCE_COUNTDOWN = 3, SILENCE_SECONDS = 1.5;

/** Owns the microphone → onset → verified performance path for one engine AudioContext. */
export class VoiceInput implements BrowserActionAdapter {
 onChange: (state: VoiceInputState) => void = () => {};
 readonly recorder: PerformanceRecorder;
 onBeforeLiveEdit: (operation: SessionCommand['operation']) => void = () => {};
 private mic: MicLike | null = null;
 private transport: Transport | null = null;
 private state: VoiceInputState;
 private timings: number[] = [];
 private collector: number[] | null = null;
 private check: MicCheck | null = null;
 private lastUiUpdate = 0;
 private speechSession:SpeechSession|null=null;
 private speechConnected=false;
 private resetSpeechConnection:()=>void=()=>{};
 private connectSpeechConnection:()=>Promise<void>=async()=>{throw new Error('Connect the local agent first');};
 private speechConnecting=false;
 private speechSend:((message:ClientMessage)=>void)|null=null;
 private heldCaptureStart: number | null = null;
 /** The one guided run (timing or silence) that may be active. */
 private run: TimedRun | null = null;
 private unsubscribe: () => void;
 private createMic: (context: AudioContext) => MicLike | Promise<MicLike>;
 // Browser-action executor (agent-owned input work). See docs/MUSICAL-CONTROL-CONTRACT.md.
 private inputRevision = 0;
 private inputClock: string | null = null;
 private agentAction: AgentInputAction | null = null;
 private actionRecords = new Map<string, { payload: string; last: BrowserActionAck }>();
 private actionListeners = new Set<(message: BrowserStatus | BrowserActionAck) => void>();
 private lastEmittedStatus: string | null = null;
 /** Set while an agent action has ended the speech stream; it is restarted on the same socket afterwards. */
 private speechPaused = false;
 /** Set only by the executor for the calibration call it is about to make, so that run is owned by the agent action. */
 private agentStartingRun = false;
 /** Why the active run was cancelled, when something other than the user's Cancel ended it. */
 private runCancelReason: string | null = null;

 constructor(private engine: EngineLike, mode: VerificationMode = 'manual', private options: VoiceInputOptions = {}) {
  this.createMic = options.createMic ?? (async context => new (await import('./microphone.ts')).MicrophoneInput(context));
  this.recorder = new PerformanceRecorder({ dispatch: c => engine.dispatch(c), newId: () => crypto.randomUUID() }, mode);
  this.state = { speech:{enabled:false,status:'off',message:null}, microphone: 'off', processingProfile: 'noisy-room', levelDb: -120, calibration: null, calibrating: null, recorder: this.recorder.status(), analysisP95Ms: null, message: null, micCheck: null, capture: null, readiness: calibrationStatus(null), calibrationRun: null, silenceRun: null, calibrationResult: null, inputActionRunning: false };
  this.recorder.onChange = recorder => this.update({ recorder });
  this.unsubscribe = engine.subscribe(message => {
   if(message.type==='session')this.latestRevision=message.session.revision;
   if(message.type==='ack')this.latestRevision=Math.max(this.latestRevision,message.revision);
   if (message.type === 'transport') {
    if(this.transport&&this.transport.clockId!==message.transport.clockId)this.failSpeech('Audio clock changed; restart hands-free capture');
    if(this.inputClock!==message.transport.clockId){
     // A new audio clock starts a new input revision sequence; work bound to the old clock ends.
     if(this.inputClock!==null)this.cancelBrowserActions('Audio clock changed');
     this.inputClock=message.transport.clockId;this.inputRevision=0;this.lastEmittedStatus=null;
    }
    const was = this.transport?.recordingState;
    const epochChanged = message.transport.recordingEpoch !== undefined && message.transport.recordingEpoch !== this.transport?.recordingEpoch;
    this.transport = message.transport;
    if (epochChanged) this.heldCaptureStart = null;
    if (epochChanged) this.mic?.reset((message.transport.captureStartFrame ?? message.transport.recordingStartFrame ?? message.transport.currentFrame) + (this.state.calibration ? effectiveLatencyFrames(this.state.calibration) : 0));
    // When a take closes, finish the note being sung so it is kept (clamped to the cut-off).
    if (!epochChanged && was === 'recording' && message.transport.recordingState !== 'recording') this.mic?.flush(message.transport.currentFrame + (this.state.calibration ? effectiveLatencyFrames(this.state.calibration) : 0));
    this.revalidateRun();
    this.emitStatus();
   }
   this.recorder.handle(message);
  });
 }

 /** Applied to both UI actions and backend proposals before dispatch, preserving IDs. */
 prepareCommand(command: SessionCommand): SessionCommand {
  if (command.operation.type === 'clear' || command.operation.type === 'undo') this.onBeforeLiveEdit(command.operation);
  return command.operation.type === 'undo' && (this.recorder.hasPendingCapture || this.heldCaptureStart !== null)
   ? { ...command, operation: { type: 'undo', discardCaptureOnly: true } } : command;
 }

 getState() { return this.state; }
 private update(patch: Partial<VoiceInputState>) {
  if ('calibration' in patch && this.state.speech.enabled && !this.speechPaused) this.failSpeech('Calibration changed; restart hands-free capture');
  const before = this.configKey();
  this.state = { ...this.state, ...patch };
  if ('calibration' in patch) this.state.readiness = calibrationStatus(this.state.calibration);
  // Device/connection, profile and applied calibration/offset changes advance the input revision; progress does not.
  if (this.configKey() !== before) this.inputRevision++;
  this.onChange(this.state);
  this.emitStatus();
 }
 private configKey() {
  const c = this.state.calibration;
  return JSON.stringify([this.state.microphone, this.state.processingProfile, c?.deviceId, c?.noiseFloorDb, c?.noiseSource, c?.latencyFrames, c?.latencySource, c?.offsetAdjustMs]);
 }

 /** Server messages from the agent coordinator; command spans exclude speech from takes. */
 handleServerMessage(message: ServerMessage) {
  if(this.state.speech.enabled)this.speechSession?.handle(message);
  else if(message.type==='command-span')handleSpeechMessage(this.recorder,message);
 }
 /** Socket state never proves recognizer availability. */
 setSpeechAvailable(available: boolean) {this.speechConnected=available;if(!available)this.failSpeech('Agent disconnected; restart hands-free capture');}
 configureSpeechSender(send:(message:ClientMessage)=>void,resetConnection:()=>void,connect:()=>Promise<void>) {this.speechSend=send;this.resetSpeechConnection=resetConnection;this.connectSpeechConnection=connect;}
 private endSpeechTake() {
  const revision=this.engineSessionRevision();
  if(this.transport?.recording||this.transport?.recordingState==='armed')this.engine.dispatch({id:crypto.randomUUID(),expectedRevision:revision,boundary:'immediate',operation:{type:'stop-recording'}});
  if(this.transport?.recordingStartFrame!==undefined)this.engine.dispatch({id:crypto.randomUUID(),expectedRevision:revision,boundary:'immediate',operation:{type:'undo',discardCaptureOnly:true}});
 }
 private engineSessionRevision() {return this.engine.getSession?.().revision??this.latestRevision;}
 private latestRevision=0;
 private failSpeech(reason:string) {
  // A paused stream has already ended; the action that paused it restarts or reports speech afterwards.
  if(this.speechPaused||!this.state.speech.enabled||this.state.speech.status==='unavailable')return;
  // Keep notes speech had already verified (playtest: melodies vanished after a capture gap); only
  // unverified capture is discarded, by setSpeechAvailable(false).
  this.recorder.setSpeechAvailable(false);this.mic?.stopSpeech?.();this.speechSession=null;
  this.update({speech:{enabled:true,status:'unavailable',message:reason}});
  this.endSpeechTake();this.resetSpeechConnection();
 }
 async enableHandsFree() {
  if(this.speechConnecting)return;
  if(this.speechConnected){this.setHandsFree(true);return;}
  this.setHandsFree(true); // Immediately hold/discard old capture before waiting on a connection.
  this.update({speech:{enabled:true,status:'waiting',message:'Connecting local speech service…'}});
  this.speechConnecting=true;
  try{await this.connectSpeechConnection();if(this.state.speech.enabled)this.setHandsFree(true);}
  catch(error){this.failSpeech(String(error));}
  finally{this.speechConnecting=false;}
 }
 setHandsFree(enabled:boolean) {
  if(this.speechSession)this.failSpeech('Speech mode changed; reconnect for a fresh stream');
  this.mic?.stopSpeech?.();this.speechSession=null;this.recorder.setSpeechAvailable(false);this.recorder.resetPendingCapture();
  this.endSpeechTake();this.recorder.setMode(enabled?'speech':'manual');
  this.update({speech:{enabled,status:enabled?'waiting':'off',message:null}});
  if(!enabled)return;
  if(!this.speechConnected||!this.speechSend||!this.mic?.startSpeech||!this.transport||!this.state.calibration||!['on','test-signal'].includes(this.state.microphone)){this.failSpeech('Enable microphone and connect the local agent, then retry');return;}
  const streamId=crypto.randomUUID(),clockId=this.transport.clockId;
  const session=this.speechSession=new SpeechSession(streamId,clockId,{
   send:m=>this.speechSend!(m),available:value=>{this.recorder.setSpeechAvailable(value);if(value)this.update({speech:{enabled:true,status:'ready',message:'Local speech ready; start a fresh take'}});},
   verify:(clock,frame)=>this.recorder.verifyThrough(clock,frame),exclude:m=>handleSpeechMessage(this.recorder,m),failed:reason=>this.failSpeech(reason),
   lag:seconds=>{if(this.state.speech.status==='ready')this.update({speech:{enabled:true,status:'ready',message:seconds>SPEECH_PENDING_SECONDS?`Speech verification pending (${seconds.toFixed(1)} s); unverified input is waiting`:'Local speech ready; recording waits for verified audio'}});},
  },this.transport.sampleRate);
  try{this.mic.startSpeech({streamId,clockId,latencyFrames:effectiveLatencyFrames(this.state.calibration)},result=>{
   if(this.speechSession!==session)return;
   if(result.type==='gap')session.fail(result.reason);else {if(result.message.seq===0)this.recorder.beginSpeechCoverage(clockId,result.message.startFrame);session.chunk(result.message);}
  });}catch(error){session.fail(String(error));}
 }


 private context() {
  const context = this.engine.getAudioContext();
  if (!context) throw new Error('Enable audio first');
  return context;
 }

 private async connect(start: (mic: MicLike) => Promise<void>, kind: 'on' | 'test-signal') {
  const context = this.context();
  // A different stream or device would invalidate a measurement in progress.
  this.cancelCalibration();
  this.failSpeech('Microphone changed; restart hands-free capture');
  this.update({ microphone: 'starting', message: null });
  try {
   this.mic ??= await this.createMic(context);
   this.mic.onAnalysis = frame => this.onAnalysis(frame);
   this.mic.onError = error => {
    const disconnected = error.message.includes('disconnected');
    if (disconnected) {this.cancelCalibration();this.failSpeech(error.message);}
    this.update({ message: error.message, ...(disconnected ? { microphone: 'off' as const } : {}) });
   };
   await start(this.mic);
   const profile = kind === 'on' ? this.state.processingProfile : 'music';
   const calibration = (kind === 'on' ? loadCalibration(this.mic.deviceId, undefined, profile) : null) ?? defaultCalibration(context, this.mic.inputLatencySeconds, this.mic.deviceId);
   this.mic.configure(calibration.noiseFloorDb);
   this.check = new MicCheck(context.sampleRate);
   this.update({ microphone: kind, calibration, capture: this.mic.captureSettings, micCheck: null });
  } catch (error) {
   this.update({ microphone: 'off', message: error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in the address bar, then try again.' : String(error) });
   throw error;
  }
 }

 enableMicrophone(deviceId?: string, profile: ProcessingProfile = this.state.processingProfile) {
  this.update({ processingProfile: profile });
  return this.connect(mic => mic.startMicrophone(deviceId, profile), 'on');
 }
 setProcessingProfile(profile: ProcessingProfile) {
  if (profile === this.state.processingProfile) return Promise.resolve();
  this.update({ processingProfile: profile });
  if (this.state.microphone !== 'on') return Promise.resolve();
  return this.enableMicrophone(this.mic?.deviceId ?? undefined, profile);
 }
 /** Diagnostic: feed a known buffer through the identical analysis path. */
 enableTestSignal(buffer: AudioBuffer, when: number) { return this.connect(mic => mic.startTestSignal(buffer, when), 'test-signal'); }

 private onAnalysis(frame: AnalysisFrame) {
  this.timings.push(frame.analysisMs); if (this.timings.length > 400) this.timings.shift();
  if (this.collector) { this.collector.push(...frame.onsets.map(o => o.frame)); }
  else if (this.transport && this.state.calibration) {
   const latencyFrames = effectiveLatencyFrames(this.state.calibration), clock = this.transport.clockId;
   this.recorder.setLiveNote(frame.liveNote ?? null, latencyFrames, clock);
   const heldStart = Math.floor(frame.analysedThrough - latencyFrames);
   this.heldCaptureStart = this.transport.recording && this.transport.recordingTarget?.trackId !== 'drums'
    && frame.pitch?.holding && heldStart >= (this.transport.captureStartFrame ?? this.transport.recordingStartFrame ?? Infinity) ? heldStart : null;
   if (frame.notes.length) this.recorder.addNotes(frame.notes, latencyFrames, clock, frame.analysedThrough);
   this.recorder.addOnsets(frame.onsets, latencyFrames, clock, frame.analysedThrough);
  } else this.recorder.setLiveNote(null, 0, this.transport?.clockId ?? '');
  this.check?.add(frame);
  // Analysis frames arrive ~43 times a second; the UI only needs ~10 updates a second.
  const now = performance.now();
  if (now - this.lastUiUpdate < 100) return;
  this.lastUiUpdate = now;
  const sorted = [...this.timings].sort((a, b) => a - b);
  this.update({ levelDb: frame.levelDb, analysisP95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? null, micCheck: this.check?.state(this.state.calibration?.noiseFloorDb ?? -60) ?? null });
 }

 private startRun(context: AudioContext, endAt: number, onTick: () => void, byAgent = false) {
  const run = new TimedRun({ now: () => context.currentTime, closed: () => context.state === 'closed' }, endAt, onTick, this.options.tickMs ?? 100, this.options.timers);
  this.run = run;
  const owner = byAgent ? this.agentAction : null;
  owner?.runs.add(run);
  run.onEnd(() => { if (this.run === run) this.run = null; owner?.runs.delete(run); });
  return run;
 }

 /** True when the active run belongs to the running agent action (never a screen calibration). */
 private agentOwnsRun() { return !!this.run && !!this.agentAction?.runs.has(this.run); }

 /** Why a running calibration can no longer apply its result, or null while its prerequisites still hold. */
 private calibrationInvalidReason(): string | null {
  const t = this.transport;
  if (t?.recording || t?.recordingState === 'armed' || t?.recordingState === 'recording') return 'Recording was armed or started';
  if (t?.playing && (this.agentOwnsRun() || this.state.calibrating === 'latency')) return 'Playback started';
  return null;
 }

 /**
  * Calibration takes seconds while Play/Record stay usable. When the transport invalidates a run, cancel it
  * before any late measurement can apply. The transport itself is never stopped or restarted here.
  */
 private revalidateRun() {
  if (!this.run) return;
  const reason = this.calibrationInvalidReason();
  if (!reason) return;
  this.runCancelReason = reason;
  this.run.cancel();
 }

 /** Agent work owns the input until it settles; screen calibration must not start underneath it. */
 private takeRunOwnership(): { byAgent: boolean; blocked: string | null } {
  const byAgent = this.agentStartingRun; this.agentStartingRun = false;
  if (!byAgent && this.agentAction) return { byAgent, blocked: 'The agent is changing input settings; wait for it to finish or cancel it.' };
  return { byAgent, blocked: null };
 }
 private cancelledText(fallback: string, kept: string) {
  const reason = this.runCancelReason; this.runCancelReason = null;
  return reason ? `${reason}, so the measurement was cancelled; ${kept}` : fallback;
 }

 /**
  * Guided silence measurement: a visible preparation countdown ("stay quiet"), then 1.5 s of
  * measurement. Cancel (or losing the mic) keeps the previous noise floor. No clicks are played.
  */
 async calibrateNoise(countdown = SILENCE_COUNTDOWN): Promise<CalibrationOutcome> {
  const owner = this.takeRunOwnership(); // First, so a throw below cannot leave the agent flag set.
  const context = this.context();
  const blocked = owner.blocked ?? (!this.mic || !this.state.calibration ? 'Enable the microphone first.' : this.run ? 'A calibration is already running.' : null);
  if (blocked) { this.update({ calibrationResult: { ok: false, text: blocked } }); return { status: 'rejected', text: blocked }; }
  const mic = this.mic!, previous = this.state.calibration!;
  this.runCancelReason = null;
  // Nothing writes the calibration until a run succeeds, so "keeping" it means leaving it untouched
  // (restoring a snapshot could undo a trim made meanwhile, or apply one device's values to another).
  const keep = (text: string, status: CalibrationOutcome['status'] = 'cancelled'): CalibrationOutcome => { this.update({ calibrationResult: { ok: false, text } }); return { status, text }; };
  this.update({ calibrating: 'noise', silenceRun: { phase: 'countdown', countdownLeft: countdown }, calibrationResult: null, message: null });
  try {
   const prepEnd = context.currentTime + countdown;
   const prep = this.startRun(context, prepEnd, () => this.update({ silenceRun: { phase: 'countdown', countdownLeft: Math.max(1, Math.min(countdown, Math.ceil(prepEnd - context.currentTime))) } }), owner.byAgent);
   const cancelledText = () => this.cancelledText('Silence measurement cancelled; the previous noise floor was kept.', 'the previous noise floor was kept.');
   if (await prep.settled === 'cancelled') return keep(cancelledText());
   this.update({ silenceRun: { phase: 'measuring' } });
   // The measurement promise cannot be aborted, so a parallel run lets Cancel win the race.
   const measuring = this.startRun(context, Number.POSITIVE_INFINITY, () => {}, owner.byAgent);
   const outcome = await Promise.race([mic.measureNoiseFloor(SILENCE_SECONDS).then(db => ({ db }), (error: unknown) => ({ error })), measuring.settled.then(() => null)]);
   const cancelled = !measuring.active; measuring.cancel();
   // A result that arrives after cancellation, or once Play/Record invalidated the run, is discarded.
   if (cancelled || outcome === null || this.calibrationInvalidReason()) { this.runCancelReason ??= this.calibrationInvalidReason(); return keep(cancelledText()); }
   if ('error' in outcome) {
    const detail = (outcome.error instanceof Error ? outcome.error.message : String(outcome.error)).trim().replace(/[.!?]+$/, '');
    const kept = /previous(?: noise)? floor was kept$/i.test(detail);
    return keep(`${detail}.${kept ? '' : ' The previous noise floor was kept.'}`, 'rejected');
   }
   const calibration: InputCalibration = { ...(this.state.calibration ?? previous), noiseFloorDb: outcome.db, noiseSource: 'measured' };
   mic.configure(outcome.db); saveCalibration(calibration, undefined, this.state.processingProfile);
   this.check?.reset();
   const text = `Noise floor ${outcome.db.toFixed(1)} dBFS${outcome.db > -45 ? ' (noisy room: quiet hits may be missed)' : ''}`;
   this.update({ calibration, calibrationResult: { ok: true, text } });
   return { status: 'complete', text };
  } finally { this.update({ calibrating: null, silenceRun: null }); }
 }

 /**
  * Guided timing calibration: a visible 3-second countdown, 4 practice clicks (not scored), then 8
  * measured clicks, with progress and Cancel. The performer taps or says "t" with each click; this
  * measures the full round trip they experience. A failed or cancelled run (including stopping or
  * losing the microphone, changing device, disposing, or the AudioContext closing) keeps the
  * previous valid calibration and stops any scheduled clicks.
  */
 async calibrateLatency(options: { countdown?: number; practice?: number; measured?: number; interval?: number; verify?: boolean } = {}): Promise<CalibrationOutcome> {
  const owner = this.takeRunOwnership(); // First, so a throw below cannot leave the agent flag set.
  const context = this.context();
  const blocked = owner.blocked ?? (!this.mic || !this.state.calibration ? 'Enable the microphone first.' : this.transport?.playing ? 'Stop playback before calibrating timing.' : this.run ? 'A calibration is already running.' : null);
  if (blocked) { this.update({ calibrationResult: { ok: false, text: blocked } }); return { status: 'rejected', text: blocked }; }
  const previous = this.state.calibration!;
  const plan = clickPlan(context.currentTime + 0.05, options);
  this.runCancelReason = null;
  const run = this.startRun(context, plan.end + 0.4, () => this.update({ calibrationRun: calibrationProgress(plan, context.currentTime) }), owner.byAgent);
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
   if (outcome === 'cancelled' || this.calibrationInvalidReason()) {
    this.runCancelReason ??= this.calibrationInvalidReason();
    const text = this.cancelledText('Calibration cancelled; the previous timing was kept.', 'the previous timing was kept.');
    this.update({ calibrationResult: { ok: false, text } });
    return { status: 'cancelled', text };
   }
   const sr = context.sampleRate;
   const estimate = estimateLatency(plan.measured.map(t => Math.round(t * sr)), onsets, { sampleRate: sr });
   if (options.verify) {
    // Tap test against the current settings: report the residual, keep the calibration.
    const check = timingCheck(estimate.latencyFrames, previous);
    const text = `${check.text} (${estimate.matched}/${plan.measured.length} taps matched)`;
    this.update({ calibrationResult: { ok: check.verdict === 'on-time', text, ...(check.verdict === 'on-time' ? {} : { suggestTrimMs: check.suggestedTrimMs }) } });
    // The check measured successfully even when it reports a late/early residual; nothing was changed.
    return { status: 'complete', text };
   }
   const calibration: InputCalibration = { ...(this.state.calibration ?? previous), latencyFrames: estimate.latencyFrames, latencySpreadFrames: estimate.spreadFrames, latencySource: 'tap-along' };
   saveCalibration(calibration, undefined, this.state.processingProfile);
   const latencyMs = estimate.latencyFrames / sr * 1000, spreadMs = estimate.spreadFrames / sr * 1000;
   const text = `Offset ${latencyMs.toFixed(0)} ms, consistency ±${spreadMs.toFixed(0)} ms, ${estimate.matched}/${plan.measured.length} taps matched`;
   this.update({ calibration, calibrationResult: { ok: true, latencyMs, spreadMs, matched: estimate.matched, of: plan.measured.length, text } });
   return { status: 'complete', text };
  } catch (error) {
   const text = `${error instanceof Error ? error.message : String(error)}. The previous timing was kept.`;
   this.update({ calibrationResult: { ok: false, text } });
   return { status: 'rejected', text };
  } finally { this.update({ calibrating: null, calibrationRun: null }); }
 }

 /** Stops a running timing calibration or silence measurement; previous settings stay in effect. */
 cancelCalibration() { this.run?.cancel(); }

 /** Per-device manual recording-offset trim (ms), persisted with the calibration. */
 setOffsetAdjust(ms: number) {
  if (!this.state.calibration) return;
  const calibration: InputCalibration = { ...this.state.calibration, offsetAdjustMs: Math.max(-150, Math.min(150, Math.round(ms))) };
  if (calibration.deviceId !== 'test-signal') saveCalibration(calibration, undefined, this.state.processingProfile);
  this.update({ calibration });
 }

 /** Diagnostic override, e.g. when the test signal path has zero round-trip latency. */
 setLatencyFrames(latencyFrames: number) { if (this.state.calibration) this.update({ calibration: { ...this.state.calibration, latencyFrames } }); }

 /** Opt-in, measurements-only report for posting microphone test results (no audio, no device IDs). */
 testReport(): MicTestReport {
  const context = this.context();
  return buildMicTestReport({
   browser: navigator.userAgent, context, capture: this.state.capture ?? {}, processingProfile: this.state.processingProfile, calibration: this.state.calibration,
   micCheck: this.check?.state(this.state.calibration?.noiseFloorDb ?? -60) ?? new MicCheck(context.sampleRate).state(-60),
   recorder: this.recorder.status(), analysisP95Ms: this.state.analysisP95Ms,
  });
 }

 // ---- BrowserActionAdapter: agent-requested calibration, profile and offset changes ----

 /** Null until the audio clock exists. `available` means the executor exists, not that every action is allowed now. */
 getBrowserStatus(): BrowserStatus | null {
  if (!this.transport) return null;
  const c = this.state.calibration, a = this.agentAction;
  const guidance = [a ? null : this.state.calibrationResult?.text, this.state.readiness.ready ? null : this.state.readiness.advice, this.state.speech.enabled ? this.state.speech.message : null]
   .filter((x): x is string => !!x).join(' ').slice(0, 500);
  return {
   type: 'browser-status', clockId: this.transport.clockId, inputRevision: this.inputRevision, available: true,
   microphone: this.state.microphone, profile: this.state.processingProfile,
   calibration: c ? { noiseMeasured: c.noiseSource === 'measured', noiseFloorDb: c.noiseFloorDb, latencySource: c.latencySource,
    latencyMs: Math.max(0, Math.round(c.latencyFrames / c.sampleRate * 10000) / 10), offsetAdjustMs: c.offsetAdjustMs ?? 0 } : null,
   activeAction: a ? { id: a.id, kind: a.kind, phase: this.actionPhase(a) } : null,
   ...(guidance ? { guidance } : {}),
  };
 }

 subscribeBrowserActions(listener: (message: BrowserStatus | BrowserActionAck) => void): () => void {
  this.actionListeners.add(listener);
  return () => { this.actionListeners.delete(listener); };
 }

 /** Disconnect/disposal: cancels only agent-owned work. A calibration started from the UI keeps running. */
 cancelBrowserActions(_reason: string) {
  const action = this.agentAction;
  if (!action || action.cancelled) return;
  action.cancelled = true;
  for (const run of [...action.runs]) run.cancel(); // Only runs this action started; never a screen calibration.
 }

 /** Validates and starts one action. Outcomes arrive through subscribeBrowserActions; refusals never throw. */
 handleBrowserAction(action: BrowserAction) {
  const payload = JSON.stringify(action), known = this.actionRecords.get(action.id);
  if (known) {
   // Identical duplicates replay the latest acknowledgment without rerunning any work.
   if (known.payload === payload) this.emitAction(known.last);
   else this.emitAction(this.ack(action, 'rejected', 'Input action ID was reused with a different request'));
   return;
  }
  if (this.actionRecords.size >= MAX_ACTION_RECORDS) { this.emitAction(this.ack(action, 'rejected', 'Input request limit reached; reload before starting another input action')); return; }
  const record = { payload, last: this.ack(action, 'rejected', 'Not started') };
  this.actionRecords.set(action.id, record);
  const send = (status: BrowserActionAck['status'], reason?: string) => { record.last = this.ack(action, status, reason); this.emitAction(record.last); };
  const op = action.operation;

  if (!this.transport || action.clockId !== this.transport.clockId) { send('rejected', 'The audio clock changed; read the current input status and retry'); return; }
  if (op.type === 'cancel-input-action') {
   // Cancellation names an exact action; it is not bound to the revision that action may have advanced.
   const target = this.agentAction;
   if (!target || target.id !== op.actionId) { send('rejected', 'No agent input action with that ID is running; nothing was cancelled'); return; }
   this.cancelBrowserActions('Cancelled by request');
   void target.done.then(() => send('complete', 'Cancellation requested; see the cancelled action for what was kept'));
   return;
  }
  if (action.expectedInputRevision !== this.inputRevision) { send('rejected', `Input settings changed (now revision ${this.inputRevision}); read the current input status and retry`); return; }
  const blocked = this.actionBlockedReason(op);
  if (blocked) { send('rejected', blocked); return; }

  let finish!: () => void;
  const current: AgentInputAction = { id: action.id, kind: op.type, phase: 'starting', cancelled: false, done: new Promise<void>(resolve => { finish = resolve; }), runs: new Set() };
  this.agentAction = current;
  this.update({ inputActionRunning: true });
  send('running');
  void this.runAction(op, current).then(
   outcome => this.settleAction(current, outcome, send, finish),
   (error: unknown) => this.settleAction(current, { status: 'rejected', text: `Input action failed: ${error instanceof Error ? error.message : String(error)}` }, send, finish));
 }

 private settleAction(action: AgentInputAction, outcome: CalibrationOutcome, send: (status: BrowserActionAck['status'], reason?: string) => void, finish: () => void) {
  if (this.agentAction === action) this.agentAction = null;
  this.update({ inputActionRunning: this.agentAction !== null }); // Status first, so the terminal acknowledgment never precedes the configuration it reports.
  send(outcome.status, outcome.text);
  finish();
 }

 private actionBlockedReason(op: MutatingInputOperation): string | null {
  const t = this.transport;
  if (this.agentAction) return 'Another input action is running; cancel it or wait for it to finish';
  if (this.run) return 'A calibration started from the screen is running; wait for it or cancel it there';
  if (t?.recording || t?.recordingState === 'armed' || t?.recordingState === 'recording') return 'Recording is armed or active; stop recording before changing input settings';
  if (this.recorder.hasPendingCapture || this.heldCaptureStart !== null) return 'Captured input is still being committed; wait for it to settle before changing input settings';
  if (op.type === 'calibrate-input') {
   if (this.state.microphone !== 'on') return 'Enable the microphone before calibrating';
   if (t?.playing) return 'Stop playback before calibrating; calibration needs a stopped transport';
  }
  if (op.type === 'set-input-offset' && !this.state.calibration) return 'Enable the microphone before setting the input offset';
  return null;
 }

 private async runAction(op: MutatingInputOperation, action: AgentInputAction): Promise<CalibrationOutcome> {
  const paused = this.pauseSpeech();
  try {
   const outcome = await this.applyAction(op, action);
   if (!paused) return outcome;
   await this.resumeSpeech(action);
   const speech = this.state.speech;
   return outcome.status !== 'complete' || speech.status === 'ready' ? outcome
    : { ...outcome, text: `${outcome.text}. Hands-free speech is not ready yet: ${speech.message ?? speech.status}` };
  } finally {
   if (this.speechPaused) await this.resumeSpeech(action);
  }
 }

 private async applyAction(op: MutatingInputOperation, action: AgentInputAction): Promise<CalibrationOutcome> {
  switch (op.type) {
   case 'set-input-profile': {
    if (op.profile === this.state.processingProfile) return { status: 'complete', text: `Already using the ${op.profile} profile` };
    await this.setProcessingProfile(op.profile);
    if (this.state.processingProfile !== op.profile) return { status: 'rejected', text: 'The profile could not be applied' };
    return { status: 'complete', text: `Using the ${op.profile} profile${this.state.microphone === 'on' ? ' with its saved calibration for this microphone' : ''}` };
   }
   case 'set-input-offset': {
    if ((this.state.calibration?.offsetAdjustMs ?? 0) === op.milliseconds) return { status: 'complete', text: `Input offset is already ${op.milliseconds} ms` };
    this.setOffsetAdjust(op.milliseconds);
    return { status: 'complete', text: `Input offset set to ${op.milliseconds} ms; the measured latency is unchanged` };
   }
   case 'calibrate-input': {
    if (op.mode === 'timing' || op.mode === 'check-timing') { this.agentStartingRun = true; return this.calibrateLatency({ verify: op.mode === 'check-timing' }); }
    this.agentStartingRun = true;
    const noise = await this.calibrateNoise();
    if (op.mode === 'noise' || noise.status !== 'complete') return noise;
    if (action.cancelled) return { status: 'cancelled', text: `${noise.text} was applied. Timing calibration was cancelled before it started; the previous timing was kept` };
    const invalid = this.calibrationInvalidReason() ?? (this.transport?.playing ? 'Playback started' : null);
    if (invalid) return { status: 'cancelled', text: `${noise.text} was applied. ${invalid}, so timing calibration did not start; the previous timing was kept` };
    this.agentStartingRun = true;
    const timing = await this.calibrateLatency();
    return timing.status === 'complete' ? { status: 'complete', text: `${noise.text}. ${timing.text}` } : { ...timing, text: `${noise.text} was applied. ${timing.text}` };
   }
  }
 }

 private actionPhase(action: AgentInputAction): InputActionPhase {
  if (action.phase === 'reconnecting') return 'reconnecting';
  if (this.state.silenceRun) return this.state.silenceRun.phase;
  if (this.state.calibrationRun) return this.state.calibrationRun.phase;
  return action.phase;
 }

 /** Ends the speech stream without dropping the agent socket (dropping it would cancel this very action). */
 private pauseSpeech(): boolean {
  if (!this.state.speech.enabled || this.state.speech.status === 'unavailable') return false;
  this.speechPaused = true;
  this.mic?.stopSpeech?.(); this.speechSession = null;
  // Unverified capture from the old stream is discarded; the new stream can never verify it.
  this.recorder.setSpeechAvailable(false); this.recorder.resetPendingCapture();
  this.update({ speech: { enabled: true, status: 'waiting', message: 'Speech paused while input settings change' } });
  return true;
 }

 /** Starts a fresh stream with the current latency/profile and waits briefly for the recognizer to report. */
 private async resumeSpeech(action: AgentInputAction) {
  if (!this.speechPaused) return;
  this.speechPaused = false;
  if (!this.state.speech.enabled) return;
  action.phase = 'reconnecting'; this.emitStatus();
  this.setHandsFree(true);
  const deadline = Date.now() + (this.options.speechResumeMs ?? 8000);
  while (this.state.speech.enabled && this.state.speech.status === 'waiting' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
 }

 private ack(action: BrowserAction, status: BrowserActionAck['status'], reason?: string): BrowserActionAck {
  return { type: 'browser-action-ack', id: action.id, clockId: action.clockId, inputRevision: this.inputRevision, status, ...(reason ? { reason } : {}) };
 }
 private emitAction(message: BrowserStatus | BrowserActionAck) { for (const listener of [...this.actionListeners]) listener(message); }
 /** Emits only when the snapshot changes (configuration or action progress), not on every audio block. */
 private emitStatus() {
  if (!this.actionListeners.size) return;
  const status = this.getBrowserStatus();
  if (!status) return;
  const serialized = JSON.stringify(status);
  if (serialized === this.lastEmittedStatus) return;
  this.lastEmittedStatus = serialized;
  this.emitAction(status);
 }

 stopMicrophone() { this.failSpeech('Microphone stopped; restart hands-free capture');this.cancelCalibration(); this.mic?.stop(); this.update({ microphone: 'off', levelDb: -120 }); }
 dispose() { this.cancelBrowserActions('Input disposed');this.actionListeners.clear();this.mic?.stopSpeech?.();this.speechSession=null;this.cancelCalibration(); this.unsubscribe(); this.mic?.dispose(); this.mic = null; }
}
