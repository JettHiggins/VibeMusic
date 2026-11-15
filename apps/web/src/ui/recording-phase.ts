import type { Transport } from '@voicesynth/contracts';
import type { RecorderStatus, VerificationMode } from '../input/recorder.ts';

/** Bar/beat position of a sample frame in the four-bar loop (1-based), or null before the loop origin. */
export function framePosition(frame: number, t: Pick<Transport, 'loopStartFrame' | 'sampleRate'>, tempo: number): { bar: number; beat: number; step: number } | null {
 const framesPerStep = t.sampleRate * 60 / (tempo * 4);
 const raw = Math.floor((frame - t.loopStartFrame) / framesPerStep + 1e-9);
 if (raw < 0) return null;
 const step = raw % 64;
 return { step, bar: Math.floor(step / 16) + 1, beat: Math.floor(step % 16 / 4) + 1 };
}

export interface RecordingPhase {
 state: 'stopped' | 'playing' | 'armed' | 'recording';
 /** Current position while the transport runs. */
 bar: number | null;
 beat: number | null;
 /** Whole beats until capture opens (armed only). */
 beatsToStart: number | null;
 /** Where the take starts in the loop (armed only, when the engine published the start frame). */
 start: { bar: number; beat: number } | null;
 headline: string;
 detail: string;
}

/**
 * Preparation/phase summary from the transport the engine already publishes (≈ every 2048 samples):
 * stopped → playing → armed (count-in / next beat) → recording. Display only; audio timing stays in the worklet.
 */
export function recordingPhase(t: Transport | null, tempo: number, target: string): RecordingPhase {
 const none = { bar: null, beat: null, beatsToStart: null, start: null };
 if (!t) return { state: 'stopped', ...none, headline: 'Stopped', detail: 'Enable audio to record.' };
 const rec = t.recordingState ?? (t.recording ? 'recording' : 'idle');
 const pos = t.playing ? framePosition(t.currentFrame, t, tempo) : null;
 const here = { bar: pos?.bar ?? null, beat: pos?.beat ?? null };
 if (rec === 'armed') {
  const framesPerBeat = t.sampleRate * 60 / tempo;
  const fromFrame = t.armedStartFrame !== undefined ? Math.max(0, Math.ceil((t.armedStartFrame - t.currentFrame) / framesPerBeat - 1e-6)) : null;
  const beatsToStart = t.countInBeatsRemaining ?? fromFrame;
  const startPos = t.armedStartFrame !== undefined ? framePosition(t.armedStartFrame, t, tempo) : null;
  const start = startPos ? { bar: startPos.bar, beat: startPos.beat } : null;
  const headline = t.countInBeatsRemaining !== undefined ? `Count-in ${t.countInBeatsRemaining}` : beatsToStart ? `Starts in ${beatsToStart} beat${beatsToStart === 1 ? '' : 's'}` : 'Starting now';
  return { state: 'armed', ...here, beatsToStart, start, headline, detail: start ? `Get ready: ${target} records from bar ${start.bar}, beat ${start.beat}.` : `Get ready: ${target} records from the next beat.` };
 }
 if (rec === 'recording') {
  return { state: 'recording', ...here, beatsToStart: null, start: null, headline: pos ? `Recording · bar ${pos.bar}, beat ${pos.beat}` : 'Recording',
   detail: target === 'Drums' ? 'Drums are recording; beatbox now.' : `${target} is recording; sing over a phrase to replace it.` };
 }
 if (t.playing) return { state: 'playing', ...here, beatsToStart: null, start: null, headline: pos ? `Bar ${pos.bar}, beat ${pos.beat}` : 'Playing', detail: 'Record starts on the next beat.' };
 return { state: 'stopped', ...none, headline: 'Stopped', detail: 'Record plays a one-bar count-in first.' };
}

export interface TakeFeedback {
 live: number;
 /** Released notes still in the browser: waiting for the speech check (speech mode) or the next batch (manual). */
 waiting: number;
 /** Sent to the engine, not yet acknowledged. */
 sent: number;
 saved: number;
 notKept: number;
 waitingLabel: string;
 /** The recorder's own last reason text, when it set one. Never inferred from the counters. */
 reason: string | null;
}

/** Live / waiting / sent / saved counts with labels that match the actual verification mode. */
export function takeFeedback(r: RecorderStatus, live: boolean): TakeFeedback {
 const waiting = r.provisional.filter(p => p.status === 'provisional').length;
 const sent = r.provisional.filter(p => p.status === 'submitted').length;
 return { live: live && r.live ? 1 : 0, waiting, sent, saved: r.committed, notKept: r.dropped, waitingLabel: waitingLabel(r.mode), reason: r.lastError };
}

export const waitingLabel = (mode: VerificationMode) => mode === 'speech' ? 'waiting for speech check' : 'waiting to be sent';

/** Per-take baseline: the recorder's counters run for the whole microphone session. */
export interface TakeTracker { startFrame: number | null; epoch: number | null; baseSaved: number; baseNotKept: number; unsaved: number; reset: string | null }
export const emptyTracker: TakeTracker = { startFrame: null, epoch: null, baseSaved: 0, baseNotKept: 0, unsaved: 0, reset: null };

/**
 * Advance the tracker from the latest transport/recorder snapshot. A new recordingStartFrame is a new take.
 * A new recordingEpoch inside the same take is the engine's live-edit restart (Undo, or Clear of the recording
 * target, during capture), which discards notes not yet saved; that is reported from the epoch itself.
 */
export function trackTake(prev: TakeTracker, t: Transport | null, r: RecorderStatus): TakeTracker {
 const unsaved = r.provisional.length + (r.live ? 1 : 0);
 const start = t?.recordingStartFrame ?? null, epoch = t?.recordingEpoch ?? null;
 if (start !== null && start !== prev.startFrame) return { startFrame: start, epoch, baseSaved: r.committed, baseNotKept: r.dropped, unsaved, reset: null };
 // Counters only grow for one recorder; a smaller value means a new microphone session.
 const rebase = r.committed < prev.baseSaved || r.dropped < prev.baseNotKept;
 const base = rebase ? { baseSaved: r.committed, baseNotKept: r.dropped } : { baseSaved: prev.baseSaved, baseNotKept: prev.baseNotKept };
 if (start !== null && epoch !== null && prev.epoch !== null && epoch !== prev.epoch) {
  const n = prev.unsaved;
  // Counts restart too: Undo may have removed notes this take already saved.
  return { ...prev, baseSaved: r.committed, baseNotKept: r.dropped, epoch, unsaved, reset: n ? `Undo/Clear restarted capture; ${n} unsaved ${n === 1 ? 'entry was' : 'entries were'} discarded. Counts restart here.` : 'Undo/Clear restarted capture; counts restart here.' };
 }
 return { ...prev, ...base, epoch: epoch ?? prev.epoch, unsaved };
}

/** Feedback for the current take: counts since its start, with the recorder's own error first. */
export function currentTake(r: RecorderStatus, tracker: TakeTracker): TakeFeedback {
 const f = takeFeedback(r, true);
 return { ...f, saved: Math.max(0, r.committed - tracker.baseSaved), notKept: Math.max(0, r.dropped - tracker.baseNotKept), reason: r.lastError ?? tracker.reset };
}
