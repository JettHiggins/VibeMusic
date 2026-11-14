import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionCommand, SessionState, Transport } from '@voicesynth/contracts';
import type { FirmwareMetadata } from '../engine/metadata.ts';
import type { VoiceInput } from '../input/voice-input.ts';
import { InputPanel } from './InputPanel.tsx';
import { PatternEditor, type EditorEngine } from './PatternEditor.tsx';
import { SessionPanel } from './SessionPanel.tsx';
import { SoundPanel } from './SoundPanel.tsx';
import { CommandClient, type CommandResult } from './command-client.ts';

type Tab = 'record' | 'edit' | 'sound' | 'session' | 'agent';
const TABS: { id: Tab; label: string }[] = [{ id: 'record', label: 'Record' }, { id: 'edit', label: 'Edit' }, { id: 'sound', label: 'Sound' }, { id: 'session', label: 'Session' }, { id: 'agent', label: 'Agent' }];
const TRACK_LABEL: Record<string, string> = { 'synth-1': 'SYNTH 1', 'synth-2': 'SYNTH 2', 'synth-3': 'SYNTH 3', drums: 'DRUMS' };

export interface GrooveboxProps {
 engine: EditorEngine & { metadata: FirmwareMetadata | null };
 voice: VoiceInput;
 session: SessionState;
 transport: Transport | null;
 enabled: boolean;
 busy: boolean;
 message: string;
 onEnable: () => void;
 /** Kept for compatibility; UI commands go through the shared CommandClient (live revision, re-issue). */
 dispatch: (operation: SessionCommand['operation'], boundary?: SessionCommand['boundary']) => void;
 /** Workstream 1/3 integration controls (agent connection, transcript harness). */
 agent: ReactNode;
}

