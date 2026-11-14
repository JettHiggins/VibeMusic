import React, { useEffect, useMemo, useReducer, useState } from 'react';
import type { SessionState } from '@voicesynth/contracts';
import type { FirmwareMetadata } from '../engine/metadata.ts';
import { PatchEditQueue, patchControls, withEngine, withParameter } from './patch-edit.ts';
import type { EditorEngine } from './PatternEditor.tsx';

type TrackId = SessionState['tracks'][number]['id'];

/** Engine, factory preset and essential parameters for a synth track, applied with apply-patch. */
export function SoundPanel({ engine, metadata, session, trackId, enabled }: { engine: EditorEngine; metadata: FirmwareMetadata | null; session: SessionState; trackId: TrackId; enabled: boolean }) {
 const queue = useMemo(() => new PatchEditQueue({ dispatch: c => engine.dispatch(c), newId: () => crypto.randomUUID() }), [engine]);
 const [, refresh] = useReducer((x: number) => x + 1, 0);
 useEffect(() => { queue.onChange = refresh; queue.handle({ type: 'session', session: engine.getSession() }); return engine.subscribe(m => queue.handle(m)); }, [engine, queue]);
 const patch = queue.view(trackId) ?? session.tracks.find(t => t.id === trackId)!.patch;
 const [drag, setDrag] = useState<Record<number, number>>({});
 useEffect(() => setDrag({}), [trackId, patch.engine, patch.preset]);

 if (trackId === 'drums') return <p style={small}>The drum kit is fixed for now: custom drum sounds need a drum-kit contract from Workstream 1. Use the pattern editor's lane buttons to audition it.</p>;
 if (!metadata) return <p style={small}>Enable audio to load the SLOOP engines.</p>;
 const engineMeta = metadata.engines[patch.engine];
 const controls = patchControls(patch, metadata);
 const play = (on: boolean) => engine.audition?.({ kind: 'note', trackId, midi: 60, velocity: on ? 0.8 : 0, on });

 return <div>
  <div style={row}>
   <label>Engine <select disabled={!enabled} value={patch.engine} onChange={e => queue.set(trackId, withEngine(patch, Number(e.target.value)))}>
    {metadata.engines.map((e, i) => <option key={e.name} value={i}>{e.name}</option>)}
   </select></label>
   <label>Preset <select disabled={!enabled} value={patch.preset} onChange={e => queue.set(trackId, withEngine(patch, patch.engine, Number(e.target.value)))}>
    {engineMeta.presets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
   </select></label>
   <button disabled={!enabled || !engine.audition} onPointerDown={() => play(true)} onPointerUp={() => play(false)} onPointerLeave={() => play(false)}>Hold to audition</button>
   {queue.pending(trackId) && <span style={small}>applies at the next loop…</span>}
  </div>
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 8 }}>
   {controls.map(c => {
    const value = drag[c.id] ?? c.value;
    const commit = () => { if (drag[c.id] !== undefined) queue.set(trackId, withParameter(patch, c.id, drag[c.id])); };
    return <label key={c.id} style={{ display: 'grid', gap: 2, fontSize: 12 }}>
     <span><b>{c.name}</b> <span style={{ opacity: 0.7 }}>{value}</span></span>
     <input type="range" min={c.min} max={c.max} step={1} value={value} disabled={!enabled}
      onChange={e => setDrag(d => ({ ...d, [c.id]: Number(e.target.value) }))} onPointerUp={commit} onKeyUp={commit} />
    </label>;
   })}
  </div>
  {queue.lastError && <p style={{ ...small, color: '#c33' }}>{queue.lastError}</p>}
 </div>;
}

const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' };
const small: React.CSSProperties = { fontSize: 13, margin: '6px 0' };
