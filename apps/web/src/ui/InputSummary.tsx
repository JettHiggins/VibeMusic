import React, { useState } from 'react';
import type { VoiceInput, VoiceInputState } from '../input/voice-input.ts';
import type { InputNotice, InputSummary, Tone } from './input-summary.ts';
import { C, MONO } from './theme.ts';

export const toneColor = (tone: Tone) => tone === 'muted' ? C.muted : tone === 'ok' ? C.ok : C.warn;
const glyph = (tone: Tone) => tone === 'alert' ? '⚠' : tone === 'warn' ? '!' : tone === 'ok' ? '●' : '○';

/**
 * Always-visible input readout, modelled on the clarity of hardware-style voice-to-MIDI displays:
 * mic status, level against the room floor and note gate, the raw heard pitch versus the
 * key-mapped output, and the active key. Values come straight from existing VoiceInputState.
 */
export function InputReadout({ summary, melodic }: { summary: InputSummary; melodic: boolean }) {
 const { level, pitch } = summary;
 return <div className="vs-readout" aria-label="Input summary">
  <div className="vs-row">
   <span role="status" aria-label="Microphone status" style={{ color: toneColor(summary.status.tone), fontWeight: 600 }}>{glyph(summary.status.tone)} {summary.status.label}</span>
   <span className="vs-grow" />
   <span style={{ fontFamily: MONO, color: C.muted }} aria-label="Input level">{level.active && Number.isFinite(level.db) ? `${level.db.toFixed(0)} dBFS` : '— dBFS'}</span>
  </div>
  <Meter level={level} />
  {melodic && pitch && <div className="vs-pitch" aria-label="Pitch">
   <span className="vs-cell"><small>Heard</small><b style={{ fontFamily: MONO, fontSize: 18 }}>{pitch.heard}</b></span>
   <span className="vs-cell" title="The note written with the active key; raw pitch is kept"><small>Output</small><b style={{ fontFamily: MONO, fontSize: 18, color: pitch.output ? C.text : C.muted }}>{pitch.output ?? (pitch.heard === '—' || pitch.heard === '?' ? '—' : pitch.heard)}</b></span>
   <span className="vs-cell" style={{ flex: '1 1 0', minWidth: 0 }}><small>State</small><span style={{ color: toneColor(pitch.tone) }}>{pitch.gate}</span>{pitch.detail && <small style={{ color: C.muted }}>{pitch.detail}</small>}</span>
  </div>}
  {summary.hit && <div style={{ color: C.muted }} aria-label="Last hit">{summary.hit}</div>}
  {melodic && <div style={{ color: C.muted }} aria-label="Active key">Key <span style={{ color: summary.key === 'Off' ? C.muted : C.text }}>{summary.key}</span>{summary.key === 'Off' ? ' · notes keep their sung pitch' : ' · out-of-key notes map to the nearest scale note'}</div>}
 </div>;
}

function Meter({ level }: { level: InputSummary['level'] }) {
 const pct = (db: number) => Math.max(0, Math.min(100, (db + 60) / 60 * 100));
 const label = `Input level ${level.active && Number.isFinite(level.db) ? level.db.toFixed(0) + ' dBFS' : 'off'}`
  + (level.floorDb !== null ? `, room floor ${level.floorDb.toFixed(0)} dBFS` : '') + (level.gateDb !== null ? `, note level ${level.gateDb.toFixed(0)} dBFS` : '');
 return <div className="vs-meter" role="meter" aria-label={label} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(Number.isFinite(level.db) ? level.db : -60)}>
  <div style={{ width: `${level.active ? pct(level.db) : 0}%`, height: '100%', background: level.db > -3 ? C.rec : C.note }} />
  {level.floorDb !== null && <div title="Room floor" style={{ position: 'absolute', left: `${pct(level.floorDb)}%`, top: 0, bottom: 0, width: 2, background: C.muted }} />}
  {level.gateDb !== null && <div title="Level a note must reach" style={{ position: 'absolute', left: `${pct(level.gateDb)}%`, top: -2, bottom: -2, width: 2, background: C.accent }} />}
 </div>;
}

/** Prioritized warnings: the first is always shown; the rest are one keyboard-reachable click away. Long text is clamped, never clipped silently. */
export function Notices({ notices, onSetup }: { notices: InputNotice[]; onSetup: () => void }) {
 const [all, setAll] = useState(false);
 if (!notices.length) return null;
 const shown = all ? notices : notices.slice(0, 1);
 return <div aria-label="Input notices" style={{ display: 'grid', gap: 4 }}>
  {shown.map(n => <NoticeLine key={n.id} notice={n} onSetup={onSetup} />)}
  {notices.length > 1 && <button className="vs-link" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `${notices.length - 1} more notice${notices.length > 2 ? 's' : ''}`}</button>}
 </div>;
}

function NoticeLine({ notice, onSetup }: { notice: InputNotice; onSetup: () => void }) {
 const [expanded, setExpanded] = useState(false);
 const long = notice.text.length > 110;
 return <div role={notice.tone === 'alert' ? 'alert' : 'note'} className="vs-notice" style={{ color: toneColor(notice.tone) }}>
  <span className={long && !expanded ? 'vs-clamp' : undefined} title={long ? notice.text : undefined}>{glyph(notice.tone)} {notice.text}</span>
  <span className="vs-row" style={{ gap: 6 }}>
   {long && <button className="vs-link" aria-expanded={expanded} onClick={() => setExpanded(e => !e)}>{expanded ? 'Less' : 'Full message'}</button>}
   {notice.action === 'setup' && <button className="vs-link" onClick={onSetup}>Open setup</button>}
  </span>
 </div>;
}

/**
 * A silence measurement or timing calibration in progress, from the screen or an agent request.
 * Shown outside the collapsible setup so its countdown and Cancel are never hidden.
 */
export function ActiveInputRun({ voice, state }: { voice: VoiceInput; state: VoiceInputState }) {
 const silence = state.silenceRun, run = state.calibrationRun;
 if (!silence && !run && !state.inputActionRunning) return null;
 const who = state.inputActionRunning ? 'Agent request: ' : '';
 return <div role="status" aria-live="polite" aria-label="Input calibration in progress" className="vs-active">
  {silence ? (silence.phase === 'countdown'
   ? <div><b style={{ fontSize: 20 }}>{who}Stay quiet… {silence.countdownLeft}</b></div>
   : <div><b>{who}Measuring room noise</b> · stay quiet; voices are excluded (up to 6 s)</div>)
   : run ? (run.phase === 'countdown'
    ? <div><b style={{ fontSize: 20 }}>{who}Get ready… {run.countdownLeft}</b></div>
    : <>
     <div><b>{who}{run.phase === 'practice' ? `Practice ${run.practiceDone}/4` : run.phase === 'measuring' ? `Measuring ${run.measuredDone}/${run.measuredTotal}` : 'Analysing…'}</b>{run.phase !== 'analysing' && ' · tap with each click'}</div>
     <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }} aria-hidden="true">
      {Array.from({ length: 4 + run.measuredTotal }, (_, i) => {
       const done = i < 4 ? i < run.practiceDone : i - 4 < run.measuredDone;
       return <span key={i} style={{ width: 14, height: 8, borderRadius: 2, background: done ? (i < 4 ? C.muted : C.ok) : C.raised }} />;
      })}
     </div>
    </>)
   : <div><b>The agent is changing input settings</b> · input controls wait until it finishes</div>}
  {(silence || run) && <button onClick={() => voice.cancelCalibration()}>Cancel</button>}
 </div>;
}
