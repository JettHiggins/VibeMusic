/** Pure geometry for the synth piano roll: visible pitch range, centering and pointer mapping. */
export const STEPS = 64;
export const DEFAULT_ROWS = 25;

/** Empty rolls center on C4; existing rolls center on the median note. */
export function centerPitch(notes: { midi: number }[]): number {
 if (!notes.length) return 60;
 const sorted = notes.map(n => n.midi).sort((a, b) => a - b);
 return sorted[sorted.length >> 1];
}

/** Highest-first list of visible MIDI rows around `center`, clamped to 0..127. */
export function visibleRows(center: number, rows = DEFAULT_ROWS): number[] {
 const half = Math.floor(rows / 2);
 const top = Math.max(rows - 1, Math.min(127, Math.round(center) + half));
 return Array.from({ length: rows }, (_, i) => top - i);
}

/** Map a pointer position inside the grid to a step (0..63) and the row's MIDI note. */
export function cellAt(x: number, y: number, width: number, rowHeight: number, rows: number[], steps = STEPS): { step: number; midi: number } | null {
 if (x < 0 || y < 0 || x >= width) return null;
 const row = Math.floor(y / rowHeight);
 if (row >= rows.length) return null;
 return { step: Math.min(steps - 1, Math.floor(x / (width / steps))), midi: rows[row] };
}

export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

/** Where a pitch sits relative to the visible rows. */
export function rangeSide(midi: number, rows: number[]): 'above' | 'below' | null {
 if (!rows.length) return null;
 return midi > rows[0] ? 'above' : midi < rows[rows.length - 1] ? 'below' : null;
}

/** Off-view notes grouped by side, each side ordered nearest-first, so edge markers can name them. */
export function offRange<T extends { midi: number }>(notes: T[], rows: number[]): { above: T[]; below: T[] } {
 const above = notes.filter(n => rangeSide(n.midi, rows) === 'above').sort((a, b) => a.midi - b.midi);
 const below = notes.filter(n => rangeSide(n.midi, rows) === 'below').sort((a, b) => b.midi - a.midi);
 return { above, below };
}

export const MIN_CENTER = 12, MAX_CENTER = 115;

/**
 * Center that brings `midi` into view at least `margin` rows from an edge, moving in whole octaves so
 * the C labels and the user's octave orientation stay put. Returns `center` unchanged when the note is
 * already comfortably visible.
 */
export function followCenter(center: number, midi: number, rows = DEFAULT_ROWS, margin = 2): number {
 const inView = (c: number) => { const r = visibleRows(c, rows); return midi <= r[0] - margin && midi >= r[r.length - 1] + margin; };
 let c = center;
 for (let i = 0; i < 11 && !inView(c); i++) {
  const next = Math.max(MIN_CENTER, Math.min(MAX_CENTER, c + (midi > c ? 12 : -12)));
  if (next === c) break;
  c = next;
 }
 return c;
}
