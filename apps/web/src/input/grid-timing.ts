/**
 * Near-grid timing diagnostic (docs/reviews/PITCH-BOUNDARY-DIAGNOSTIC.md).
 *
 * The engine rounds each start/end to the nearest sixteenth, so a boundary near a rounding
 * threshold (half a step from the grid) can move one cell with a few milliseconds of estimation
 * error. This records, for each captured event, where it actually landed relative to the grid
 * (already latency-compensated, on the engine's grid origin) and how close it was to a threshold.
 * It changes nothing about placement: no snapping, no hidden compensation.
 */
export interface BoundaryTiming {
 /** Rounded grid step the engine will use (unwrapped, relative to the grid origin). */
 step: number;
 /** Signed offset from that step's exact grid time, ms (negative = early, positive = late). */
 offsetMs: number;
 /** Distance to the nearest rounding threshold, ms (0 = exactly on the midpoint). */
 thresholdMs: number;
}
export interface GridTimingEntry {
 kind: 'onset' | 'note';
 midi?: number;
 start: BoundaryTiming;
 end?: BoundaryTiming;
 /** True when any boundary is within `nearMs` of a rounding threshold. */
 nearThreshold: boolean;
}

export const NEAR_THRESHOLD_MS = 10;

export function boundaryTiming(frame: number, gridOrigin: number, tempo: number, sampleRate: number): BoundaryTiming {
 const stepFrames = sampleRate * 60 / (tempo * 4);
 const exact = (frame - gridOrigin) / stepFrames;
 const step = Math.round(exact);
 const stepMs = stepFrames / sampleRate * 1000;
 const offsetMs = (exact - step) * stepMs;
 return { step, offsetMs: round2(offsetMs), thresholdMs: round2(stepMs / 2 - Math.abs(offsetMs)) };
}

export function gridTiming(event: { kind: 'onset' | 'note'; midi?: number; start: number; end?: number }, gridOrigin: number, tempo: number, sampleRate: number, nearMs = NEAR_THRESHOLD_MS): GridTimingEntry {
 const start = boundaryTiming(event.start, gridOrigin, tempo, sampleRate);
 const end = event.end === undefined ? undefined : boundaryTiming(event.end, gridOrigin, tempo, sampleRate);
 return { kind: event.kind, ...(event.midi === undefined ? {} : { midi: event.midi }), start, ...(end ? { end } : {}), nearThreshold: start.thresholdMs < nearMs || (!!end && end.thresholdMs < nearMs) };
}

/** Compact numeric summary for the test report and UI. */
export function summarizeTiming(entries: GridTimingEntry[]) {
 const offsets = entries.map(e => e.start.offsetMs);
 const mean = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : null;
 return {
  events: entries.length,
  nearThreshold: entries.filter(e => e.nearThreshold).length,
  meanStartOffsetMs: mean === null ? null : round2(mean),
  minStartThresholdMs: entries.length ? Math.min(...entries.map(e => e.start.thresholdMs)) : null,
 };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
