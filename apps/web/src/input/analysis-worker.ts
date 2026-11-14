import { OnsetDetector, toDb, type Onset } from './onset.ts';
import { measureNoiseFloor } from './calibration.ts';
import { NoteSegmenter, YinTracker, readPitch, type PitchReading, type SungNote } from './pitch.ts';

/** Messages from the main thread. Audio arrives on a separate port directly from the capture worklet. */
export type AnalysisRequest =
 | { type: 'connect'; port: MessagePort; sampleRate: number }
 | { type: 'configure'; noiseFloorDb: number; sensitivity?: number }
 | { type: 'measure-noise'; frames: number }
 /** End any open sung note at this raw capture frame (the take closed). */
 | { type: 'flush'; frame: number };
export type AnalysisResult =
 | { type: 'onsets'; onsets: Onset[]; notes: SungNote[]; analysedThrough: number; levelDb: number; analysisMs: number; pitch?: PitchReading | null; processedThrough?: number }
 | { type: 'noise-floor'; db: number }
 | { type: 'error'; message: string };

// Typed locally: the project compiles with the DOM lib, which lacks DedicatedWorkerGlobalScope.
const scope = self as unknown as { postMessage(message: unknown): void; onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null };
let detector: OnsetDetector | null = null;
let yin: YinTracker | null = null;
let segmenter: NoteSegmenter | null = null;
let sampleRate = 44100;
let noiseFloorDb = -60;
let sensitivity: number | undefined;
/** Raw frame just past the last analysed sample; 0 before audio arrives or after a gap. */
let lastFrame = 0;
let measuring: { frames: number; chunks: Float32Array[]; collected: number } | null = null;
const post = (message: AnalysisResult) => scope.postMessage(message);

function start() {
 detector = new OnsetDetector({ sampleRate, noiseFloorDb, ...(sensitivity ? { sensitivity } : {}) });
 yin = new YinTracker({ sampleRate });
 segmenter = new NoteSegmenter({ sampleRate, hop: yin.hop, noiseFloorDb });
 lastFrame = 0;
}

/** A gap ends any sung note and restarts the analysers with fresh timestamps. */
function gap(): SungNote[] {
 const notes = lastFrame ? segmenter?.flush(lastFrame) ?? [] : [];
 detector?.reset(); yin?.reset(); lastFrame = 0;
 return notes;
}

/** Analysis is complete only up to the start of a note that is still being sung. */
function analysedThrough() {
 const open = segmenter?.openStart ?? null;
 return open === null ? lastFrame : Math.min(lastFrame, open);
}

function onAudio(startFrame: number, samples: Float32Array) {
 if (!detector || !yin || !segmenter) return;
 const started = performance.now();
 const notes: SungNote[] = [];
 if (lastFrame && startFrame !== lastFrame) notes.push(...gap());
 const onsets: Onset[] = detector.process(samples, startFrame);
 const pitchFrames = yin.process(samples, startFrame);
 notes.push(...segmenter.push(pitchFrames));
 const pitch = readPitch(pitchFrames, noiseFloorDb, segmenter.openStart !== null);
 lastFrame = startFrame + samples.length;
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
 // analysedThrough is held at an open note's start (verification coverage); processedThrough is real elapsed capture.
 post({ type: 'onsets', onsets, notes, analysedThrough: analysedThrough(), processedThrough: lastFrame, levelDb: toDb(peak), analysisMs: performance.now() - started, pitch });
}

scope.onmessage = ({ data }: MessageEvent<AnalysisRequest>) => {
 if (data.type === 'connect') {
  sampleRate = data.sampleRate; start();
  data.port.onmessage = ({ data: audio }) => {
   if (audio.type === 'gap') {
    const notes = gap();
    if (notes.length) post({ type: 'onsets', onsets: [], notes, analysedThrough: 0, levelDb: -120, analysisMs: 0 });
   } else if (audio.type === 'audio') onAudio(audio.startFrame, audio.samples);
  };
 } else if (data.type === 'configure') {
  noiseFloorDb = data.noiseFloorDb; sensitivity = data.sensitivity;
  detector?.setNoiseFloor(noiseFloorDb); segmenter?.setNoiseFloor(noiseFloorDb);
 } else if (data.type === 'flush') {
  const notes = segmenter?.flush(data.frame) ?? [];
  post({ type: 'onsets', onsets: [], notes, analysedThrough: lastFrame, levelDb: -120, analysisMs: 0 });
 } else if (data.type === 'measure-noise') {
  measuring = { frames: data.frames, chunks: [], collected: 0 };
 }
};
