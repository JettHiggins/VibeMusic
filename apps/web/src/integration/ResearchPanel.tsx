import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { SessionState } from '@voicesynth/contracts';
import type { ResearchController, ResearchState } from './research.ts';
import { Icon } from '../ui/Icon.tsx';

/** Visible even while the inspector is scrolled away; no estimated/fabricated progress. */
export function ResearchProgress({ state, onCancel }: { state: ResearchState; onCancel: () => void }) {
 const running = state.status === 'running';
 const failed = !running && !!state.error;
 if (!running && !state.candidates.length && !failed) return null;
 return <div className="vs-generation" data-error={failed} aria-label="Sound generation" aria-busy={running}>
  <span className={running ? 'vs-spinner' : 'vs-ready-dot'} aria-hidden="true" />
  <div className="vs-generation-copy"><span role="status" aria-live="polite">{failed ? 'Sound generation failed' : running ? state.candidates.length ? 'Refining sounds…' : 'Generating sound…' : `${state.candidates.length} sounds ready`}</span>
   <span className="vs-generation-description" title={failed ? state.error ?? undefined : state.description}>{failed ? state.error : state.description}</span></div>
  {running ? <><progress aria-label="Synth generation progress" max={1} value={state.progress > 0 ? state.progress : undefined} /><button onClick={onCancel}>Cancel</button></>
   : state.candidates.length > 0 ? <a href="#sound-results">View sounds</a> : null}
 </div>;
}

export function ResearchPanel({ controller, session, connected, enabled, connect }: { controller: ResearchController; session: SessionState; connected: boolean; enabled: boolean; connect?: () => Promise<void> }) {
 const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
 const [description, setDescription] = useState('');
 const [error, setError] = useState<string | null>(null);
 const [connecting, setConnecting] = useState(false);
 useEffect(() => { controller.setAudioEnabled(enabled); return () => controller.setAudioEnabled(false); }, [controller, enabled]);
 const attempt = (action: () => void) => { try { setError(null); action(); } catch (e) { setError(String(e)); } };
 const generate = async () => {
  setError(null); setConnecting(true);
  // Bind the submitted description/track before awaiting the connection.
  const trackId = session.selected.trackId, text = description;
  try { if (!connected) await connect?.(); controller.request(trackId, text); }
  catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  finally { setConnecting(false); }
 };
 const running = state.status === 'running';
 return <section aria-label="Sound research" className="vs-research" id="sound-results">
  <h2>Find a sound</h2>
  <form onSubmit={e => { e.preventDefault(); void generate(); }}>
   <label className="vs-field">Describe a sound<input name="sound-description" autoComplete="off" placeholder="e.g. warm electric piano…" value={description} onChange={e => setDescription(e.target.value)} /></label>
   <button className="vs-generate-button" disabled={(!connected && !connect) || !enabled || session.selected.trackId === 'drums' || state.acceptance?.status === 'queued' || running || connecting}>
    {running || connecting ? <span className="vs-spinner" aria-hidden="true" /> : <Icon name="search" />}{connecting ? 'Connecting…' : running ? 'Generating…' : 'Generate sound'}
   </button>
  </form>
  {(error || state.error) && <p role="alert">{error || state.error}</p>}
  {state.candidates.map((candidate, i) => <article key={candidate.id} className="vs-sound-option">
   <b>Sound {i + 1}</b><div className="vs-row">
    <button type="button" disabled={!enabled || !connected || !candidate.previewUrl} onClick={() => attempt(() => controller.preview(candidate.id))}>Preview candidate {i + 1}</button>
    <button disabled={!enabled || state.acceptance?.status === 'queued'} onClick={() => attempt(() => controller.accept(candidate.id))}>Use candidate {i + 1}</button>
   </div>
  </article>)}
  {state.preview && ['starting', 'playing', 'failed'].includes(state.preview.status) && <div className="vs-row"><span role="status">{state.preview.reason || (state.preview.status === 'starting' ? 'Loading preview…' : 'Playing preview')}</span>
   {state.preview.status !== 'failed' && <button type="button" onClick={() => controller.stopPreview()}>Stop preview</button>}</div>}
  {state.acceptance && <p role="status">{state.acceptance.reason ?? (state.acceptance.status === 'queued' ? 'Applying sound…' : state.acceptance.status === 'applied' ? 'Sound applied' : 'Sound change rejected')}</p>}
 </section>;
}
