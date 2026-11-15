import React, { useEffect, useRef, useState } from 'react';
import type { VoiceInput, VoiceInputState } from '../input/voice-input.ts';
import { ActiveInputRun } from './InputSummary.tsx';
import { Icon } from './Icon.tsx';

/** Prompt before acquiring the mic or starting clicks; the existing calibration owns all timing. */
export function TimingSetup({ open, onClose, voice, input, playing }: { open: boolean; onClose: () => void; voice: VoiceInput; input: VoiceInputState; playing: boolean }) {
 const dialog = useRef<HTMLDialogElement>(null);
 const [starting, setStarting] = useState(false);
 const [error, setError] = useState('');
 const [attempted, setAttempted] = useState(false);
 const cancelled = useRef(false);
 const active = starting || !!input.calibrationRun;
 useEffect(() => {
  const el = dialog.current;
  if (open) { cancelled.current = false; setError(''); setAttempted(false); el?.showModal(); }
  else el?.close();
 }, [open]);
 useEffect(() => () => { cancelled.current = true; }, []);
 const close = () => { cancelled.current = true; if (input.calibrationRun) voice.cancelCalibration(); onClose(); };
 const start = async () => {
  setStarting(true); setError(''); setAttempted(true);
  try {
   if (!['on', 'test-signal'].includes(voice.getState().microphone)) await voice.enableMicrophone();
   // Permission can resolve after the user dismissed the dialog. Never start hidden clicks.
   if (cancelled.current) return;
   await voice.calibrateLatency();
  } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  finally { setStarting(false); }
 };
 return <dialog ref={dialog} className="vs-timing-dialog" aria-labelledby="timing-title" aria-describedby="timing-instructions" onCancel={e => { e.preventDefault(); close(); }}>
  <div className="vs-dialog-heading"><h2 id="timing-title">Check your timing</h2><button className="vs-icon-button" aria-label="Close timing test" onClick={close}><Icon name="close" /></button></div>
  <p id="timing-instructions">Wear headphones. Tap the desk or say “t” with each click.</p>
  <div className="vs-timing-steps" aria-label="Timing test steps"><span><b>3s</b> Get ready</span><span><b>4</b> Practice clicks</span><span><b>8</b> Measured taps</span></div>
  {playing && <p role="status">Stop playback to test timing.</p>}
  {active && <ActiveInputRun voice={voice} state={input} />}
  {starting && !input.calibrationRun && <p role="status">Waiting for microphone…</p>}
  {error && <p role="alert">{error}</p>}
  {attempted && !active && input.calibrationResult && <p role="status">{input.calibrationResult.text}</p>}
  <div className="vs-dialog-actions"><button onClick={close}>{attempted && !active ? 'Done' : active ? 'Cancel' : 'Not now'}</button>
   <button className="vs-primary" disabled={active || playing || input.inputActionRunning || !!input.calibrating} onClick={() => void start()}>{attempted ? 'Test again' : 'Start timing test'}</button></div>
 </dialog>;
}
