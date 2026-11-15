import React, { useState } from 'react';
import type { HeardSpeech } from './voice-feedback.ts';

/** Optional command entry beside the last real recognition result, below the editor. */
export function TranscriptPanel({ enabled, connected, heard, onConnect, onSubmit }: {
 enabled: boolean; connected: boolean; heard: HeardSpeech | null;
 onConnect: () => Promise<void>; onSubmit: (text: string) => void;
}) {
 const [text, setText] = useState('');
 const [connecting, setConnecting] = useState(false);
 const [error, setError] = useState('');
 const connect = async () => {
  setError(''); setConnecting(true);
  try { await onConnect(); }
  catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  finally { setConnecting(false); }
 };
 const submit = (event: React.FormEvent) => {
  event.preventDefault();
  if (!text.trim()) return;
  try { setError(''); onSubmit(text.trim()); }
  catch (e) { setError(e instanceof Error ? e.message : String(e)); }
 };
 return <details open className="vs-transcript" aria-label="Transcript">
  <summary>Transcript</summary>
  <div className="vs-transcript-connection">
   <span>{connected ? 'Connected' : 'Disconnected'}</span>
   {!connected && <button disabled={!enabled || connecting} onClick={() => void connect()}>{connecting ? 'Connecting…' : 'Connect agent'}</button>}
  </div>
  {heard && <div className="vs-transcript-heard" role="status" aria-live="polite"><span>Heard</span> {heard.text}</div>}
  <form onSubmit={submit}>
   <label className="vs-sr" htmlFor="command-transcript">Command transcript</label>
   <input id="command-transcript" name="command-transcript" autoComplete="off" placeholder="Groove, set tempo to 120…" value={text} onChange={e => setText(e.target.value)} />
   <button type="submit" disabled={!enabled || !connected}>Send transcript</button>
  </form>
  {error && <p role="alert">{error}</p>}
 </details>;
}
