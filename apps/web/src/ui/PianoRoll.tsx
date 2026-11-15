import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionState } from '@voicesynth/contracts';
import { PatternEditQueue, moveNote, placeNote, resizeNote, type PatternOp } from './pattern-edit.ts';
import { MAX_CENTER, MIN_CENTER, STEPS, cellAt, centerPitch, followCenter, isBlackKey, offRange, visibleRows } from './piano-roll-geometry.ts';
import { noteName } from './labels.ts';
import { C, MONO } from './theme.ts';

type Note = SessionState['tracks'][number]['notes'][number];
interface Props {
 notes: Note[];
 /**
  * Recorded notes not yet confirmed by the engine. `live` is the note still being sung (view-only,
  * growing); `provisional` was released and waits for the loop; `submitted` was sent to the engine.
  */
 provisional: { step: number; duration: number; midi: number; state?: LiveState }[];
 playhead: number | null;
 disabled: boolean;
 eraseEnabled?: boolean;
 onEdit: (op: PatternOp) => void;
 onErase: (step: number) => void;
 onAudition?: (midi: number, on: boolean) => void;
 label: string;
}
export type LiveState = 'live' | 'provisional' | 'submitted';
type Drag = { kind: 'move' | 'resize'; id: string; startX: number; startY: number; step: number; midi: number; duration: number; dSteps: number; dRows: number };

const ROWS = 25, ROW_H = 14, KEYS_W = 46;
/** Live = solid outline, lightly filled and labelled; released = dashed; sent to the engine = dotted and fainter. */
const LIVE_STYLE: Record<LiveState, React.CSSProperties> = {
 live: { border: `1px solid ${C.accent}`, background: '#f4f4f526', color: C.accent },
 provisional: { border: `1px dashed ${C.pending}`, background: 'transparent', color: C.pending },
 submitted: { border: `1px dotted ${C.faint}`, background: 'transparent', color: C.faint },
};
const LIVE_TITLE: Record<LiveState, string> = { live: 'Still singing (not saved yet)', provisional: 'Heard; saved at the loop boundary', submitted: 'Sent to the engine; waiting to be saved' };

type OffNote = { step: number; midi: number; saved: boolean; state?: LiveState };
/**
 * Edge marker for notes outside the visible pitch range: placed at the nearest unsaved (else saved) note's
 * step on the top or bottom edge and naming it, so a low or high sung note is never silently invisible.
 */
function EdgeMarker({ side, notes, onShow }: { side: 'above' | 'below'; notes: OffNote[]; onShow: (midi: number) => void }) {
 const nearest = notes.find(n => !n.saved) ?? notes[0], live = notes.some(n => !n.saved);
 const more = notes.length > 1 ? ` +${notes.length - 1}` : '';
 const count = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
 return <button type="button" data-edge={side} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onShow(nearest.midi); }}
  aria-label={`Show ${noteName(nearest.midi)} (${count} ${side} view)`} title={`${count} ${side} the visible range; click to show`}
  style={{ position: 'absolute', zIndex: 2, [side === 'above' ? 'top' : 'bottom']: 1, left: `min(${nearest.step / STEPS * 100}%, calc(100% - 64px))`, padding: '0 4px', height: ROW_H - 2, lineHeight: `${ROW_H - 4}px`,
   fontSize: 9, fontFamily: MONO, whiteSpace: 'nowrap', borderRadius: 2, border: `1px ${live ? 'solid' : 'dashed'} ${live ? C.accent : C.muted}`, background: C.raised, color: live ? C.accent : C.muted }}>
  {side === 'above' ? '↑' : '↓'} {noteName(nearest.midi)}{more}
 </button>;
}

/**
 * Editable synth piano roll: keyboard/pitch axis, four-bar timeline on a sixteenth grid, playhead,
 * note creation (click), selection, move (drag), resize (drag the right edge), delete (Delete key or
 * double-click). Synth tracks are monophonic, so notes a change lands on are replaced, as in the
 * engine. Edits apply through the pattern queue at the next loop.
 */
