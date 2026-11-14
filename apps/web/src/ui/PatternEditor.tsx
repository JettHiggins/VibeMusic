import React, { useEffect, useMemo, useReducer, useState } from 'react';
import type { AuditionEvent, ClientMessage, SessionCommand, SessionState } from '@voicesynth/contracts';
import { PatternEditQueue, placeNote, removeNoteAt, toggleHit, type TrackId } from './pattern-edit.ts';
import { noteName } from './InputPanel.tsx';

export interface EditorEngine {
 getSession(): SessionState;
 subscribe(listener: (message: ClientMessage) => void): () => void;
 dispatch(command: SessionCommand): ClientMessage;
 /** Optional capability (AuditionEngineAdapter); audition controls are disabled without it. */
 audition?: (event: AuditionEvent) => void;
}
type Lane = 'kick' | 'snare' | 'closed-hat';
const LANES: { lane: Lane; label: string }[] = [{ lane: 'kick', label: 'Kick' }, { lane: 'snare', label: 'Snare' }, { lane: 'closed-hat', label: 'Hats' }];
const TRACKS: { id: TrackId; label: string }[] = [{ id: 'drums', label: 'Drums' }, { id: 'synth-1', label: 'Synth 1' }, { id: 'synth-2', label: 'Synth 2' }, { id: 'synth-3', label: 'Synth 3' }];
const LENGTHS = [1, 2, 4, 8];

/** Click-to-edit pattern grid. Edits apply at the next loop boundary via `edit-pattern`. */
export function PatternEditor({ engine, session, enabled }: { engine: EditorEngine; session: SessionState; enabled: boolean }) {
 const queue = useMemo(() => new PatternEditQueue({ dispatch: c => engine.dispatch(c), newId: () => crypto.randomUUID() }), [engine]);
 const [, refresh] = useReducer((x: number) => x + 1, 0);
 useEffect(() => {
  queue.onChange = refresh;
  queue.handle({ type: 'session', session: engine.getSession() });
  return engine.subscribe(m => queue.handle(m));
 }, [engine, queue]);
 const [trackId, setTrackId] = useState<TrackId>('drums');
 const [midi, setMidi] = useState(60);
 const [length, setLength] = useState(2);
 const track = session.tracks.find(t => t.id === trackId)!;
 const [volume, setVolume] = useState(track.volume);
 useEffect(() => setVolume(track.volume), [track.volume, trackId]);
 const view = queue.view(trackId);
 const canAudition = enabled && !!engine.audition;
 const send = (operation: SessionCommand['operation']) => engine.dispatch({ id: crypto.randomUUID(), expectedRevision: engine.getSession().revision, boundary: 'immediate', operation });
 const drum = (lane: Lane) => canAudition && engine.audition!({ kind: 'drum', lane, velocity: 0.9 });
 const key = (m: number, on: boolean) => { if (canAudition && trackId !== 'drums') engine.audition!({ kind: 'note', trackId, midi: m, velocity: on ? 0.8 : 0, on }); };

 return <section aria-label="Pattern editor" style={{ border: '1px solid #8884', borderRadius: 8, padding: 16, marginTop: 24 }}>
  <h2 style={{ marginTop: 0 }}>Edit pattern</h2>
  <div style={row} role="tablist" aria-label="Track">
   {TRACKS.map(t => <button key={t.id} role="tab" aria-selected={t.id === trackId} style={t.id === trackId ? selected : undefined} onClick={() => setTrackId(t.id)}>{t.label}</button>)}
   <label style={{ marginLeft: 12 }}>Volume <input type="range" min={0} max={1} step={0.01} value={volume} disabled={!enabled}
    onChange={e => setVolume(Number(e.target.value))}
    onPointerUp={() => send({ type: 'volume', trackId, volume })} onKeyUp={() => send({ type: 'volume', trackId, volume })} /></label>
  </div>

  {trackId === 'drums'
   ? LANES.map(({ lane, label }) => <div key={lane} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0' }}>
    <button style={{ width: 64 }} disabled={!canAudition} title="Audition" onClick={() => drum(lane)}>{label}</button>
    <Row label={`${label} steps`} render={step => {
     const on = view.hits.some(h => h.lane === lane && h.step === step);
     return { on, start: on, text: '', onClick: () => queue.edit('drums', toggleHit(lane, step)) };
    }} disabled={!enabled} />
   </div>)
   : <>
    <div style={row}>
     <label>Pitch <select value={midi % 12} onChange={e => setMidi(Math.floor(midi / 12) * 12 + Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{noteName(i + 12).replace(/\d+$/, '')}</option>)}</select></label>
     <label>Octave <select value={Math.floor(midi / 12) - 1} onChange={e => setMidi((Number(e.target.value) + 1) * 12 + midi % 12)}>{[1, 2, 3, 4, 5, 6].map(o => <option key={o} value={o}>{o}</option>)}</select></label>
     <label>Length <select value={length} onChange={e => setLength(Number(e.target.value))}>{LENGTHS.map(l => <option key={l} value={l}>{l === 1 ? '1 step' : `${l} steps`}</option>)}</select></label>
     <span style={small}>Click an empty step to place {noteName(midi)}; click a note to remove it.</span>
    </div>
    <Keyboard base={Math.floor(midi / 12) * 12} selected={midi} disabled={!canAudition} onKey={(m, on) => { key(m, on); if (on) setMidi(m); }} />
    <Row label={`${TRACKS.find(t => t.id === trackId)!.label} notes`} render={step => {
     const note = view.notes.find(n => [...Array(n.duration).keys()].some(i => (n.step + i) % 64 === step));
     return { on: !!note, start: note?.step === step, text: note?.step === step ? noteName(note.midi) : '', onClick: () => queue.edit(trackId, note ? removeNoteAt(step) : placeNote(step, midi, length)) };
    }} disabled={!enabled} />
   </>}
  <p style={small} role="status">{queue.lastError ?? (view.pending ? 'Edits apply at the next loop…' : `${trackId === 'drums' ? track.hits.length + ' hits' : track.notes.length + ' notes'} · volume ${Math.round(track.volume * 100)}%`)}</p>
 </section>;
}

