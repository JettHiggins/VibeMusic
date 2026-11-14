import React, { useEffect, useState } from 'react';
import type { SessionCommand, SessionState, Transport } from '@voicesynth/contracts';
import type { VoiceInput, VoiceInputState } from '../input/voice-input.ts';
import { listAudioInputs } from '../input/devices.ts';
import { MicCheckPanel } from './MicCheckPanel.tsx';

type Lane = 'kick' | 'snare' | 'closed-hat';
type Target = SessionState['selected'];
/** Drum lanes are beatboxed (onsets); synth tracks are sung (monophonic notes). */
const TARGETS: { target: Target; label: string }[] = [
 { target: { trackId: 'drums', lane: 'kick' }, label: 'Kick' },
 { target: { trackId: 'drums', lane: 'snare' }, label: 'Snare' },
 { target: { trackId: 'drums', lane: 'closed-hat' }, label: 'Hats' },
 { target: { trackId: 'synth-1' }, label: 'Synth 1' },
 { target: { trackId: 'synth-2' }, label: 'Synth 2' },
 { target: { trackId: 'synth-3' }, label: 'Synth 3' },
];
const same = (a: Target, b: Target) => a.trackId === b.trackId && (a.lane ?? null) === (b.lane ?? null);
const labelOf = (t: Target) => TARGETS.find(x => same(x.target, t))?.label ?? t.trackId;
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

interface Props {
 voice: VoiceInput;
 session: SessionState;
 transport: Transport | null;
 enabled: boolean;
 dispatch: (operation: SessionCommand['operation'], boundary?: SessionCommand['boundary']) => void;
}

