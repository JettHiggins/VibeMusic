import React from 'react';
import { C, MONO } from './theme.ts';
import type { RecordingPhase, TakeFeedback } from './recording-phase.ts';

const cell = (on: boolean, strong: boolean, mark: boolean): React.CSSProperties => ({
 width: 14, height: 14, boxSizing: 'border-box', borderRadius: 2, flex: 'none',
 border: `1px solid ${mark ? C.accent : strong ? C.muted : C.lineStrong}`,
 background: on ? C.accent : 'transparent',
});

/**
 * Compact bar/beat preparation strip above the editor: where the loop is, the count-in to the take's
 * first beat and which bar it starts on. Beat cells are decorative; the status line carries the meaning
 * and only changes on phase changes (and count-in numbers), so screen readers are not flooded per beat.
 */
export function RecordingPhaseStrip({ phase }: { phase: RecordingPhase }) {
 const armed = phase.state === 'armed', recording = phase.state === 'recording';
 const countdown = armed && phase.beatsToStart !== null ? Math.min(4, phase.beatsToStart) : null;
 const announce = armed ? phase.headline : recording ? 'Recording' : phase.state === 'playing' ? 'Playing' : 'Stopped';
 return <div className="vs-phase" data-phase={phase.state} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 8px', padding: '5px 8px', borderRadius: 4,
  border: `1px solid ${armed || recording ? C.accent : C.line}`, background: armed ? '#f4f4f514' : 'transparent' }}>
  <span style={{ fontFamily: MONO, fontSize: 13, minWidth: 150, color: armed || recording ? C.accent : C.muted, fontWeight: armed ? 700 : 400 }}>
   {recording ? '● ' : ''}{phase.headline}
  </span>
  <span aria-hidden style={{ display: 'flex', gap: 3 }} title="Beats in this bar">
   {[1, 2, 3, 4].map(b => <span key={b} data-beat={b} style={cell(
    countdown !== null ? b <= 4 - countdown : phase.beat === b, b === 1, false)} />)}
  </span>
  <span aria-hidden style={{ display: 'flex', gap: 3, alignItems: 'center' }} title="Bars in the loop">
   {[1, 2, 3, 4].map(b => <span key={b} data-bar={b} style={{ ...cell(!armed && phase.bar === b, false, armed && phase.start?.bar === b), width: 22, height: 8 }} />)}
  </span>
  <span style={{ color: C.muted, flex: '1 1 180px', minWidth: 0 }}>{phase.detail}</span>
  <span role="status" aria-live="polite" className="vs-sr">{announce}</span>
 </div>;
}

/** One line under the editor: what the recorder holds right now, in the verification mode's own terms. */
export function TakeFeedbackLine({ take, liveName, unit }: { take: TakeFeedback; liveName: string | null; unit: 'note' | 'hit' }) {
 const parts: React.ReactNode[] = [];
 const plural = (n: number) => `${n} ${unit}${n === 1 ? '' : 's'}`;
 if (take.live) parts.push(<span key="live" style={{ color: C.accent }}>Hearing {liveName ?? `a ${unit}`}</span>);
 if (take.waiting) parts.push(<span key="w" title="Released, still only in the browser">{plural(take.waiting)} {take.waitingLabel}</span>);
 if (take.sent) parts.push(<span key="s" title="Sent to the engine, waiting for its acknowledgment">{take.sent} sent</span>);
 parts.push(<span key="c" title="Acknowledged by the engine; part of the composition">{take.saved} saved</span>);
 if (take.notKept) parts.push(<span key="d" title="Heard but not kept by the recorder. It does not report a reason for each one.">{take.notKept} not kept</span>);
 return <div aria-label="Take" style={{ marginTop: 8, fontFamily: MONO, fontSize: 11, color: C.muted }}>
  <div>{parts.flatMap((p, i) => i ? [' · ', p] : [p])}</div>
  {take.reason && <div style={{ color: C.warn, marginTop: 2, fontFamily: 'inherit' }}>{take.reason}</div>}
 </div>;
}
