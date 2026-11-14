import { OnsetDetector, toDb, type Onset } from './onset.ts';
import { measureNoiseFloor } from './calibration.ts';

/** Messages from the main thread. Audio arrives on a separate port directly from the capture worklet. */
export type AnalysisRequest =
 | { type: 'connect'; port: MessagePort; sampleRate: number }
 | { type: 'configure'; noiseFloorDb: number; sensitivity?: number }
 | { type: 'measure-noise'; frames: number };
export type AnalysisResult =
 | { type: 'onsets'; onsets: Onset[]; analysedThrough: number; levelDb: number; analysisMs: number }
 | { type: 'noise-floor'; db: number }
 | { type: 'error'; message: string };

// Typed locally: the project compiles with the DOM lib, which lacks DedicatedWorkerGlobalScope.
const scope = self as unknown as { postMessage(message: unknown): void; onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null };
let detector: OnsetDetector | null = null;
let sampleRate = 44100;
let noiseFloorDb = -60;
let sensitivity: number | undefined;
let measuring: { frames: number; chunks: Float32Array[]; collected: number } | null = null;
const post = (message: AnalysisResult) => scope.postMessage(message);
const make = () => new OnsetDetector({ sampleRate, noiseFloorDb, ...(sensitivity ? { sensitivity } : {}) });

function onAudio(startFrame: number, samples: Float32Array) {
 if (!detector) return;
 const started = performance.now();
 let onsets: Onset[];
 try { onsets = detector.process(samples, startFrame); }
 catch { detector.reset(); onsets = detector.process(samples, startFrame); }
 let peak = 0;
 for (const s of samples) peak = Math.max(peak, Math.abs(s));
 if (measuring) {
  measuring.chunks.push(samples.slice()); measuring.collected += samples.length;
  if (measuring.collected >= measuring.frames) {
   const all = new Float32Array(measuring.collected); let offset = 0;
   for (const c of measuring.chunks) { all.set(c, offset); offset += c.length; }
   measuring = null;
   try { post({ type: 'noise-floor', db: measureNoiseFloor(all) }); } catch (e) { post({ type: 'error', message: String(e) }); }
  }
 }
 post({ type: 'onsets', onsets, analysedThrough: startFrame + samples.length, levelDb: toDb(peak), analysisMs: performance.now() - started });
}

scope.onmessage = ({ data }: MessageEvent<AnalysisRequest>) => {
 if (data.type === 'connect') {
  sampleRate = data.sampleRate; detector = make();
  data.port.onmessage = ({ data: audio }) => {
   if (audio.type === 'gap') detector?.reset();
   else if (audio.type === 'audio') onAudio(audio.startFrame, audio.samples);
  };
 } else if (data.type === 'configure') {
  noiseFloorDb = data.noiseFloorDb; sensitivity = data.sensitivity; detector?.setNoiseFloor(noiseFloorDb);
 } else if (data.type === 'measure-noise') {
  measuring = { frames: data.frames, chunks: [], collected: 0 };
 }
};
