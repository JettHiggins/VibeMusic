import React, { useRef, useState } from 'react';
import type { SessionCommand, SessionState, Transport } from '@voicesynth/contracts';
import { exportSession, importSession, listSaved, loadLocal, saveLocal, type SessionFile } from '../persistence/session-file.ts';

interface Props {
 session: SessionState;
 transport: Transport | null;
 enabled: boolean;
 dispatch: (operation: SessionCommand['operation'], boundary?: SessionCommand['boundary']) => void;
}

/**
 * Save, load, import and export. Saving reads the authoritative snapshot; loading proposes
 * `load-session` at the next loop and the engine validates it again (EDITING.md).
 */
export function SessionPanel({ session, transport, enabled, dispatch }: Props) {
 const [name, setName] = useState('My groove');
 const [saved, setSaved] = useState(() => listSaved());
 const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
 const file = useRef<HTMLInputElement>(null);
 const recording = (transport?.recordingState ?? 'idle') !== 'idle';

 const load = (f: SessionFile, source: string) => {
  if (recording) { setMessage({ text: 'Finish the take before loading a session.', error: true }); return; }
  dispatch({ type: 'load-session', session: f.session }, 'next-loop');
  setMessage({ text: `Loading “${f.name}” from ${source}${transport?.playing ? ' at the next loop' : ''}. Undo restores the previous session.` });
 };
 const attempt = (task: () => void) => { try { task(); } catch (e) { setMessage({ text: e instanceof Error ? e.message : String(e), error: true }); } };

 return <section aria-label="Session" style={{ border: '1px solid #8884', borderRadius: 8, padding: 16, marginTop: 24 }}>
  <h2 style={{ marginTop: 0 }}>Session</h2>
  <form style={row} onSubmit={e => { e.preventDefault(); attempt(() => { const f = saveLocal(session, name); setSaved(listSaved()); setMessage({ text: `Saved “${f.name}” in this browser.` }); }); }}>
   <label>Name <input value={name} maxLength={60} onChange={e => setName(e.target.value)} /></label>
   <button type="submit">Save</button>
   <button type="button" onClick={() => attempt(() => download(exportSession(session, name), `${slug(name)}.voicesynth.json`))}>Export file</button>
   <button type="button" disabled={!enabled || recording} onClick={() => file.current?.click()}>Import file…</button>
   <input ref={file} type="file" accept=".json,application/json" hidden onChange={async e => {
    const chosen = e.target.files?.[0]; e.target.value = '';
    if (chosen) { const text = await chosen.text(); attempt(() => load(importSession(text), chosen.name)); }
   }} />
  </form>
  {saved.length > 0 && <ul aria-label="Saved sessions" style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
   {saved.map(s => <li key={s.name} style={{ ...row, margin: '4px 0' }}>
    <button disabled={!enabled || recording} onClick={() => attempt(() => load(loadLocal(s.name), 'this browser'))}>Load</button>
    <span>{s.name}</span><span style={{ fontSize: 12, opacity: 0.7 }}>{new Date(s.savedAt).toLocaleString()}</span>
   </li>)}
  </ul>}
  {!enabled && <p style={small}>Enable audio to load sessions; saving and exporting work any time.</p>}
  {message && <p role="status" style={{ ...small, color: message.error ? '#c33' : undefined }}>{message.text}</p>}
 </section>;
}

function download(text: string, filename: string) {
 const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
 const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' };
const small: React.CSSProperties = { fontSize: 13, margin: '6px 0' };
