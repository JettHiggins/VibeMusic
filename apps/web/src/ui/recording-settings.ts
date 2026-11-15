import { RHYTHM_CELLS, type ChordMode, type PitchSnap, type RhythmSnap, type SessionState } from '@voicesynth/contracts';
import { keyLabel } from './pitch-snap-ui.ts';

type TrackId = SessionState['tracks'][number]['id'];

/** PLAYTEST-CONTROLS-CONTRACT.md: missing rhythmSnap is sixteenth, missing chordMode is off. */
export const rhythmOf = (s: Pick<SessionState, 'rhythmSnap'>): RhythmSnap => s.rhythmSnap ?? 'sixteenth';
export const chordOf = (s: Pick<SessionState, 'chordMode'>): ChordMode => s.chordMode ?? 'off';

export const GRID_OPTIONS: { value: RhythmSnap; label: string; name: string }[] = [
 { value: 'sixteenth', label: '1/16', name: 'sixteenth notes' },
 { value: 'eighth', label: '1/8', name: 'eighth notes' },
 { value: 'quarter', label: '1/4', name: 'quarter notes (beats)' },
];

/**
 * Plain-language explanation of the recording grid. The engine fixes a take's grid when the take starts,
 * so a change during capture applies from the next take (`takeGrid` is the grid in force for this take).
 */
export function gridHint(grid: RhythmSnap, takeGrid: RhythmSnap | null): string {
 const opt = GRID_OPTIONS.find(o => o.value === grid)!;
 if (takeGrid && takeGrid !== grid) return `This take keeps ${GRID_OPTIONS.find(o => o.value === takeGrid)!.label}; ${opt.label} applies from the next take.`;
 const cells = RHYTHM_CELLS[grid];
 return cells === 1 ? 'New notes land on the nearest sixteenth (quick pairs kept).'
  : `New notes land on the nearest ${opt.name}; quicker notes merge onto the same ${cells === 4 ? 'beat' : 'eighth'}.`;
}

/** Why chord mode cannot be set here, or null. Chords only apply to newly sung synth notes. */
export function chordBlocked(trackId: TrackId, enabled: boolean): string | null {
 if (!enabled) return 'Enable audio first';
 if (trackId === 'drums') return 'Chords apply to sung synth notes; select a synth';
 return null;
}

export function chordHint(mode: ChordMode, key: PitchSnap | null | undefined): string {
 if (mode === 'off') return 'New sung notes stay single notes.';
 return key ? `New sung notes become ${keyLabel(key)} triads (root, third, fifth in key).` : 'New sung notes become major triads; choose a key for in-key triads.';
}