function Row({ render, label, disabled }: { render: (step: number) => { on: boolean; start: boolean; text: string; onClick: () => void }; label: string; disabled: boolean }) {
 return <div aria-label={label} style={{ display: 'grid', gridTemplateColumns: 'repeat(64, 1fr)', gap: 2, flex: 1, minWidth: 0 }}>
  {Array.from({ length: 64 }, (_, step) => {
   const cell = render(step);
   return <button key={step} disabled={disabled} aria-pressed={cell.on} aria-label={`Step ${step + 1}${cell.text ? ' ' + cell.text : ''}`} onClick={cell.onClick} style={{
    height: 22, padding: 0, border: 0, borderRadius: 2, minWidth: 0, fontSize: 8, color: '#fff', overflow: 'hidden', cursor: disabled ? 'default' : 'pointer',
    background: cell.on ? (cell.start ? '#2a8' : '#2a8a') : step % 16 === 0 ? '#8886' : step % 4 === 0 ? '#8884' : '#8882',
   }}>{cell.text}</button>;
  })}
 </div>;
}

function Keyboard({ base, selected, disabled, onKey }: { base: number; selected: number; disabled: boolean; onKey: (midi: number, on: boolean) => void }) {
 const [held, setHeld] = useState<number | null>(null);
 const release = () => { if (held !== null) { onKey(held, false); setHeld(null); } };
 return <div aria-label="Audition keyboard" style={{ display: 'flex', gap: 2, margin: '8px 0' }} onPointerLeave={release}>
  {Array.from({ length: 13 }, (_, i) => base + i).map(m => {
   const black = [1, 3, 6, 8, 10].includes(m % 12);
   return <button key={m} disabled={disabled} aria-label={`Audition ${noteName(m)}`}
    onPointerDown={() => { release(); setHeld(m); onKey(m, true); }} onPointerUp={release} onPointerCancel={release}
    style={{ width: 26, height: black ? 36 : 48, padding: 0, fontSize: 9, alignSelf: 'flex-start', background: m === selected ? '#2a8' : black ? '#333' : '#eee', color: black || m === selected ? '#fff' : '#333', border: '1px solid #888', borderRadius: 3 }}>{m % 12 === 0 ? noteName(m) : ''}</button>;
  })}
 </div>;
}

const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' };
const small: React.CSSProperties = { fontSize: 13, margin: '6px 0' };
const selected: React.CSSProperties = { fontWeight: 700, outline: '2px solid #2a8' };
