import React, { useEffect, useState } from 'react';
import type { VoiceInput, VoiceInputState } from '../input/voice-input.ts';
import { Icon } from './Icon.tsx';

import type { HeardSpeech } from './voice-feedback.ts';
export type { HeardSpeech } from './voice-feedback.ts';

/** Audio activity is immediate; only the service transcript can confirm a recognized command. */
export function VoiceIndicator({ voice, input, enabled, heard }: { voice: VoiceInput; input: VoiceInputState; enabled: boolean; heard?: HeardSpeech | null }) {
 const [recent, setRecent] = useState(false);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 useEffect(() => {
  setRecent(!!heard && heard.outcome !== 'ignored');
  if (heard?.outcome === 'interpreting') return;
  const timer = window.setTimeout(() => setRecent(false), 5000);
  return () => window.clearTimeout(timer);
 }, [heard]);
 useEffect(() => { if (!input.speech.enabled) setRecent(false); }, [input.speech.enabled]);
 const ready = input.speech.enabled && input.speech.status === 'ready';
 const sound = ready && input.levelDb > Math.max(-55, (input.calibration?.noiseFloorDb ?? -65) + 8);
 const active = ready && (sound || recent);
 const label = !input.speech.enabled ? 'Voice off' : input.speech.status === 'unavailable' ? 'Voice unavailable' : !ready ? 'Connecting…'
  : recent && heard?.outcome === 'interpreting' ? 'Thinking…' : recent && heard?.outcome === 'held' ? 'Listening…'
  : recent && heard?.outcome === 'research' ? 'Finding sound…' : recent && heard?.outcome === 'refused' ? 'Try again'
  : recent && heard?.outcome === 'command' ? 'Command received' : sound ? 'Listening…' : 'Say “Groove”';
 const toggle = async () => {
  if (input.speech.enabled && input.speech.status !== 'unavailable') { voice.setHandsFree(false); return; }
  setBusy(true); setError('');
  try {
   if (!['on', 'test-signal'].includes(voice.getState().microphone)) await voice.enableMicrophone();
   await voice.enableHandsFree();
  } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  finally { setBusy(false); }
 };
 return <div className="vs-voice" data-active={active} data-state={input.speech.status}>
  <button type="button" className="vs-icon-button vs-mic-button" aria-label={input.speech.enabled ? input.speech.status === 'unavailable' ? 'Retry hands-free commands' : 'Turn off hands-free commands' : 'Enable hands-free commands'}
   aria-pressed={input.speech.enabled} disabled={!enabled || busy} title={input.speech.message ?? label} onClick={() => void toggle()}><Icon name="mic" /></button>
  <span className="vs-voice-copy"><span aria-hidden="true">{error || label}</span><span className="vs-sr" role="status" aria-live="polite">{error || (ready && !recent ? 'Listening for Groove' : label)}</span>
   {ready && recent && heard && <span className="vs-heard" title={heard.text}>{heard.text}</span>}
  </span>
 </div>;
}