export function PianoRoll({ notes, provisional, playhead, disabled, eraseEnabled = true, onEdit, onErase, onAudition, label }: Props) {
 const [center, setCenter] = useState(() => centerPitch(notes));
 const [length, setLength] = useState(2);
 const [selected, setSelected] = useState<string | null>(null);
 const [drag, setDrag] = useState<Drag | null>(null);
 const grid = useRef<HTMLDivElement>(null);
 const hadNotes = useRef(notes.length > 0);
 // Re-center once when a previously empty roll gets its first notes (e.g. after a take).
 useEffect(() => { if (!hadNotes.current && notes.length) { hadNotes.current = true; setCenter(centerPitch(notes)); } }, [notes]);
 const rows = useMemo(() => visibleRows(center, ROWS), [center]);
 const rowOf = (midi: number) => rows.indexOf(midi);
 // Follow sung notes outside the view, by whole octaves. Any manual navigation while a take is on screen
 // pauses following until the live/queued notes are gone, so the roll never fights the Oct buttons.
 const manual = useRef(false);
 const followed = provisional.find(p => p.state === 'live') ?? provisional[provisional.length - 1];
 useEffect(() => { if (!provisional.length) manual.current = false; }, [provisional.length]);
 useEffect(() => {
  if (followed && !manual.current && rowOf(followed.midi) < 0) setCenter(c => followCenter(c, followed.midi, ROWS));
 }, [followed?.midi, followed?.step]); // eslint-disable-line react-hooks/exhaustive-deps
 const navigate = (next: number) => { if (provisional.length) manual.current = true; setCenter(Math.max(MIN_CENTER, Math.min(MAX_CENTER, next))); };
 const audition = (midi: number) => { if (!onAudition) return; onAudition(midi, true); setTimeout(() => onAudition(midi, false), 180); };

 useEffect(() => {
  const key = (e: KeyboardEvent) => {
   if (!selected || disabled || !eraseEnabled || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
   if ((e.target as HTMLElement)?.closest('input,select,textarea')) return;
   const note = notes.find(n => n.id === selected);
   if (!note) return;
   e.preventDefault(); onErase(note.step); setSelected(null);
  };
  window.addEventListener('keydown', key);
  return () => window.removeEventListener('keydown', key);
 }, [selected, disabled, eraseEnabled, onErase, notes]);

 const local = (e: { clientX: number; clientY: number }) => { const r = grid.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width }; };

 const onGridDown = (e: React.PointerEvent) => {
  if (disabled || e.button !== 0) return;
  const { x, y, w } = local(e);
  const cell = cellAt(x, y, w, ROW_H, rows);
  if (!cell) return;
  setSelected(null);
  onEdit(placeNote(cell.step, cell.midi, length));
  audition(cell.midi);
 };

 const onNoteDown = (e: React.PointerEvent, note: Note, kind: Drag['kind']) => {
  e.stopPropagation();
  if (disabled || e.button !== 0 || PatternEditQueue.isPlaceholder(note.id)) return;
  setSelected(note.id);
  (e.target as Element).setPointerCapture(e.pointerId);
  setDrag({ kind, id: note.id, startX: e.clientX, startY: e.clientY, step: note.step, midi: note.midi, duration: note.duration, dSteps: 0, dRows: 0 });
 };
 const onMove = (e: React.PointerEvent) => {
  if (!drag) return;
  const stepW = grid.current!.getBoundingClientRect().width / STEPS;
  setDrag({ ...drag, dSteps: Math.round((e.clientX - drag.startX) / stepW), dRows: Math.round((e.clientY - drag.startY) / ROW_H) });
 };
 const onUp = () => {
  if (!drag) return;
  if (drag.kind === 'move' && (drag.dSteps || drag.dRows)) { onEdit(moveNote(drag.id, drag.step + drag.dSteps, drag.midi - drag.dRows)); audition(drag.midi - drag.dRows); }
  if (drag.kind === 'resize' && drag.dSteps) onEdit(resizeNote(drag.id, drag.duration + drag.dSteps));
  setDrag(null);
 };

 /** Live geometry for a note, including an in-progress drag. */
 const shape = (n: Note) => {
  if (drag?.id !== n.id) return n;
  return drag.kind === 'move' ? { ...n, step: ((n.step + drag.dSteps) % 64 + 64) % 64, midi: n.midi - drag.dRows } : { ...n, duration: Math.max(1, Math.min(64, n.duration + drag.dSteps)) };
 };
 /** A note may wrap the loop edge: render it as up to two segments. */
 const segments = (step: number, duration: number) => step + duration <= STEPS ? [[step, duration]] : [[step, STEPS - step], [0, step + duration - STEPS]];
 const off = offRange([...provisional.map(p => ({ step: p.step, midi: p.midi, state: p.state, saved: false })), ...notes.map(n => ({ step: n.step, midi: n.midi, state: undefined, saved: true }))], rows);
 const offscreen = off.above.length + off.below.length;
 const offDetail = [off.above.length && `${off.above.length} above`, off.below.length && `${off.below.length} below`].filter(Boolean).join(', ');
 const liveOff = off.above.concat(off.below).some(p => !p.saved);

 return <div aria-label={`${label} piano roll`} style={{ userSelect: 'none' }}>
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
   <button disabled={center >= MAX_CENTER} onClick={() => navigate(center + 12)} aria-label="Octave up">▲ Oct</button>
   <button disabled={center <= MIN_CENTER} onClick={() => navigate(center - 12)} aria-label="Octave down">▼ Oct</button>
   <button onClick={() => navigate(centerPitch(notes.length ? notes : provisional))}>Center</button>
   <span style={{ color: C.muted, fontFamily: MONO }} aria-label="Visible range">{noteName(rows[rows.length - 1])}–{noteName(rows[0])}</span>
   <label>Length <select value={length} onChange={e => setLength(Number(e.target.value))}>{[1, 2, 4, 8, 16].map(l => <option key={l} value={l}>{l === 1 ? '1/16' : l === 2 ? '1/8' : l === 4 ? '1/4' : l === 8 ? '1/2' : '1 bar'}</option>)}</select></label>
   <span className="vs-sr">Click to add. Drag to move or resize. Delete or double-click to remove.</span>
   {offscreen > 0 && <span role="status" style={{ color: liveOff ? C.text : C.muted }}>{offscreen} note{offscreen === 1 ? '' : 's'} outside view ({offDetail})</span>}
  </div>
  <div style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: 4, overflow: 'hidden' }}>
   <div aria-label="Keyboard" style={{ width: KEYS_W, flex: 'none', borderRight: `1px solid ${C.line}` }}>
    {rows.map(m => <div key={m} onPointerDown={() => onAudition?.(m, true)} onPointerUp={() => onAudition?.(m, false)} onPointerLeave={() => onAudition?.(m, false)}
     style={{ height: ROW_H, boxSizing: 'border-box', fontSize: 9, fontFamily: MONO, paddingLeft: 4, lineHeight: `${ROW_H}px`, cursor: onAudition ? 'pointer' : 'default',
      background: isBlackKey(m) ? '#1a1a1d' : '#2a2a2f', color: m % 12 === 0 ? C.text : C.faint, borderBottom: `1px solid ${C.bg}` }}>{m % 12 === 0 || m === center ? noteName(m) : ''}</div>)}
   </div>
   <div ref={grid} role="grid" aria-label={`${label} notes`} onPointerDown={onGridDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
    style={{ position: 'relative', flex: 1, height: ROWS * ROW_H, cursor: disabled ? 'default' : 'crosshair',
     backgroundImage: [
      `repeating-linear-gradient(to right, ${C.lineStrong} 0 1px, transparent 1px calc(100% / 4))`,
      `repeating-linear-gradient(to right, ${C.line} 0 1px, transparent 1px calc(100% / 16))`,
      `repeating-linear-gradient(to right, #1a1a1d 0 1px, transparent 1px calc(100% / 64))`,
     ].join(','), backgroundColor: C.panel }}>
    {rows.map((m, i) => isBlackKey(m) && <div key={m} style={{ position: 'absolute', left: 0, right: 0, top: i * ROW_H, height: ROW_H, background: '#0000002e', pointerEvents: 'none' }} />)}
    {provisional.flatMap((p, i) => rowOf(p.midi) < 0 ? [] : segments(p.step, p.duration).map(([s, d], k) =>
     <button key={`p${i}-${k}`} type="button" data-live={p.state ?? 'provisional'} title={LIVE_TITLE[p.state ?? 'provisional']}
      aria-label={`${eraseEnabled ? 'Erase provisional' : 'Erase unavailable'} ${noteName(p.midi)} step ${s + 1}${p.state === 'live' ? ' (still singing)' : ''}`} disabled={disabled || !eraseEnabled}
      onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onErase(s); }}
      style={{ position: 'absolute', left: `${s / STEPS * 100}%`, width: `${d / STEPS * 100}%`, top: rowOf(p.midi) * ROW_H + 1, height: ROW_H - 2, minWidth: 0, padding: '0 0 0 2px', borderRadius: 2, boxSizing: 'border-box', cursor: 'pointer',
       overflow: 'hidden', whiteSpace: 'nowrap', textAlign: 'left', fontSize: 9, fontFamily: MONO, lineHeight: `${ROW_H - 4}px`, ...LIVE_STYLE[p.state ?? 'provisional'] }}>{k === 0 ? noteName(p.midi) : ''}</button>))}
    {(['above', 'below'] as const).map(side => off[side].length > 0 && <EdgeMarker key={side} side={side} notes={off[side]}
     onShow={midi => navigate(followCenter(center, midi, ROWS))} />)}
    {/* Chord tones (Note.chord) belong to their root note: drawn with it, moved with it, not separately editable. */}
    {notes.map(shape).flatMap(n => (n.chord ?? []).map(m => m + n.midi - (notes.find(x => x.id === n.id)?.midi ?? n.midi)).filter(m => rowOf(m) >= 0).flatMap(m =>
     segments(n.step, n.duration).map(([s, d], k) => <div key={`${n.id}-c${m}-${k}`} aria-hidden data-chord-tone={noteName(m)}
      style={{ position: 'absolute', left: `${s / STEPS * 100}%`, width: `${d / STEPS * 100}%`, top: rowOf(m) * ROW_H + 2, height: ROW_H - 4, boxSizing: 'border-box', pointerEvents: 'none',
       background: '#d6d6da40', border: `1px solid ${n.id === selected ? C.accent : C.note}`, borderRadius: 2, fontSize: 8, color: C.text, fontFamily: MONO, overflow: 'hidden', whiteSpace: 'nowrap', paddingLeft: 2, lineHeight: `${ROW_H - 6}px` }}>
       {k === 0 ? noteName(m) : ''}</div>)))}
    {notes.map(shape).flatMap(n => rowOf(n.midi) < 0 ? [] : segments(n.step, n.duration).map(([s, d], k) => {
     const sel = n.id === selected, pending = PatternEditQueue.isPlaceholder(n.id);
     return <div key={`${n.id}-${k}`} role="gridcell" aria-label={`${noteName(n.midi)}${n.chord?.length ? ` chord with ${n.chord.map(noteName).join(' ')}` : ''} step ${n.step + 1} length ${n.duration}`} aria-selected={sel}
      onPointerDown={e => onNoteDown(e, notes.find(x => x.id === n.id)!, 'move')} onDoubleClick={e => { e.stopPropagation(); if (!disabled && eraseEnabled && !pending) { const { x, y, w } = local(e); const cell = cellAt(x, y, w, ROW_H, rows); if (cell) onErase(cell.step); setSelected(null); } }}
      style={{ position: 'absolute', left: `${s / STEPS * 100}%`, width: `${d / STEPS * 100}%`, top: rowOf(n.midi) * ROW_H + 1, height: ROW_H - 2, boxSizing: 'border-box',
       background: pending ? C.pending : sel ? C.noteSelected : C.note, border: `1px solid ${sel ? C.accent : '#0008'}`, borderRadius: 2, cursor: disabled || pending ? 'default' : 'grab',
       fontSize: 9, color: '#111', fontFamily: MONO, overflow: 'hidden', whiteSpace: 'nowrap', paddingLeft: 2 }}>
      {k === 0 ? noteName(n.midi) : ''}
      {k === segments(n.step, n.duration).length - 1 && !pending && <span onPointerDown={e => onNoteDown(e, notes.find(x => x.id === n.id)!, 'resize')} aria-label="Resize"
       style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: disabled ? 'default' : 'ew-resize', background: '#0003' }} />}
     </div>;
    }))}
    {playhead !== null && <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: `${playhead / STEPS * 100}%`, width: 2, background: C.accent, opacity: 0.7, pointerEvents: 'none' }} />}
   </div>
  </div>
 </div>;
}
