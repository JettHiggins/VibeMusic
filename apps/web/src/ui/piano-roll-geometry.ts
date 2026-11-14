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
export function cellAt(x: number, y: number, width: number, rowHeight: number, rows: number[]): { step: number; midi: number } | null {
 if (x < 0 || y < 0 || x >= width) return null;
 const row = Math.floor(y / rowHeight);
 if (row >= rows.length) return null;
 return { step: Math.min(STEPS - 1, Math.floor(x / (width / STEPS))), midi: rows[row] };
}

export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