/** Voice recording: microphone setup, take control, and live feedback for the recording target. */
export function InputPanel({ voice, session, transport, enabled, dispatch }: Props) {
 const [state, setState] = useState<VoiceInputState>(voice.getState());
 const [busy, setBusy] = useState(false);
 useEffect(() => { voice.onChange = setState; return () => { voice.onChange = () => {}; }; }, [voice]);


 const recordingState = transport?.recordingState ?? 'idle';
 // While a take is armed or running, show the engine's recording target, not the UI selection.
 const target: Target = recordingState === 'armed' ? transport?.armedTarget ?? session.selected : recordingState === 'recording' ? transport?.recordingTarget ?? session.selected : session.selected;
 const track = session.tracks.find(t => t.id === target.trackId)!;
 const melodic = target.trackId !== 'drums';
 const label = labelOf(target);
 const position = transport ? describePosition(transport, session.tempo) : null;
 const cells: Cell[] = Array.from({ length: 64 }, () => ({ on: false, start: false, pending: false }));
 if (melodic) for (const n of track.notes) for (let i = 0; i < n.duration; i++) cells[(n.step + i) % 64] = { ...cells[(n.step + i) % 64], on: true, start: i === 0, label: i === 0 ? noteName(n.midi) : undefined };
 else for (const h of track.hits) if (h.lane === target.lane) cells[h.step] = { ...cells[h.step], on: true, start: true };
 for (const p of state.recorder.provisional) if (same(p.event.target, target)) for (let i = 0; i < p.duration; i++) cells[(p.step + i) % 64].pending = true;
 const micReady = state.microphone === 'on' || state.microphone === 'test-signal';
 const run = (task: () => Promise<void>) => { setBusy(true); task().catch(() => {}).finally(() => setBusy(false)); };
 const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
 const [deviceId, setDeviceId] = useState<string>('');
 useEffect(() => { if (state.microphone === 'on') listAudioInputs().then(setDevices).catch(() => setDevices([])); }, [state.microphone]);
 const uncalibrated = state.microphone === 'on' && !state.readiness.ready;

 return <section aria-label="Voice recording" style={{ border: '1px solid #8884', borderRadius: 8, padding: 16, marginTop: 24 }}>
  <h2 style={{ marginTop: 0 }}>Record with your voice</h2>
  <p style={small}>Manual microphone takes: use the controls to start and stop. Speech recognition is not connected yet.</p>
  <div style={row}>
   <button disabled={!enabled || busy || state.microphone === 'starting'} onClick={() => run(() => voice.enableMicrophone(deviceId || undefined))}>{micReady ? 'Restart microphone' : 'Enable microphone'}</button>
   {devices.length > 1 && <label style={small}>Input <select value={deviceId} disabled={busy || recordingState !== 'idle'} onChange={e => { setDeviceId(e.target.value); run(() => voice.enableMicrophone(e.target.value || undefined)); }}>
    <option value="">System default</option>
    {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
   </select></label>}
   <Meter db={state.levelDb} floor={state.calibration?.noiseFloorDb ?? -60} active={micReady} />
   <button disabled={!micReady || busy || !!state.calibrating} onClick={() => run(() => voice.calibrateNoise())}>Measure silence</button>
   <button disabled={!micReady || busy || !!state.calibrating || !!transport?.playing} title={transport?.playing ? 'Stop playback first' : undefined} onClick={() => run(() => voice.calibrateLatency())}>Calibrate timing</button>
  </div>
  <p style={small}>
   {state.calibration ? <>Noise floor {state.calibration.noiseFloorDb.toFixed(0)} dBFS · latency {Math.round(state.calibration.latencyFrames / state.calibration.sampleRate * 1000)} ms ({state.calibration.latencySource === 'tap-along' ? 'calibrated' : 'browser estimate — calibrate for tight timing'})</> : 'Use headphones. Microphone audio is analysed locally and never stored.'}
   {state.analysisP95Ms !== null && <> · analysis p95 {state.analysisP95Ms.toFixed(1)} ms</>}
  </p>
  {micReady && <MicCheckPanel state={state} onReport={() => voice.testReport()} />}

  {uncalibrated && recordingState === 'idle' && <p role="note" style={{ ...small, color: '#e0a030' }}>⚠ {state.readiness.advice}</p>}
  <div style={row} role="group" aria-label="Recording target">
   {TARGETS.map(({ target: t, label: l }) => <button key={l} aria-pressed={same(target, t)} disabled={!enabled || recordingState !== 'idle'} style={same(target, t) ? selectedStyle : undefined} onClick={() => dispatch({ type: 'select', target: t })}>{l}</button>)}
  </div>
  <div style={row}>
   {recordingState === 'idle'
    ? <button disabled={!enabled || !micReady} style={recordStyle} title={uncalibrated ? state.readiness.advice : undefined} onClick={() => dispatch({ type: 'record', target }, 'next-loop')}>● Record {label}{uncalibrated ? ' (uncalibrated)' : ''}</button>
    : <button disabled={!enabled} style={recordStyle} onClick={() => dispatch({ type: 'stop-recording' })}>■ Stop recording</button>}
   <button disabled={!enabled} onClick={() => dispatch({ type: 'play', playing: !transport?.playing })}>{transport?.playing ? 'Stop playback' : 'Play'}</button>
   <button disabled={!enabled || recordingState === 'recording'} onClick={() => dispatch({ type: 'clear', target }, 'next-loop')}>Clear {label}</button>
   <button disabled={!enabled} onClick={() => dispatch({ type: 'undo' }, 'next-loop')}>Undo</button>
   <button disabled={!enabled} aria-pressed={track.muted} onClick={() => dispatch({ type: 'mute', trackId: track.id, muted: !track.muted })}>{track.muted ? 'Unmute' : 'Mute'} {melodic ? label : 'drums'}</button>
   <button disabled={!enabled || recordingState === 'recording' || session.tempo <= 40} onClick={() => dispatch({ type: 'tempo', bpm: Math.max(40, session.tempo - 5) }, 'next-loop')}>−5 BPM</button>
   <span style={small}>{session.tempo} BPM</span>
   <button disabled={!enabled || recordingState === 'recording' || session.tempo >= 240} onClick={() => dispatch({ type: 'tempo', bpm: Math.min(240, session.tempo + 5) }, 'next-loop')}>+5 BPM</button>
  </div>

  <p role="status" aria-live="polite" style={{ ...small, fontWeight: 600, color: recordingState === 'recording' ? '#d33' : recordingState === 'armed' ? '#c80' : undefined }}>
   {recordingState === 'armed' ? `Count-in — recording ${label} starts at the next downbeat` : recordingState === 'recording' ? `Recording ${label} — ${melodic ? 'sing now; sing over a phrase to replace it' : 'beatbox now'}` : 'Not recording'}
   {position && <> · bar {position.bar} beat {position.beat}</>}
  </p>
  <Grid cells={cells} playhead={position?.step ?? null} label={`${label} pattern`} />
  <p style={small}>
   {state.recorder.committed} {melodic ? 'note' : 'hit'} event(s) committed · {state.recorder.provisional.length} pending · {state.recorder.dropped} ignored
   {state.recorder.inFlight && ' · applying at next loop'}
  </p>
  {(state.message || state.recorder.lastError) && <p style={{ ...small, color: '#c33' }}>{state.recorder.lastError ?? state.message}</p>}
 </section>;
}

export function displayedLane(session:SessionState,transport:Transport|null):Lane {
 const target=transport?.recording?transport.recordingTarget:transport?.recordingState==='armed'?transport.armedTarget:session.selected;
 return target?.lane??session.selected.lane??'kick';
}

function describePosition(t: Transport, tempo: number) {
 if (!t.playing) return null;
 const stepFrames = t.sampleRate * 60 / (tempo * 4);
 const step = Math.floor((t.currentFrame - t.loopStartFrame) / stepFrames);
 if (step < 0) return null;
 const wrapped = step % 64;
 return { step: wrapped, bar: Math.floor(wrapped / 16) + 1, beat: Math.floor(wrapped % 16 / 4) + 1 };
}

function Meter({ db, floor, active }: { db: number; floor: number; active: boolean }) {
 const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
 const floorPct = Math.max(0, Math.min(100, (floor + 60) / 60 * 100));
 return <div aria-label={`Input level ${active ? db.toFixed(0) + ' dBFS' : 'off'}`} role="meter" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(db)} style={{ position: 'relative', width: 140, height: 10, background: '#8883', borderRadius: 5, overflow: 'hidden' }}>
  <div style={{ width: `${active ? pct : 0}%`, height: '100%', background: db > -3 ? '#d33' : '#2a8' }} />
  <div style={{ position: 'absolute', left: `${floorPct}%`, top: 0, bottom: 0, width: 2, background: '#888' }} />
 </div>;
}

interface Cell { on: boolean; start: boolean; pending: boolean; label?: string }
function Grid({ cells, playhead, label }: { cells: Cell[]; playhead: number | null; label: string }) {
 return <div aria-label={label} style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: 3, maxWidth: 560 }}>
  {cells.map((cell, step) => <div key={step} title={`Bar ${Math.floor(step / 16) + 1}, step ${step % 16 + 1}${cell.label ? ` · ${cell.label}` : ''}`} style={{
   height: 18, borderRadius: 3, fontSize: 9, lineHeight: '18px', paddingLeft: 2, overflow: 'hidden', whiteSpace: 'nowrap', color: '#fff',
   background: cell.on ? (cell.start ? '#2a8' : '#2a8a') : step % 4 === 0 ? '#8884' : '#8882',
   outline: cell.pending ? '2px dashed #c80' : playhead === step ? '2px solid #888' : undefined, outlineOffset: -2,
  }}>{cell.label}</div>)}
 </div>;
}

const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' };
const small: React.CSSProperties = { fontSize: 13, margin: '6px 0' };
const selectedStyle: React.CSSProperties = { fontWeight: 700, outline: '2px solid #2a8' };
const recordStyle: React.CSSProperties = { color: '#d33', fontWeight: 700 };
