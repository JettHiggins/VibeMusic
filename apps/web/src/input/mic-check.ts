import type { AnalysisFrame } from './microphone.ts';

/**
 * Live input check for real-microphone testing, shown before and between takes. It answers the
 * questions testers actually hit: is anything arriving, is it loud enough to cross the detection
 * gate, is it clipping, is the room too noisy, and are hits or sung notes being detected at all.
 * Numbers only; no audio is kept.
 */
export type MicVerdict = 'no-signal' | 'too-quiet' | 'ok' | 'clipping';
export interface MicCheckState {
 /** Highest block peak in the recent window, dBFS. */
 peakDb: number;
 verdict: MicVerdict;
 /** The measured floor is high enough that quiet hits will be lost. */
 noisyRoom: boolean;
 onsetsDetected: number;
 lastOnset: { levelDb: number; confidence: number; accepted: boolean } | null;
 notesDetected: number;
 lastNote: { midi: number; durationMs: number; confidence: number } | null;
 advice: string;
}

/** Engine minimum confidence (CONTRACTS.md); below it a detection is ignored. */
const MIN_CONFIDENCE = 0.6;
/** Onset detector gate above the noise floor (OnsetDetector default). */
const GATE_DB = 12;

export class MicCheck {
 private peaks: { frame: number; db: number }[] = [];
 private onsets = 0;
 private notes = 0;
 private lastOnset: MicCheckState['lastOnset'] = null;
 private lastNote: MicCheckState['lastNote'] = null;

 constructor(private sampleRate: number, private windowSeconds = 2) {}

 reset() { this.peaks = []; this.onsets = 0; this.notes = 0; this.lastOnset = null; this.lastNote = null; }

 add(frame: AnalysisFrame) {
  this.peaks.push({ frame: frame.analysedThrough, db: frame.levelDb });
  const oldest = frame.analysedThrough - this.windowSeconds * this.sampleRate;
  while (this.peaks.length && this.peaks[0].frame < oldest) this.peaks.shift();
  for (const o of frame.onsets) { this.onsets++; this.lastOnset = { levelDb: o.levelDb, confidence: o.confidence, accepted: o.confidence >= MIN_CONFIDENCE }; }
  for (const n of frame.notes) { this.notes++; this.lastNote = { midi: n.midi, durationMs: (n.endFrame - n.startFrame) / this.sampleRate * 1000, confidence: n.confidence }; }
 }

 state(noiseFloorDb: number): MicCheckState {
  const peakDb = this.peaks.length ? Math.max(...this.peaks.map(p => p.db)) : -Infinity;
  const noisyRoom = noiseFloorDb > -45;
  let verdict: MicVerdict;
  if (peakDb > -1) verdict = 'clipping';
  else if (peakDb < noiseFloorDb + 6) verdict = 'no-signal';
  else if (peakDb < noiseFloorDb + GATE_DB + 3) verdict = 'too-quiet';
  else verdict = 'ok';
  const advice = verdict === 'clipping' ? 'Input is clipping: move back from the mic or lower its input level.'
   : verdict === 'no-signal' ? 'Nothing above the background yet: beatbox or sing into the mic (check the selected device).'
   : verdict === 'too-quiet' ? `Too quiet: hits must peak above ${(noiseFloorDb + GATE_DB).toFixed(0)} dBFS to be detected. Perform louder or move closer.`
   : noisyRoom ? 'Level is good, but the room is noisy: quiet hits and soft notes may be missed.'
   : this.lastOnset && !this.lastOnset.accepted ? 'Hits are detected but weak; make them sharper and louder.'
   : 'Level is good.';
  return { peakDb, verdict, noisyRoom, onsetsDetected: this.onsets, lastOnset: this.lastOnset, notesDetected: this.notes, lastNote: this.lastNote, advice };
 }
}