/** Compact groovebox: status display, four-channel strip, and tabbed workspace. */
export function Groovebox(props: GrooveboxProps) {
 const { engine, voice, session, transport, enabled, busy, message, onEnable, agent } = props;
 const client = useMemo(() => new CommandClient(engine), [engine]);
 const [result, setResult] = useState<CommandResult | null>(null);
 useEffect(() => { client.onResult = setResult; return engine.subscribe(m => client.handle(m)); }, [engine, client]);
 // Engine/asset errors arrive through the app message; show them instead of an older command result.
 useEffect(() => { setResult(null); }, [message]);
 const dispatch = (operation: SessionCommand['operation'], boundary: SessionCommand['boundary'] = 'immediate') => { client.send(operation, boundary); };
 const [tab, setTab] = useState<Tab>('record');
 const selected = session.selected.trackId;
 const position = transport?.playing ? describe(transport, session.tempo) : null;
 const rec = transport?.recordingState ?? 'idle';
 const metadata = engine.metadata;
 const sendVolume = (trackId: SessionState['tracks'][number]['id'], volume: number) => dispatch({ type: 'volume', trackId, volume });

 return <div style={shell}>
  <style>{css}</style>
  <header style={display} aria-label="Status display">
   <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
    <strong style={{ letterSpacing: 2, color: ACCENT }}>VOICESYNTH</strong>
    <Lcd label="BPM" value={String(session.tempo)} />
    <Lcd label="BAR.BEAT" value={position ? `${position.bar}.${position.beat}` : '-.-'} />
    <Lcd label="TRANSPORT" value={transport?.playing ? 'PLAY' : 'STOP'} />
    <Lcd label="REC" value={rec === 'recording' ? '● REC' : rec === 'armed' ? 'COUNT-IN' : 'OFF'} alert={rec !== 'idle'} />
   </div>
   <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
    {!enabled && <button className="vs-key vs-accent" disabled={busy} onClick={onEnable}>Enable audio</button>}
    <button className="vs-key" disabled={!enabled} aria-label={transport?.playing ? 'Stop playback' : 'Play'} onClick={() => dispatch({ type: 'play', playing: !transport?.playing })}>{transport?.playing ? '■ Stop' : '▶ Play'}</button>
    <button className="vs-key" disabled={!enabled || rec === 'recording' || session.tempo <= 40} aria-label="Tempo down" onClick={() => dispatch({ type: 'tempo', bpm: Math.max(40, session.tempo - 1) }, 'next-loop')}>−</button>
    <button className="vs-key" disabled={!enabled || rec === 'recording' || session.tempo >= 240} aria-label="Tempo up" onClick={() => dispatch({ type: 'tempo', bpm: Math.min(240, session.tempo + 1) }, 'next-loop')}>+</button>
    <button className="vs-key" disabled={!enabled} onClick={() => dispatch({ type: 'undo' }, 'next-loop')}>Undo</button>
   </div>
   <p role="status" style={{ margin: 0, fontSize: 12, opacity: 0.85, fontFamily: MONO, color: result?.error ? '#ff7b7b' : undefined }}>{result?.text ?? message}</p>
  </header>

  <div style={strip} role="group" aria-label="Tracks">
   {session.tracks.map(track => {
    const isSel = track.id === selected;
    const engineName = metadata?.engines[track.patch.engine];
    const sound = track.id === 'drums' ? 'KIT' : engineName ? `${engineName.name} · ${engineName.presets[track.patch.preset]?.name ?? ''}` : '—';
    return <div key={track.id} style={{ ...channel, outline: isSel ? `2px solid ${ACCENT}` : undefined }}>
     <button className="vs-plain" disabled={!enabled || rec !== 'idle'} aria-pressed={isSel} onClick={() => dispatch({ type: 'select', target: track.id === 'drums' ? { trackId: 'drums', lane: session.selected.lane ?? 'kick' } : { trackId: track.id } })}>
      <div style={{ fontWeight: 700, letterSpacing: 1 }}>{TRACK_LABEL[track.id]}</div>
      <div style={{ fontSize: 11, opacity: 0.75, fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sound}</div>
      <div style={{ fontSize: 11, opacity: 0.6 }}>{track.id === 'drums' ? `${track.hits.length} hits` : `${track.notes.length} notes`}</div>
     </button>
     <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button className={`vs-key${track.muted ? ' vs-on' : ''}`} disabled={!enabled} aria-pressed={track.muted} aria-label={`Mute ${TRACK_LABEL[track.id]}`} onClick={() => dispatch({ type: 'mute', trackId: track.id, muted: !track.muted })}>M</button>
      <Volume value={track.volume} disabled={!enabled} label={`${TRACK_LABEL[track.id]} volume`} onCommit={v => sendVolume(track.id, v)} />
     </div>
    </div>;
   })}
  </div>

  <nav role="tablist" aria-label="Workspace" style={{ display: 'flex', gap: 4, margin: '12px 0 0' }}>
   {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`vs-tab${tab === t.id ? ' vs-on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
  </nav>
  <section style={workspace} role="tabpanel" aria-label={TABS.find(t => t.id === tab)!.label}>
   {tab === 'record' && <InputPanel voice={voice} session={session} transport={transport} enabled={enabled} dispatch={dispatch} />}
   {/* Keep edit queues subscribed across tab switches until their commands settle. */}
   <div hidden={tab !== 'edit'}><PatternEditor engine={engine} session={session} enabled={enabled} /></div>
   <div hidden={tab !== 'sound'}><h2 style={{ marginTop: 0 }}>{TRACK_LABEL[selected]} sound</h2><SoundPanel engine={engine} metadata={metadata} session={session} trackId={selected} enabled={enabled} /></div>
   {tab === 'session' && <SessionPanel session={session} transport={transport} enabled={enabled} dispatch={dispatch} />}
   {tab === 'agent' && agent}
  </section>
 </div>;
}

function Volume({ value, disabled, label, onCommit }: { value: number; disabled: boolean; label: string; onCommit: (v: number) => void }) {
 const [v, setV] = useState(value);
 useEffect(() => setV(value), [value]);
 return <input type="range" aria-label={label} min={0} max={1} step={0.01} value={v} disabled={disabled} style={{ flex: 1, minWidth: 0, accentColor: ACCENT }}
  onChange={e => setV(Number(e.target.value))} onPointerUp={() => onCommit(v)} onKeyUp={() => onCommit(v)} />;
}

function Lcd({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
 return <span style={{ display: 'inline-flex', flexDirection: 'column', fontFamily: MONO }}>
  <span style={{ fontSize: 9, opacity: 0.6 }}>{label}</span>
  <span style={{ fontSize: 18, color: alert ? '#ff4d4d' : LCD }}>{value}</span>
 </span>;
}

function describe(t: Transport, tempo: number) {
 const step = Math.floor((t.currentFrame - t.loopStartFrame) / (t.sampleRate * 60 / (tempo * 4)));
 if (step < 0) return null;
 const s = step % 64;
 return { bar: Math.floor(s / 16) + 1, beat: Math.floor(s % 16 / 4) + 1 };
}

const ACCENT = '#ff8a2a', LCD = '#9cf0c8', MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const shell: React.CSSProperties = { maxWidth: 980, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif', color: '#e9e9e9' };
const display: React.CSSProperties = { background: '#0f1412', border: '1px solid #2b3430', borderRadius: 10, padding: '12px 14px', display: 'grid', gap: 10, boxShadow: 'inset 0 0 24px #0008' };
const strip: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8, marginTop: 12 };
const channel: React.CSSProperties = { background: '#26292d', border: '1px solid #3a3e44', borderRadius: 8, padding: 10, display: 'grid', gap: 8, minWidth: 0 };
const workspace: React.CSSProperties = { background: '#202326', border: '1px solid #3a3e44', borderRadius: '0 8px 8px 8px', padding: 12 };
const css = `
 html, body { background: #17191b; margin: 0; }
 input[type=range] { accent-color: ${ACCENT}; }
 .vs-key { background: #3a3e44; color: #eee; border: 1px solid #555b63; border-radius: 6px; padding: 6px 10px; font-weight: 600; cursor: pointer; }
 .vs-key:disabled, .vs-tab:disabled { opacity: .45; cursor: default; }
 .vs-key.vs-on { background: ${ACCENT}; color: #111; border-color: ${ACCENT}; }
 .vs-accent { background: ${ACCENT}; color: #111; border-color: ${ACCENT}; }
 .vs-plain { all: unset; cursor: pointer; display: grid; gap: 2px; min-width: 0; }
 .vs-plain:disabled { cursor: default; }
 .vs-plain:focus-visible, .vs-key:focus-visible, .vs-tab:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 2px; }
 .vs-tab { background: #2a2d31; color: #ddd; border: 1px solid #3a3e44; border-bottom: none; border-radius: 8px 8px 0 0; padding: 6px 14px; cursor: pointer; }
 .vs-tab.vs-on { background: #202326; color: ${ACCENT}; font-weight: 700; }
 section[role=tabpanel] section { border: none !important; padding: 0 !important; margin-top: 0 !important; }
 section[role=tabpanel] button:not(.vs-key):not(.vs-tab) { background: #34383d; color: #eee; border: 1px solid #50565d; border-radius: 5px; padding: 4px 9px; }
 section[role=tabpanel] button:not(.vs-key):not(.vs-tab):disabled { opacity: .45; }
 section[role=tabpanel] select, section[role=tabpanel] input:not([type=range]) { background: #2a2d31; color: #eee; border: 1px solid #50565d; border-radius: 5px; padding: 3px 6px; }
`;
