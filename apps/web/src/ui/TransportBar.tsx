import React, { useEffect, useRef, useState } from 'react';
import type { SessionCommand, SessionState, Transport } from '@voicesynth/contracts';
import { playheadStep, targetLabel, type Target } from './labels.ts';
import { SessionPanel } from './SessionPanel.tsx';
import { C, MONO } from './theme.ts';

type Send = (operation: SessionCommand['operation'], boundary?: SessionCommand['boundary']) => void;

/** Persistent top bar: transport, recording, tempo, position, edit actions, status and the session menu. */
export function TransportBar({ session, transport, enabled, busy, onEnable, send, target, canRecord, recordHint, status, statusError }: {
 session: SessionState; transport: Transport | null; enabled: boolean; busy: boolean; onEnable: () => void; send: Send;
 target: Target; canRecord: boolean; recordHint: string | null; status: string; statusError: boolean;
}) {
 const rec = transport?.recordingState ?? 'idle';
 const pos = playheadStep(transport, session.tempo);
 const pending = transport?.pendingCommandIds.length ?? 0;
 return <header aria-label="Transport" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', background: C.panel, borderBottom: `1px solid ${C.line}` }}>
  <strong style={{ letterSpacing: '.2em', fontSize: 12 }}>VOICESYNTH</strong>
  {!enabled && <button onClick={onEnable} disabled={busy} style={{ background: C.accent, color: '#111' }}>Enable audio</button>}
  <button disabled={!enabled} onClick={() => send({ type: 'play', playing: !transport?.playing })} aria-label={transport?.playing ? 'Stop playback' : 'Play'}>{transport?.playing ? '■ Stop' : '▶ Play'}</button>
  {rec === 'idle'
   ? <button className="rec" disabled={!enabled || !canRecord} title={recordHint ?? undefined} onClick={() => send({ type: 'record', target }, 'next-loop')}>● Rec {targetLabel(target)}</button>
   : <button className="rec on" disabled={!enabled} onClick={() => send({ type: 'stop-recording' })}>■ Stop rec</button>}
  <span style={{ fontFamily: MONO, color: rec === 'idle' ? C.faint : C.rec }}>{rec === 'recording' ? '● REC' : rec === 'armed' ? 'COUNT-IN' : 'REC OFF'}</span>
  <span style={{ width: 1, height: 20, background: C.line }} />
  <button disabled={!enabled} onClick={() => send({ type: 'undo' }, 'next-loop')}>Undo</button>
  <button disabled={!enabled || rec === 'recording'} onClick={() => send({ type: 'clear', target }, 'next-loop')}>Clear {targetLabel(target)}</button>
  <span style={{ width: 1, height: 20, background: C.line }} />
  <button disabled={!enabled || rec === 'recording' || session.tempo <= 40} aria-label="Tempo down" onClick={() => send({ type: 'tempo', bpm: Math.max(40, session.tempo - 1) }, 'next-loop')}>−</button>
  <span style={{ fontFamily: MONO, fontSize: 15 }} aria-label="Tempo">{session.tempo}<span style={{ fontSize: 10, color: C.muted }}> BPM</span></span>
  <button disabled={!enabled || rec === 'recording' || session.tempo >= 240} aria-label="Tempo up" onClick={() => send({ type: 'tempo', bpm: Math.min(240, session.tempo + 1) }, 'next-loop')}>+</button>
  <span style={{ fontFamily: MONO, fontSize: 15, minWidth: 44 }} aria-label="Bar and beat">{pos ? `${pos.bar}.${pos.beat}` : '-.-'}</span>
  {/* One fixed-height line: changing status text must never re-wrap the bar and shift the editor under the pointer. */}
  <span role="status" title={status} style={{ flex: '1 1 160px', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: MONO, fontSize: 11, color: statusError ? C.warn : C.muted }}>
   {pending > 0 && <span style={{ color: C.warn }} title="Changes are applied at the start of the next four-bar loop">{pending} change(s) at next loop · </span>}{status}
  </span>
  <SessionMenu session={session} transport={transport} enabled={enabled} send={send} />
 </header>;
}

/** Session operations (save/load/import/export) in a compact menu instead of a workspace tab. */
function SessionMenu({ session, transport, enabled, send }: { session: SessionState; transport: Transport | null; enabled: boolean; send: Send }) {
 const [open, setOpen] = useState(false);
 const ref = useRef<HTMLDivElement>(null);
 useEffect(() => {
  if (!open) return;
  const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
  window.addEventListener('mousedown', close); window.addEventListener('keydown', esc);
  return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
 }, [open]);
 return <div ref={ref} style={{ position: 'relative' }}>
  <button aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)}>Session ▾</button>
  {open && <div role="dialog" aria-label="Session" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 10, width: 360, background: C.raised, border: `1px solid ${C.lineStrong}`, borderRadius: 6, padding: 12, boxShadow: '0 8px 24px #000a' }}>
   <SessionPanel session={session} transport={transport} enabled={enabled} dispatch={send} />
  </div>}
 </div>;
}
