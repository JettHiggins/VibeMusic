import type { AuditionEvent, ClientMessage, SessionCommand, SessionState, Transport } from '@voicesynth/contracts';

/** Engine surface the editors need (BrowserEngine satisfies it). */
export interface EditorEngine {
 getSession(): SessionState;
 subscribe(listener: (message: ClientMessage) => void): () => void;
 dispatch(command: SessionCommand): ClientMessage;
 /** Optional capability (AuditionEngineAdapter); audition controls are disabled without it. */
 audition?: (event: AuditionEvent) => void;
}

export type Lane = 'kick' | 'snare' | 'closed-hat';
export type Target = SessionState['selected'];
export type TrackId = SessionState['tracks'][number]['id'];

export const LANES: { lane: Lane; label: string }[] = [{ lane: 'kick', label: 'Kick' }, { lane: 'snare', label: 'Snare' }, { lane: 'closed-hat', label: 'Hats' }];
export const TRACK_LABEL: Record<TrackId, string> = { 'synth-1': 'Synth 1', 'synth-2': 'Synth 2', 'synth-3': 'Synth 3', drums: 'Drums' };

export const sameTarget = (a: Target, b: Target) => a.trackId === b.trackId && (a.lane ?? null) === (b.lane ?? null);
export const targetLabel = (t: Target) => t.lane ? LANES.find(l => l.lane === t.lane)!.label : TRACK_LABEL[t.trackId];

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** What the input UI shows: the recording window's target, the armed target during count-in, else the selection. */
export function displayedTarget(session: SessionState, transport: Transport | null): Target {
 const target = transport?.recording ? transport.recordingTarget : transport?.recordingState === 'armed' ? transport.armedTarget : session.selected;
 return target ?? session.selected;
}
/** Drum lane shown for drum targets (kept for the integration seam tests). */
export function displayedLane(session: SessionState, transport: Transport | null): Lane {
 return (displayedTarget(session, transport).lane ?? session.selected.lane ?? 'kick') as Lane;
}

/** Playhead position from a transport snapshot (display only; audio timing lives in the worklet). */
export function playheadStep(t: Transport | null, tempo: number): { step: number; bar: number; beat: number } | null {
 if (!t?.playing) return null;
 const step = Math.floor((t.currentFrame - t.loopStartFrame) / (t.sampleRate * 60 / (tempo * 4)));
 if (step < 0) return null;
 const s = step % 64;
 return { step: s, bar: Math.floor(s / 16) + 1, beat: Math.floor(s % 16 / 4) + 1 };
}
