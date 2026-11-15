import type { PitchSnap, SessionState } from '@voicesynth/contracts';

export const KEY_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

type TrackId = SessionState['tracks'][number]['id'];

/** Short label for the current key, e.g. "D minor", or "Off". */
export function keyLabel(settings: PitchSnap | null | undefined): string {
 return settings ? `${KEY_NAMES[settings.root]} ${settings.scale}` : 'Off';
}

/** Applies a root choice ('off' or '0'..'11') while keeping the chosen scale. */
export function withRoot(settings: PitchSnap | null | undefined, root: string): PitchSnap | null {
 if (root === 'off') return null;
 return { root: Number(root), scale: settings?.scale ?? 'major' };
}

/** Applies a scale choice; a scale without a root keeps the key Off. */
export function withScale(settings: PitchSnap | null | undefined, scale: PitchSnap['scale']): PitchSnap | null {
 return settings ? { root: settings.root, scale } : null;
}

/**
 * Why "snap existing track" is unavailable, or null when it can be sent.
 * The engine requires a key (snap-notes rejects with none) and only synth tracks carry notes.
 */
export function snapBlockedReason(settings: PitchSnap | null | undefined, trackId: TrackId, noteCount: number, enabled: boolean): string | null {
 if (!enabled) return 'Enable audio first';
 if (trackId === 'drums') return 'Drums have no pitch to snap; select a synth';
 if (!settings) return 'Choose a key first';
 if (noteCount === 0) return 'This track has no notes to snap';
 return null;
}
