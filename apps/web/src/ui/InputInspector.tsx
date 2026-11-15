import React, { useEffect, useRef, useState } from 'react';
import type { PitchSnap, Transport } from '@voicesynth/contracts';
import type { VoiceInput, VoiceInputState } from '../input/voice-input.ts';
import { listAudioInputs } from '../input/devices.ts';
import { effectiveLatencyFrames } from '../input/calibration.ts';
import { CalibrationPanel } from './CalibrationPanel.tsx';
import { ActiveInputRun, InputReadout, Notices } from './InputSummary.tsx';
import { summarizeInput } from './input-summary.ts';
import { C } from './theme.ts';

/**
 * Inspector section for microphone input. The essentials stay visible (mic button, status, level,
 * heard/output pitch, key, the most important notice and any running calibration with Cancel);
 * device/profile/hands-free/timing setup and diagnostic reports are deliberate optional sections.
 */
export function InputInspector({ voice, state, transport, enabled, melodic, pitchSnap }: { voice: VoiceInput; state: VoiceInputState; transport: Transport | null; enabled: boolean; melodic: boolean; pitchSnap?: PitchSnap | null }) {
 const [busy, setBusy] = useState(false);
 const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
 const [deviceId, setDeviceId] = useState('');
 const setup = useRef<HTMLDetailsElement>(null);
 const micReady = state.microphone === 'on' || state.microphone === 'test-signal';
 const recording = (transport?.recordingState ?? 'idle') !== 'idle';
 const run = (task: () => Promise<unknown>) => { setBusy(true); task().catch(() => {}).finally(() => setBusy(false)); };
 useEffect(() => { if (state.microphone === 'on') listAudioInputs().then(setDevices).catch(() => setDevices([])); }, [state.microphone]);
 const summary = summarizeInput(state, melodic, pitchSnap);
 const openSetup = () => { const d = setup.current; if (!d) return; d.open = true; d.querySelector('summary')?.focus(); d.scrollIntoView?.({ block: 'nearest' }); };
 const speech = state.speech;

 return <div aria-label="Input" style={{ display: 'grid', gap: 8, minWidth: 0 }}>
  <div className="vs-row">
   <button disabled={!enabled || busy || state.microphone === 'starting'} onClick={() => run(() => voice.enableMicrophone(deviceId || undefined))} style={micReady ? undefined : { background: C.accent, color: '#111' }}>{micReady ? 'Restart mic' : 'Enable microphone'}</button>
   <button disabled={!micReady || busy || !!state.calibrating || state.inputActionRunning} title={state.inputActionRunning ? 'The agent is changing input settings' : 'Re-measure the room floor (stay quiet for a few seconds)'} onClick={() => run(() => voice.calibrateNoise())}>Measure silence</button>
  </div>
  <InputReadout summary={summary} melodic={melodic} />
  <ActiveInputRun voice={voice} state={state} />
  <Notices notices={summary.notices} onSetup={openSetup} />
  <label className="vs-row" style={{ gap: 6 }}>
   <input type="checkbox" aria-label="Hands-free commands (local service)" checked={speech.enabled} onChange={e => { if (e.target.checked) void voice.enableHandsFree(); else voice.setHandsFree(false); }} />
   <span>Hands-free commands</span>

  </label>
  {speech.enabled && speech.status === 'unavailable' && <div><button onClick={() => { void voice.enableHandsFree(); }}>Retry speech</button></div>}

  <details ref={setup} className="vs-sub">
   <summary>Microphone setup</summary>
   <div style={{ display: 'grid', gap: 6 }}>
    {devices.length > 1 && <label className="vs-field">Input device <select value={deviceId} disabled={busy || recording} onChange={e => { setDeviceId(e.target.value); run(() => voice.enableMicrophone(e.target.value || undefined)); }}>
     <option value="">System default</option>
     {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
    </select></label>}
    <label className="vs-field">Capture profile <select aria-label="Capture profile" value={state.processingProfile} disabled={busy || recording || state.inputActionRunning} onChange={e => run(() => voice.setProcessingProfile(e.target.value as 'noisy-room' | 'music'))}>
     <option value="noisy-room">Noisy room · cleanup on</option>
     <option value="music">Music · less processing</option>
    </select></label>
    <div style={{ color: C.muted }}>
     {state.calibration ? <>Room floor {state.calibration.noiseFloorDb.toFixed(0)} dBFS · timing compensation {Math.round(effectiveLatencyFrames(state.calibration) / state.calibration.sampleRate * 1000)} ms</> : 'Not calibrated'}
    </div>
    {micReady && <CalibrationPanel voice={voice} state={state} disabled={busy || state.calibrating === 'noise' || state.inputActionRunning} playing={!!transport?.playing} />}
   </div>
  </details>

 </div>;
}
