import React from 'react';
import type { SessionState } from '@voicesynth/contracts';
import { toggleHit, type PatternOp } from './pattern-edit.ts';
import { LANES, type Lane } from './labels.ts';
import { C } from './theme.ts';

type Hit = SessionState['tracks'][number]['hits'][number];

/**
 * Drum step lanes: one row of 64 steps per lane. Click a step to toggle it; click a lane name to
 * select it as the recording lane and hear it.
 */
export function DrumGrid({ hits, provisional, playhead, lane, disabled, onEdit, onSelectLane, onAudition }: {
 hits: Hit[]; provisional: { lane: Lane; step: number }[]; playhead: number | null; lane: Lane; disabled: boolean;
 onEdit: (op: PatternOp) => void; onSelectLane: (lane: Lane) => void; onAudition?: (lane: Lane) => void;
}) {
 return <div aria-label="Drum step sequencer">
  {LANES.map(({ lane: l, label }) => <div key={l} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0' }}>
   <button aria-pressed={lane === l} title="Select as the recording lane and audition" disabled={disabled} style={{ width: 64, flex: 'none' }} onClick={() => { onSelectLane(l); onAudition?.(l); }}>{label}</button>
   <div role="row" aria-label={`${label} steps`} style={{ display: 'grid', gridTemplateColumns: 'repeat(64, 1fr)', gap: 1, flex: 1, minWidth: 0 }}>
    {Array.from({ length: 64 }, (_, step) => {
     const on = hits.some(h => h.lane === l && h.step === step);
     const pending = provisional.some(p => p.lane === l && p.step === step);
     return <button key={step} role="gridcell" aria-pressed={on} aria-label={`${label} step ${step + 1}`} disabled={disabled} onClick={() => onEdit(toggleHit(l, step))}
      style={{ height: 24, padding: 0, minWidth: 0, borderRadius: 2, border: pending ? `1px dashed ${C.pending}` : `1px solid ${playhead === step ? C.accent : 'transparent'}`,
       background: on ? C.note : step % 16 === 0 ? '#2c2c31' : step % 4 === 0 ? '#232327' : '#1a1a1d' }} />;
    })}
   </div>
  </div>)}
 </div>;
}
