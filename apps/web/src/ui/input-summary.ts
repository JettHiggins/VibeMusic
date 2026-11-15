import { snapMidiToScale, type PitchSnap } from '@voicesynth/contracts';
import type { VoiceInputState } from '../input/voice-input.ts';
import { noteName } from './labels.ts';
import { keyLabel } from './pitch-snap-ui.ts';

export type Tone = 'ok' | 'warn' | 'alert' | 'muted';
export interface InputNotice { id: string; tone: Tone; text: string; action?: 'setup' }
export interface PitchReadout {
 /** Raw detected pitch, never snapped (or a dash when nothing is pitched). */
 heard: string;
 /** What a note would be written as with the active key, only when it differs from the heard pitch. */
 output: string | null;
 /** Short gate/confidence state, from existing readings only. */
 gate: string;
 tone: Tone;
 detail: string | null;
}
export interface InputSummary {
 status: { label: string; tone: Tone };
 level: { db: number; floorDb: number | null; gateDb: number | null; active: boolean };
 pitch: PitchReadout | null;
 hit: string | null;
 key: string;
 notices: InputNotice[];
}

const STATUS = { ok: 'Level OK', 'too-quiet': 'Too quiet', 'no-signal': 'No signal', clipping: 'Clipping' } as const;

/**
 * Condenses VoiceInputState into the always-visible input summary: mic status, level against the
 * room floor and note gate, the raw heard pitch versus the key-mapped output, and a prioritized list
 * of actionable notices. Uses existing readings only; nothing here is a new measurement.
 */
export function summarizeInput(state: VoiceInputState, melodic: boolean, pitchSnap: PitchSnap | null | undefined): InputSummary {
 const check = state.micCheck, reading = check?.pitch ?? null;
 const live = state.microphone === 'on' || state.microphone === 'test-signal';
 const status: InputSummary['status'] = state.microphone === 'off' ? { label: 'Microphone off', tone: 'muted' }
  : state.microphone === 'starting' ? { label: 'Starting microphone…', tone: 'muted' }
  : state.microphone === 'test-signal' ? { label: 'Test signal', tone: 'ok' }
  : !check ? { label: 'Listening…', tone: 'muted' }
  : { label: STATUS[check.verdict], tone: check.verdict === 'ok' ? 'ok' : check.verdict === 'clipping' ? 'alert' : 'warn' };

 let pitch: PitchReadout | null = null;
 if (melodic && live) {
  if (!reading || reading.state === 'silent') pitch = { heard: '—', output: null, gate: 'Silent', tone: 'muted', detail: null };
  else if (reading.state === 'quiet') pitch = { heard: '—', output: null, gate: 'Below note level', tone: 'warn', detail: `${reading.levelDb.toFixed(0)} of ${reading.gateDb.toFixed(0)} dBFS needed` };
  else if (reading.state === 'unclear' || reading.midi === null) pitch = { heard: '?', output: null, gate: 'Pitch unclear', tone: 'warn', detail: `clarity ${reading.clarity.toFixed(2)}` };
  else {
   const out = snapMidiToScale(reading.midi, pitchSnap ?? null);
   pitch = { heard: noteName(reading.midi), output: out !== reading.midi ? noteName(out) : null, gate: reading.holding ? 'Holding note' : 'Pitch detected', tone: 'ok', detail: `clarity ${reading.clarity.toFixed(2)}` };
  }
 }
 const hit = !melodic && live && check?.lastOnset
  ? `Last hit ${check.lastOnset.levelDb.toFixed(0)} dBFS${check.lastOnset.accepted ? '' : ' · weak'} · ${check.onsetsDetected} detected` : null;

 const notices: InputNotice[] = [];
 const add = (notice: InputNotice | null | false | undefined) => { if (notice && notice.text && !notices.some(n => n.text === notice.text)) notices.push(notice); };
 add(state.message ? { id: 'input', tone: 'alert', text: state.message } : null);
 add(state.speech.enabled && state.speech.status === 'unavailable' && { id: 'speech', tone: 'alert', text: state.speech.message ?? 'Speech recognition is unavailable.' });
 add(state.recorder.lastError ? { id: 'take', tone: 'warn', text: state.recorder.lastError } : null);
 add(state.calibrationResult && !state.calibrationResult.ok && !state.calibrationRun && !state.silenceRun && { id: 'calibration', tone: 'warn', text: state.calibrationResult.text, action: 'setup' });
 add(state.microphone === 'on' && !state.readiness.ready && { id: 'readiness', tone: 'warn', text: state.readiness.advice, action: 'setup' });
 add(state.microphone === 'on' && check && check.verdict !== 'ok' && { id: 'level', tone: check.verdict === 'clipping' ? 'alert' : 'warn', text: check.advice });
 add(melodic && state.microphone === 'on' && (reading?.state === 'quiet' || reading?.state === 'unclear') && { id: 'pitch', tone: 'warn', text: check!.pitchAdvice });

 return {
  status,
  level: { db: state.levelDb, floorDb: state.calibration?.noiseFloorDb ?? null, gateDb: reading?.gateDb ?? null, active: live },
  pitch, hit, key: keyLabel(pitchSnap), notices,
 };
}

/** Compact take counters; null when there is nothing to report. */
export function takeLine(state: VoiceInputState, melodic: boolean): string | null {
 const heard = state.recorder.provisional.filter(p => p.status === 'provisional').length;
 const queued = state.recorder.provisional.filter(p => p.status === 'submitted').length;
 const { committed, dropped } = state.recorder;
 if (!heard && !queued && !committed && !dropped && !state.recorder.capturing) return null;
 const unit = melodic ? 'note' : 'hit';
 return `${heard} ${unit}${heard === 1 ? '' : 's'} heard · ${queued} queued · ${committed} committed${dropped ? ` · ${dropped} ignored` : ''}`;
}
