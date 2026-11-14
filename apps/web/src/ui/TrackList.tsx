import React, { useEffect, useRef, useState } from 'react';
import type { SessionCommand, SessionState } from '@voicesynth/contracts';
import type { FirmwareMetadata } from '../engine/metadata.ts';
import { TRACK_LABEL, type TrackId } from './labels.ts';
import { C, MONO } from './theme.ts';

type Send = (operation: SessionCommand['operation'], boundary?: SessionCommand['boundary']) => void;

/** Left column: tracks with selection, sound name, content count, mute and live volume. */
export function TrackList({ session, metadata, selected, enabled, locked, onSelect, send }: {
 session: SessionState; metadata: FirmwareMetadata | null; selected: TrackId; enabled: boolean; locked: boolean;
 onSelect: (id: TrackId) => void; send: Send;
}) {
 return <nav aria-label="Tracks" style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
  <h2>Tracks</h2>
  {session.tracks.map(track => {
   const engine = metadata?.engines[track.patch.engine];
   const sound = track.id === 'drums' ? 'Drum kit' : engine ? `${engine.name} · ${engine.presets[track.patch.preset]?.name ?? ''}` : '—';
   const isSel = track.id === selected;
   return <div key={track.id} style={{ background: isSel ? C.raised : 'transparent', border: `1px solid ${isSel ? C.accent : C.line}`, borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
    <button aria-pressed={isSel} disabled={!enabled || locked} onClick={() => onSelect(track.id)} style={{ all: 'unset', cursor: enabled && !locked ? 'pointer' : 'default', display: 'grid', gap: 2 }}>
     <span style={{ fontWeight: 600 }}>{TRACK_LABEL[track.id]}</span>
     <span style={{ fontSize: 11, fontFamily: MONO, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sound}</span>
     <span style={{ fontSize: 11, color: C.faint }}>{track.id === 'drums' ? `${track.hits.length} hits` : `${track.notes.length} notes`}</span>
    </button>
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
     <button aria-pressed={track.muted} aria-label={`Mute ${TRACK_LABEL[track.id]}`} disabled={!enabled} onClick={() => send({ type: 'mute', trackId: track.id, muted: !track.muted })} style={{ padding: '2px 7px' }}>M</button>
     <Volume value={track.volume} disabled={!enabled} label={`${TRACK_LABEL[track.id]} volume`} onChange={v => send({ type: 'volume', trackId: track.id, volume: v })} />
    </div>
   </div>;
  })}
 </nav>;
}

/** Volume follows the slider while dragging (throttled to ~10 commands per second). */
function Volume({ value, disabled, label, onChange }: { value: number; disabled: boolean; label: string; onChange: (v: number) => void }) {
 const [v, setV] = useState(value);
 const last = useRef(0), pending = useRef<ReturnType<typeof setTimeout> | null>(null), dragging = useRef(false);
 useEffect(() => { if (!dragging.current) setV(value); }, [value]);
 const commit = (next: number, force = false) => {
  const now = performance.now();
  if (pending.current) { clearTimeout(pending.current); pending.current = null; }
  if (force || now - last.current >= 100) { last.current = now; onChange(next); }
  else pending.current = setTimeout(() => { last.current = performance.now(); onChange(next); }, 100 - (now - last.current));
 };
 return <input type="range" aria-label={label} min={0} max={1} step={0.01} value={v} disabled={disabled} style={{ flex: 1, minWidth: 0 }}
  onPointerDown={() => { dragging.current = true; }}
  onChange={e => { const next = Number(e.target.value); setV(next); commit(next); }}
  onPointerUp={() => { dragging.current = false; commit(v, true); }} onKeyUp={() => commit(v, true)} />;
}
