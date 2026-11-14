import captureUrl from './capture-worklet.ts?worker&url';
import type { AnalysisRequest, AnalysisResult } from './analysis-worker.ts';
import type { Onset } from './onset.ts';
import type { PitchReading, SungNote } from './pitch.ts';
import type { SpeechRequest, SpeechResult } from './speech-worker.ts';
import type { CaptureSettings } from './diagnostics.ts';
import { formatWorkerLoadError } from './worker-load-error.ts';
import { captureConstraints, type ProcessingProfile } from './processing-profile.ts';

export interface AnalysisFrame {
 onsets: Onset[]; notes: SungNote[];
 /** Verification coverage: held at the start of a note still being sung. */
 analysedThrough: number;
 /** Raw capture frame actually processed (real elapsed time, for diagnostics). */
 processedThrough?: number;
 levelDb: number; analysisMs: number; pitch?: PitchReading | null;
}

export type { ProcessingProfile } from './processing-profile.ts';

/**
 * Connects an input (the microphone, or a diagnostic test signal) to the capture worklet on the
 * engine's AudioContext and the analysis worker. Raw audio is never stored. An explicitly enabled speech tap can send PCM to the local service.
 */
export class MicrophoneInput {
 onAnalysis: (frame: AnalysisFrame) => void = () => {};
 onError: (error: Error) => void = () => {};
 /** Device-reported capture latency in seconds (Chrome exposes MediaTrackSettings.latency). */
 inputLatencySeconds = 0;
 deviceId: string | null = null;
 /** What the browser actually granted for the capture track (it may ignore requested constraints). */
 captureSettings: CaptureSettings | null = null;
 private node: AudioWorkletNode | null = null;
 private sink: GainNode | null = null;
 private worker: Worker | null = null;
 private speechWorker: Worker | null = null;
 private source: AudioNode | null = null;
 private stream: MediaStream | null = null;
 private noiseWaiters: ((db: number) => void)[] = [];
 private static modules = new WeakSet<BaseAudioContext>();

 constructor(private context: AudioContext) {}

 get active() { return !!this.source; }

 private async ensureGraph() {
  if (this.node) return;
  if (!MicrophoneInput.modules.has(this.context)) { await this.context.audioWorklet.addModule(captureUrl); MicrophoneInput.modules.add(this.context); }
  const node = this.node = new AudioWorkletNode(this.context, 'voicesynth-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
  // Keep the node pulled by the graph without making the input audible.
  this.sink = this.context.createGain(); this.sink.gain.value = 0; node.connect(this.sink).connect(this.context.destination);
  const worker = this.worker = new Worker(new URL('./analysis-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<AnalysisResult>) => {
   if (data.type === 'onsets') this.onAnalysis(data);
   else if (data.type === 'noise-floor') { this.noiseWaiters.splice(0).forEach(resolve => resolve(data.db)); }
   else this.onError(new Error(data.message));
  };
  worker.onerror = event => this.onError(new Error(formatWorkerLoadError(event)));
  const channel = new MessageChannel();
  node.port.postMessage({ type: 'connect', port: channel.port1 }, [channel.port1]);
  this.request({ type: 'connect', port: channel.port2, sampleRate: this.context.sampleRate }, [channel.port2]);
 }

 private request(message: AnalysisRequest, transfer: Transferable[] = []) { this.worker?.postMessage(message, transfer); }

 /** Must be called from a user gesture the first time so the permission prompt can appear. */
 async startMicrophone(deviceId?: string, profile: ProcessingProfile = 'noisy-room') {
  await this.ensureGraph();
  this.disconnectSource();
  // Noise suppression is requested only for the noisy-room profile. AGC and echo
  // cancellation stay off so capture level and timing remain predictable.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: captureConstraints(deviceId, profile) });
  this.stream = stream;
  const track = stream.getAudioTracks()[0];
  const settings = track.getSettings() as MediaTrackSettings & { latency?: number };
  this.inputLatencySeconds = typeof settings.latency === 'number' ? settings.latency : 0;
  this.deviceId = settings.deviceId ?? null;
  const { echoCancellation, noiseSuppression, autoGainControl, sampleRate, channelCount } = settings;
  this.captureSettings = { echoCancellation, noiseSuppression, autoGainControl, sampleRate, channelCount, latency: settings.latency };
  track.onended = () => { this.onError(new Error('Microphone disconnected')); this.disconnectSource(); };
  this.source = this.context.createMediaStreamSource(stream);
  this.source.connect(this.node!);
 }

 /**
  * Diagnostic only: play a prepared buffer into the analysis path instead of the microphone,
  * starting at an exact context time. Used to verify timing end to end without a performer.
  */
 async startTestSignal(buffer: AudioBuffer, when: number) {
  await this.ensureGraph();
  this.disconnectSource();
  const source = this.context.createBufferSource(); source.buffer = buffer;
  source.connect(this.node!); source.start(when);
  this.source = source; this.inputLatencySeconds = 0; this.deviceId = 'test-signal'; this.captureSettings = null;
 }

 /** Local speech tap: PCM encoding happens in its own worker, never in the audio callback. */
 startSpeech(config: {streamId:string;clockId:string;latencyFrames:number}, onResult:(result:SpeechResult)=>void) {
  this.stopSpeech();
  if (!this.node || !this.source) throw new Error('Enable microphone first');
  const worker=this.speechWorker=new Worker(new URL('./speech-worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=({data}:MessageEvent<SpeechResult>)=>{if(this.speechWorker===worker)onResult(data);};
  worker.onerror=()=>{if(this.speechWorker===worker)onResult({type:'gap',streamId:config.streamId,reason:'Speech capture worker failed'});};
  const channel=new MessageChannel();
  const message:SpeechRequest={type:'connect',...config,sampleRate:this.context.sampleRate,port:channel.port2};
  worker.postMessage(message,[channel.port2]);
  this.node.port.postMessage({type:'connect-speech',port:channel.port1},[channel.port1]);
 }
 stopSpeech() {
  this.node?.port.postMessage({type:'disconnect-speech'});
  this.speechWorker?.terminate();this.speechWorker=null;
 }

 /** End any open sung note at a raw capture frame. */
 flush(frame: number) { this.request({ type: 'flush', frame }); }

 reset(frame: number) { this.request({ type: 'reset', frame }); }

 configure(noiseFloorDb: number, sensitivity?: number) { this.request({ type: 'configure', noiseFloorDb, ...(sensitivity ? { sensitivity } : {}) }); }

 measureNoiseFloor(seconds = 1.5): Promise<number> {
  if (!this.source) return Promise.reject(new Error('Enable the microphone first'));
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => reject(new Error('No microphone audio arrived; check the input device')), seconds * 1000 + 3000);
   this.noiseWaiters.push(db => { clearTimeout(timer); resolve(db); });
   this.request({ type: 'measure-noise', frames: Math.round(seconds * this.context.sampleRate) });
  });
 }

 private disconnectSource() {
  this.stopSpeech();
  this.source?.disconnect(); this.source = null;
  this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
 }

 stop() { this.disconnectSource(); }

 dispose() {
  this.disconnectSource();
  this.node?.port.postMessage({ type: 'disconnect' }); this.node?.disconnect(); this.sink?.disconnect();
  this.worker?.terminate(); this.node = null; this.sink = null; this.worker = null;
 }
}
