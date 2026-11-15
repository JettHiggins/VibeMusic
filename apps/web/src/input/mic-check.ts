import type { AnalysisFrame } from './microphone.ts';
import type { PitchReading } from './pitch.ts';
import { pitchGateDb, MIN_PITCH_CLARITY } from './pitch.ts';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const name = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

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
 /** Latest live pitch reading (melody capture diagnosis). */
 pitch: PitchReading | null;
 /** Why sung input does or does not become notes right now. */
 pitchAdvice: string;
 /** Recent confident sung level, compared with the measured room floor. */
 foregroundDb: number | null;
 foregroundMarginDb: number | null;
 foregroundAdvice: string;
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
 private pitch: { reading: PitchReading; frame: number } | null = null;
 private foreground: { frame: number; db: number }[] = [];

 constructor(private sampleRate: number, private windowSeconds = 2) {}

 reset() { this.peaks = []; this.onsets = 0; this.notes = 0; this.lastOnset = null; this.lastNote = null; this.pitch = null; this.foreground = []; }

 add(frame: AnalysisFrame) {
  // Expire by real processed capture time. analysedThrough is held at the start of a sustained
  // sung note (verification coverage), which would freeze the window and keep stale readings.
  const now = frame.processedThrough ?? frame.analysedThrough;
  this.peaks.push({ frame: now, db: frame.levelDb });
  const oldest = now - this.windowSeconds * this.sampleRate;
  while (this.peaks.length && this.peaks[0].frame < oldest) this.peaks.shift();
  while (this.foreground.length && this.foreground[0].frame < oldest) this.foreground.shift();
  for (const o of frame.onsets) { this.onsets++; this.lastOnset = { levelDb: o.levelDb, confidence: o.confidence, accepted: o.confidence >= MIN_CONFIDENCE }; }
  // Keep the most informative recent reading: a usable pitch outranks a quieter or unclear one for ~0.3 s.
  if (frame.pitch) {
   const rank = { silent: 0, quiet: 1, unclear: 2, pitch: 3 } as const;
   const fresh = !this.pitch || now - this.pitch.frame > 0.3 * this.sampleRate || rank[frame.pitch.state] >= rank[this.pitch.reading.state];
   if (fresh) this.pitch = { reading: frame.pitch, frame: now };
   if (frame.pitch.midi !== null && frame.pitch.clarity >= MIN_PITCH_CLARITY) this.foreground.push({ frame: now, db: frame.pitch.levelDb });
  }
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
  const p = this.pitch?.reading ?? null;
  const foregroundDb = this.foreground.length >= Math.ceil(this.sampleRate / 1024 * 0.5) ? this.percentile(this.foreground.map(x => x.db), 0.5) : null;
  const foregroundMarginDb = foregroundDb === null ? null : foregroundDb - noiseFloorDb;
  const requiredMarginDb = pitchGateDb(noiseFloorDb, p?.clarity ?? 0, false) - noiseFloorDb;
  const foregroundAdvice = foregroundMarginDb === null
   ? 'Sing a steady note at your usual volume for about 1 second to measure it against the room.'
   : foregroundMarginDb < requiredMarginDb
    ? `Your normal-volume voice is ${foregroundMarginDb.toFixed(0)} dB above room noise; notes need about ${requiredMarginDb} dB. Move closer to the mic or reduce room noise, then recheck.`
    : `Your normal-volume voice is ${foregroundMarginDb.toFixed(0)} dB above room noise and clears the pitch level gate. If notes still do not appear, check pitch stability and speech verification.`;
  const pitchAdvice = !p || p.state === 'silent' ? 'Sing or hum a steady note to check pitch detection.'
   : p.state === 'quiet' ? `Voice heard at ${p.levelDb.toFixed(0)} dBFS but notes need ${p.gateDb.toFixed(0)} dBFS: sing louder or closer${noisyRoom ? ', or reduce room noise and Measure silence again' : ''}.`
   : p.state === 'unclear' ? `Pitch unclear (clarity ${p.clarity.toFixed(2)}, needs 0.80): sing a steady vowel like "ooh" instead of speaking or breathing.`
   : `Hearing ${name(p.midi!)} (clarity ${p.clarity.toFixed(2)})${p.holding ? ': note being held' : ''}. Notes need about 70 ms of steady pitch.`;
  return { peakDb, verdict, noisyRoom, onsetsDetected: this.onsets, lastOnset: this.lastOnset, notesDetected: this.notes, lastNote: this.lastNote, advice, pitch: p, pitchAdvice, foregroundDb, foregroundMarginDb, foregroundAdvice };
 }

 private percentile(values: number[], p: number) { values.sort((a, b) => a - b); return values[Math.floor((values.length - 1) * p)]; }
}
