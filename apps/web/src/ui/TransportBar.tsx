import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionCommand, SessionState, Transport } from '@voicesynth/contracts';
import { playheadStep, targetLabel, type Target } from './labels.ts';
import { SessionPanel } from './SessionPanel.tsx';
import { Icon } from './Icon.tsx';
import { C } from './theme.ts';

type Send = (operation: SessionCommand['operation'], boundary?: SessionCommand['boundary']) => void;

export function TransportBar({ session, transport, enabled, busy, onEnable, send, target, canRecord, recordHint, status, statusError, voiceControl, onTiming }: {
 session: SessionState; transport: Transport | null; enabled: boolean; busy: boolean; onEnable: () => void; send: Send;
 target: Target; canRecord: boolean; recordHint: string | null; status: string; statusError: boolean; voiceControl?: ReactNode; onTiming?: () => void;
}) {
 const rec = transport?.recordingState ?? 'idle';
 const pos = playheadStep(transport, session.tempo);
 const metronomeEnabled = transport?.metronomeEnabled ?? true;
 const metronomeSupported = transport?.metronomeEnabled !== undefined;
 return <header aria-label="Transport" className="vs-toolbar">
  <div className="vs-toolbar-controls">
   {!enabled && <button className="vs-icon-button vs-primary" onClick={onEnable} disabled={busy} aria-label="Enable audio" title="Enable audio"><Icon name="audio" /></button>}
   <button className="vs-icon-button" disabled={!enabled} onClick={() => send({ type: 'play', playing: !transport?.playing })} aria-label={transport?.playing ? 'Stop playback' : 'Play'} title={transport?.playing ? 'Stop playback' : 'Play'}><Icon name={transport?.playing ? 'stop' : 'play'} /></button>
   <button className={`vs-icon-button rec${rec !== 'idle' ? ' on' : ''}`} disabled={!enabled || (rec === 'idle' && !canRecord)} title={rec === 'idle' ? recordHint ?? `Record ${targetLabel(target)}` : 'Stop recording'}
    aria-label={rec === 'idle' ? `Record ${targetLabel(target)}` : 'Stop recording'} aria-pressed={rec !== 'idle'} onClick={() => rec === 'idle' ? send({ type: 'record', target }, 'next-beat') : send({ type: 'stop-recording' })}><Icon name={rec === 'idle' ? 'record' : 'stop'} /></button>
   <button className="vs-icon-button" aria-label="Metronome" aria-pressed={metronomeEnabled} disabled={!enabled || !metronomeSupported} title="Metronome" onClick={() => send({ type: 'metronome', enabled: !metronomeEnabled })}><Icon name="metronome" /></button>
   <span className="vs-toolbar-divider" aria-hidden="true" />
   <button className="vs-icon-button" disabled={!enabled} aria-label="Undo" title="Undo" onClick={() => send({ type: 'undo' })}><Icon name="undo" /></button>
   <button className="vs-icon-button" disabled={!enabled} aria-label={`Clear ${targetLabel(target)}`} title={`Clear ${targetLabel(target)} · Undo to restore`} onClick={() => send({ type: 'clear', target })}><Icon name="clear" /></button>
   <span className="vs-toolbar-divider" aria-hidden="true" />
   <div className="vs-tempo">
    <button className="vs-icon-button" disabled={!enabled || rec === 'recording' || session.tempo <= 40} aria-label="Tempo down" title="Slower" onClick={() => send({ type: 'tempo', bpm: Math.max(40, session.tempo - 1) }, 'next-loop')}>−</button>
    <span aria-label="Tempo">{session.tempo}<small>BPM</small></span>
    <button className="vs-icon-button" disabled={!enabled || rec === 'recording' || session.tempo >= 240} aria-label="Tempo up" title="Faster" onClick={() => send({ type: 'tempo', bpm: Math.min(240, session.tempo + 1) }, 'next-loop')}>+</button>
   </div>
   <span className="vs-position" aria-label="Bar and beat">{pos ? `${pos.bar}.${pos.beat}` : '1.1'}</span>
   <span className="vs-toolbar-divider" aria-hidden="true" />
   {voiceControl}
   <button className="vs-icon-button" aria-label="Timing test" title="Timing test" disabled={!enabled} onClick={onTiming}><Icon name="timing" /></button>
   <SessionMenu session={session} transport={transport} enabled={enabled} send={send} />
  </div>
  {statusError && status && <div className="vs-toolbar-error" role="alert">{status}</div>}
 </header>;
}

/** Session operations (save/load/import/export) in a compact menu instead of a workspace tab. */
function SessionMenu({ session, transport, enabled, send }: { session: SessionState; transport: Transport | null; enabled: boolean; send: Send }) {
 const [open, setOpen] = useState(false);
 const ref = useRef<HTMLDivElement>(null);
 useEffect(() => {
  if (!open) return;
  const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
  window.addEventListener('mousedown', close); window.addEventListener('keydown', esc);
  return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
 }, [open]);
 return <div ref={ref} style={{ position: 'relative' }}>
  <button className="vs-icon-button" aria-label="Session" title="Project" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)}><Icon name="folder" /></button>
  {open && <div className="vs-session-popup" role="dialog" aria-label="Session" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 10, width: 'min(360px, calc(100vw - 32px))', background: C.raised, border: `1px solid ${C.lineStrong}`, borderRadius: 6, padding: 12, boxShadow: '0 8px 24px #000a' }}>
   <SessionPanel session={session} transport={transport} enabled={enabled} dispatch={send} />
  </div>}
 </div>;
}
