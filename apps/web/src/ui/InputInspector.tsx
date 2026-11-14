import React, { useEffect, useState } from 'react';
import type { Transport } from '@voicesynth/contracts';
import type { VoiceInput, VoiceInputState } from '../input/voice-input.ts';
import { listAudioInputs } from '../input/devices.ts';
import { effectiveLatencyFrames } from '../input/calibration.ts';
import { MicCheckPanel } from './MicCheckPanel.tsx';
import { CalibrationPanel } from './CalibrationPanel.tsx';
import { C } from './theme.ts';

/** Inspector section for microphone input: device, level, silence, calibration and take status. */
export function InputInspector({ voice, state, transport, enabled, melodic }: { voice: VoiceInput; state: VoiceInputState; transport: Transport | null; enabled: boolean; melodic: boolean }) {
 const [busy, setBusy] = useState(false);
 const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
 const [deviceId, setDeviceId] = useState('');
 const micReady = state.microphone === 'on' || state.microphone === 'test-signal';
 const recording = (transport?.recordingState ?? 'idle') !== 'idle';
 const run = (task: () => Promise<unknown>) => { setBusy(true); task().catch(() => {}).finally(() => setBusy(false)); };
 useEffect(() => { if (state.microphone === 'on') listAudioInputs().then(setDevices).catch(() => setDevices([])); }, [state.microphone]);
 const heard = state.recorder.provisional.filter(p => p.status === 'provisional').length;
 const queued = state.recorder.provisional.filter(p => p.status === 'submitted').length;
 const unit = melodic ? 'note' : 'hit';

 return <div aria-label="Input" style={{ display: 'grid', gap: 6 }}>
  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
   <button disabled={!enabled || busy || state.microphone === 'starting'} onClick={() => run(() => voice.enableMicrophone(deviceId || undefined))}>{micReady ? 'Restart mic' : 'Enable microphone'}</button>
   <button disabled={!micReady || busy || !!state.calibrating} onClick={() => run(() => voice.calibrateNoise())}>Measure silence</button>
  </div>
  {devices.length > 1 && <label>Input <select value={deviceId} disabled={busy || recording} onChange={e => { setDeviceId(e.target.value); run(() => voice.enableMicrophone(e.target.value || undefined)); }}>
   <option value="">System default</option>
   {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
  </select></label>}
  <label>Capture profile <select aria-label="Capture profile" value={state.processingProfile} disabled={busy || recording} onChange={e => run(() => voice.setProcessingProfile(e.target.value as 'noisy-room' | 'music'))}>
   <option value="noisy-room">Noisy room · cleanup on</option>
   <option value="music">Music · less processing</option>
  </select></label>
  <small>{state.processingProfile === 'noisy-room' ? 'Recommended with background conversation. Browser noise suppression may soften attacks.' : 'Keeps microphone audio less processed; background noise can mask notes.'}</small>
  <label><input type="checkbox" checked={state.speech.enabled} onChange={e=>{if(e.target.checked)void voice.enableHandsFree();else voice.setHandsFree(false);}} /> Hands-free commands (local service)</label>
  {state.speech.enabled && <div role="status">{state.speech.message ?? 'Checking local speech recognition…'}{state.speech.status==='unavailable' && <button onClick={()=>{void voice.enableHandsFree();}}>Retry speech</button>}</div>}
  {state.speech.enabled && <small>Microphone audio streams continuously to your local service. Recording requires verified speech coverage.</small>}
  <Meter db={state.levelDb} floor={state.calibration?.noiseFloorDb ?? -60} active={micReady} />
  <div style={{ color: C.muted }}>
   {state.calibration ? <>Noise floor {state.calibration.noiseFloorDb.toFixed(0)} dBFS · compensation {Math.round(effectiveLatencyFrames(state.calibration) / state.calibration.sampleRate * 1000)} ms</> : 'Use headphones. Microphone audio is analysed locally and never stored.'}
   {state.analysisP95Ms !== null && <> · analysis p95 {state.analysisP95Ms.toFixed(1)} ms</>}
  </div>
  {state.microphone === 'on' && !state.readiness.ready && <div role="note" style={{ color: C.warn }}>⚠ {state.readiness.advice}</div>}
  {micReady && <MicCheckPanel state={state} onReport={() => voice.testReport()} />}
  {micReady && <CalibrationPanel voice={voice} state={state} disabled={busy || state.calibrating === 'noise'} playing={!!transport?.playing} />}
  {state.message && <div role="status" style={{ color: C.warn }}>{state.message}</div>}
  <div aria-label="Take status" style={{ color: C.muted }}>
   {heard} {unit}(s) heard · {queued} queued for next loop · {state.recorder.committed} committed · {state.recorder.dropped} ignored
   {state.recorder.lastError && <div style={{ color: C.warn }}>{state.recorder.lastError}</div>}
  </div>
 </div>;
}

function Meter({ db, floor, active }: { db: number; floor: number; active: boolean }) {
 const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
 const floorPct = Math.max(0, Math.min(100, (floor + 60) / 60 * 100));
 return <div aria-label={`Input level ${active ? db.toFixed(0) + ' dBFS' : 'off'}`} role="meter" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(db)}
  style={{ position: 'relative', height: 8, background: C.raised, borderRadius: 4, overflow: 'hidden' }}>
  <div style={{ width: `${active ? pct : 0}%`, height: '100%', background: db > -3 ? C.rec : C.note }} />
  <div style={{ position: 'absolute', left: `${floorPct}%`, top: 0, bottom: 0, width: 2, background: C.muted }} />
 </div>;
}
