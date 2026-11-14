import React, { useState } from 'react';
import type { VoiceInput, VoiceInputState } from '../input/voice-input.ts';

/**
 * Guided timing calibration: instructions, a visible countdown, practice and measured clicks with
 * progress, Cancel, the result (offset, consistency, matched taps), and a per-device recording
 * offset trim. A failed or cancelled run keeps the previous calibration.
 */
export function CalibrationPanel({ voice, state, disabled, playing }: { voice: VoiceInput; state: VoiceInputState; disabled: boolean; playing: boolean }) {
 const [open, setOpen] = useState(false);
 const run = state.calibrationRun;
 const cal = state.calibration;
 const result = state.calibrationResult;
 const measuredMs = cal ? Math.round(cal.latencyFrames / cal.sampleRate * 1000) : null;
 const trim = cal?.offsetAdjustMs ?? 0;
 const [verify, setVerify] = useState(false);
 const start = () => { void voice.calibrateLatency({ verify }); };

 return <div aria-label="Timing calibration" style={box}>
  <div style={row}>
   <strong>Timing</strong>
   {cal && <span>{cal.latencySource === 'tap-along' ? `measured ${measuredMs} ms` : `browser estimate ${measuredMs} ms (not measured)`}{trim ? `, trim ${trim > 0 ? '+' : ''}${trim} ms` : ''}</span>}
   {!run && <button disabled={disabled || playing} title={playing ? 'Stop playback first' : undefined} onClick={() => { setVerify(false); setOpen(o => !o || verify); }}>{open && !verify ? 'Close' : 'Calibrate timing…'}</button>}
   {!run && cal?.latencySource === 'tap-along' && <button disabled={disabled || playing} title="Tap along again to check the current timing without changing it" onClick={() => { setVerify(true); setOpen(o => !o || !verify); }}>{open && verify ? 'Close' : 'Check timing…'}</button>}
  </div>

  {open && !run && <div style={{ margin: '6px 0' }}>
   <ol style={{ margin: '4px 0 6px 18px', padding: 0 }}>
    <li>Put on the headphones you will record with.</li>
    <li>After a 3-second countdown you will hear <b>4 practice clicks</b> (lower pitch), then <b>8 measured clicks</b>.</li>
    <li>Tap the desk sharply or say “t” exactly <b>with</b> each click. Keep tapping through the practice clicks to find the beat.</li>
   </ol>
   <button disabled={disabled || playing} onClick={start}>{verify ? 'Start timing check' : 'Start calibration'}</button>
  </div>}

  {run && <div role="status" aria-live="polite" style={{ margin: '6px 0' }}>
   {run.phase === 'countdown'
    ? <div style={{ fontSize: 28, fontWeight: 700 }}>Get ready… {run.countdownLeft}</div>
    : <>
     <div>{run.phase === 'practice' ? `Practice ${run.practiceDone}/4: tap with the clicks` : run.phase === 'measuring' ? `Measuring ${run.measuredDone}/${run.measuredTotal}: keep tapping` : 'Analysing…'}</div>
     <div style={{ display: 'flex', gap: 3, margin: '4px 0' }}>
      {Array.from({ length: 4 + run.measuredTotal }, (_, i) => {
       const done = i < 4 ? i < run.practiceDone : i - 4 < run.measuredDone;
       return <span key={i} style={{ width: 16, height: 8, borderRadius: 2, background: done ? (i < 4 ? '#888' : '#2a8') : '#8883' }} />;
      })}
     </div>
    </>}
   <button onClick={() => voice.cancelCalibration()}>Cancel</button>
  </div>}

  {result && !run && <div role="status" style={{ color: result.ok ? '#2a8' : '#e0a030' }}>{result.ok ? '✓ ' : '⚠ '}{result.text}
   {result.suggestTrimMs !== undefined && <> <button disabled={disabled} onClick={() => voice.setOffsetAdjust(result.suggestTrimMs!)}>Apply trim {result.suggestTrimMs > 0 ? '+' : ''}{result.suggestTrimMs} ms</button></>}
  </div>}

  {cal && !run && <div style={row}>
   <label htmlFor="offset-trim">Recording offset trim</label>
   <input id="offset-trim" type="range" min={-100} max={100} step={1} value={trim} disabled={disabled} onChange={e => voice.setOffsetAdjust(Number(e.target.value))} />
   <span style={{ minWidth: 64 }}>{trim > 0 ? '+' : ''}{trim} ms</span>
   {trim !== 0 && <button disabled={disabled} onClick={() => voice.setOffsetAdjust(0)}>Reset</button>}
   <span style={{ opacity: 0.7 }}>Hits still late? Increase. Early? Decrease.</span>
  </div>}
 </div>;
}

const box: React.CSSProperties = { border: '1px dashed #8886', borderRadius: 6, padding: '6px 10px', margin: '6px 0', fontSize: 13 };
const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0' };
