import React, { useEffect, useState } from 'react';
import type { SessionCommand, SessionState, Transport } from '@voicesynth/contracts';
import type { VoiceInput, VoiceInputState } from '../input/voice-input.ts';

type Lane = 'kick' | 'snare' | 'closed-hat';
const LANES: Lane[] = ['kick', 'snare', 'closed-hat'];
const LABEL: Record<Lane, string> = { kick: 'Kick', snare: 'Snare', 'closed-hat': 'Hats' };

interface Props {
 voice: VoiceInput;
 session: SessionState;
 transport: Transport | null;
 enabled: boolean;
 dispatch: (operation: SessionCommand['operation'], boundary?: SessionCommand['boundary']) => void;
}

/** Drum recording: microphone setup, take control, and live feedback for the selected lane. */
export function InputPanel({ voice, session, transport, enabled, dispatch }: Props) {
 const [state, setState] = useState<VoiceInputState>(voice.getState());
 const [busy, setBusy] = useState(false);
 useEffect(() => { voice.onChange = setState; return () => { voice.onChange = () => {}; }; }, [voice]);

 const drums = session.tracks.find(t => t.id === 'drums')!;
 const lane: Lane = (transport?.recordingTarget?.lane ?? session.selected.lane ?? 'kick') as Lane;
 const recordingState = transport?.recordingState ?? 'idle';
 const position = transport ? describePosition(transport, session.tempo) : null;
 const committed = new Set(drums.hits.filter(h => h.lane === lane).map(h => h.step));
 const provisional = new Set(state.recorder.provisional.filter(p => p.event.target.lane === lane).map(p => p.step));
 const micReady = state.microphone === 'on' || state.microphone === 'test-signal';
 const run = (task: () => Promise<void>) => { setBusy(true); task().catch(() => {}).finally(() => setBusy(false)); };

 return <section aria-label="Drum recording" style={{ border: '1px solid #8884', borderRadius: 8, padding: 16, marginTop: 24 }}>
  <h2 style={{ marginTop: 0 }}>Beatbox drums</h2>
  <div style={row}>
   <button disabled={!enabled || busy || state.microphone === 'starting'} onClick={() => run(() => voice.enableMicrophone())}>{micReady ? 'Restart microphone' : 'Enable microphone'}</button>
   <Meter db={state.levelDb} floor={state.calibration?.noiseFloorDb ?? -60} active={micReady} />
   <button disabled={!micReady || busy || !!state.calibrating} onClick={() => run(() => voice.calibrateNoise())}>Measure silence</button>
   <button disabled={!micReady || busy || !!state.calibrating || !!transport?.playing} title={transport?.playing ? 'Stop playback first' : undefined} onClick={() => run(() => voice.calibrateLatency())}>Calibrate timing</button>
  </div>
  <p style={small}>
   {state.calibration ? <>Noise floor {state.calibration.noiseFloorDb.toFixed(0)} dBFS · latency {Math.round(state.calibration.latencyFrames / state.calibration.sampleRate * 1000)} ms ({state.calibration.latencySource === 'tap-along' ? 'calibrated' : 'browser estimate — calibrate for tight timing'})</> : 'Use headphones. Microphone audio is analysed locally and never stored.'}
   {state.analysisP95Ms !== null && <> · analysis p95 {state.analysisP95Ms.toFixed(1)} ms</>}
  </p>

  <div style={row} role="group" aria-label="Drum lane">
   {LANES.map(l => <button key={l} aria-pressed={lane === l} disabled={!enabled || recordingState !== 'idle'} style={lane === l ? selectedStyle : undefined} onClick={() => dispatch({ type: 'select', target: { trackId: 'drums', lane: l } })}>{LABEL[l]}</button>)}
   <span style={{ width: 16 }} />
   {recordingState === 'idle'
    ? <button disabled={!enabled || !micReady} style={recordStyle} onClick={() => dispatch({ type: 'record', target: { trackId: 'drums', lane } }, 'next-loop')}>● Record {LABEL[lane]}</button>
    : <button disabled={!enabled} style={recordStyle} onClick={() => dispatch({ type: 'stop-recording' })}>■ Stop recording</button>}
   <button disabled={!enabled} onClick={() => dispatch({ type: 'play', playing: !transport?.playing })}>{transport?.playing ? 'Stop playback' : 'Play'}</button>
  </div>
  <div style={row}>
   <button disabled={!enabled || recordingState === 'recording'} onClick={() => dispatch({ type: 'clear', target: { trackId: 'drums', lane } }, 'next-loop')}>Clear {LABEL[lane]}</button>
   <button disabled={!enabled} onClick={() => dispatch({ type: 'undo' }, 'next-loop')}>Undo</button>
   <button disabled={!enabled} aria-pressed={drums.muted} onClick={() => dispatch({ type: 'mute', trackId: 'drums', muted: !drums.muted })}>{drums.muted ? 'Unmute drums' : 'Mute drums'}</button>
   <button disabled={!enabled || recordingState === 'recording' || session.tempo <= 40} onClick={() => dispatch({ type: 'tempo', bpm: session.tempo - 5 }, 'next-loop')}>−5 BPM</button>
   <span style={small}>{session.tempo} BPM</span>
   <button disabled={!enabled || recordingState === 'recording' || session.tempo >= 240} onClick={() => dispatch({ type: 'tempo', bpm: session.tempo + 5 }, 'next-loop')}>+5 BPM</button>
  </div>

  <p role="status" aria-live="polite" style={{ ...small, fontWeight: 600, color: recordingState === 'recording' ? '#d33' : recordingState === 'armed' ? '#c80' : undefined }}>
   {recordingState === 'armed' ? `Count-in — recording ${LABEL[lane]} starts at the next downbeat` : recordingState === 'recording' ? `Recording ${LABEL[lane]} — beatbox now` : 'Not recording'}
   {position && <> · bar {position.bar} beat {position.beat}</>}
  </p>
  <Grid committed={committed} provisional={provisional} playhead={position?.step ?? null} />
  <p style={small}>
   {state.recorder.committed} hit(s) committed · {state.recorder.provisional.length} pending · {state.recorder.dropped} ignored
   {state.recorder.inFlight && ' · applying at next loop'}
  </p>
  {(state.message || state.recorder.lastError) && <p style={{ ...small, color: '#c33' }}>{state.recorder.lastError ?? state.message}</p>}
 </section>;
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

function Grid({ committed, provisional, playhead }: { committed: Set<number>; provisional: Set<number>; playhead: number | null }) {
 return <div aria-label="Selected lane pattern" style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: 3, maxWidth: 560 }}>
  {Array.from({ length: 64 }, (_, step) => {
   const on = committed.has(step), pending = provisional.has(step);
   return <div key={step} title={`Bar ${Math.floor(step / 16) + 1}, step ${step % 16 + 1}`} style={{
    height: 16, borderRadius: 3,
    background: on ? '#2a8' : step % 4 === 0 ? '#8884' : '#8882',
    outline: pending ? '2px dashed #c80' : playhead === step ? '2px solid #888' : undefined, outlineOffset: -2,
   }} />;
  })}
 </div>;
}

const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' };
const small: React.CSSProperties = { fontSize: 13, margin: '6px 0' };
const selectedStyle: React.CSSProperties = { fontWeight: 700, outline: '2px solid #2a8' };
const recordStyle: React.CSSProperties = { color: '#d33', fontWeight: 700 };
