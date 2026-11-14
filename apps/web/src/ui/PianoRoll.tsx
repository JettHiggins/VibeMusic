import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionState } from '@voicesynth/contracts';
import { PatternEditQueue, moveNote, placeNote, resizeNote, type PatternOp } from './pattern-edit.ts';
import { STEPS, cellAt, centerPitch, isBlackKey, visibleRows } from './piano-roll-geometry.ts';
import { noteName } from './labels.ts';
import { C, MONO } from './theme.ts';

type Note = SessionState['tracks'][number]['notes'][number];
interface Props {
 notes: Note[];
 /** Recorded notes not yet confirmed by the engine (shown dashed). */
 provisional: { step: number; duration: number; midi: number }[];
 playhead: number | null;
 disabled: boolean;
 eraseEnabled?: boolean;
 onEdit: (op: PatternOp) => void;
 onErase: (step: number) => void;
 onAudition?: (midi: number, on: boolean) => void;
 label: string;
}
type Drag = { kind: 'move' | 'resize'; id: string; startX: number; startY: number; step: number; midi: number; duration: number; dSteps: number; dRows: number };

const ROWS = 25, ROW_H = 14, KEYS_W = 46;

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
 const offscreen = notes.filter(n => rowOf(n.midi) < 0).length;

 return <div aria-label={`${label} piano roll`} style={{ userSelect: 'none' }}>
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
   <button disabled={center >= 115} onClick={() => setCenter(c => Math.min(115, c + 12))} aria-label="Octave up">▲ Oct</button>
   <button disabled={center <= 12} onClick={() => setCenter(c => Math.max(12, c - 12))} aria-label="Octave down">▼ Oct</button>
   <button onClick={() => setCenter(centerPitch(notes))}>Center</button>
   <label>Length <select value={length} onChange={e => setLength(Number(e.target.value))}>{[1, 2, 4, 8, 16].map(l => <option key={l} value={l}>{l === 1 ? '1/16' : l === 2 ? '1/8' : l === 4 ? '1/4' : l === 8 ? '1/2' : '1 bar'}</option>)}</select></label>
   <span style={{ color: C.muted }}>Click to add · drag to move · drag the right edge to resize · Delete or double-click to remove{offscreen ? ` · ${offscreen} note(s) outside view` : ''}</span>
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
     <button key={`p${i}-${k}`} type="button" aria-label={`${eraseEnabled ? 'Erase provisional' : 'Erase unavailable'} ${noteName(p.midi)} step ${s + 1}`} disabled={disabled || !eraseEnabled}
      onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onErase(s); }}
      style={{ position: 'absolute', left: `${s / STEPS * 100}%`, width: `${d / STEPS * 100}%`, top: rowOf(p.midi) * ROW_H + 1, height: ROW_H - 2, minWidth: 0, padding: 0, border: `1px dashed ${C.pending}`, borderRadius: 2, boxSizing: 'border-box', background: 'transparent', cursor: 'pointer' }} />))}
    {notes.map(shape).flatMap(n => rowOf(n.midi) < 0 ? [] : segments(n.step, n.duration).map(([s, d], k) => {
     const sel = n.id === selected, pending = PatternEditQueue.isPlaceholder(n.id);
     return <div key={`${n.id}-${k}`} role="gridcell" aria-label={`${noteName(n.midi)} step ${n.step + 1} length ${n.duration}`} aria-selected={sel}
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
