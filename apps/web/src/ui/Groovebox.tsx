import React, { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { SessionCommand, SessionState, Transport } from '@voicesynth/contracts';
import type { FirmwareMetadata } from '../engine/metadata.ts';
import type { VoiceInput, VoiceInputState } from '../input/voice-input.ts';
import { CommandClient, type CommandResult } from './command-client.ts';
import { PatternEditQueue, type PatternOp } from './pattern-edit.ts';
import { displayedTarget, noteName, playheadStep, TRACK_LABEL, type EditorEngine, type Lane, type TrackId } from './labels.ts';
import { TransportBar } from './TransportBar.tsx';
import { TrackList } from './TrackList.tsx';
import { PianoRoll } from './PianoRoll.tsx';
import { DrumGrid } from './DrumGrid.tsx';
import { SoundPanel } from './SoundPanel.tsx';
import { InputInspector } from './InputInspector.tsx';
import { PitchSnapControls } from './PitchSnapControls.tsx';
import { snapMidiToScale } from '@voicesynth/contracts';
import { currentTake, emptyTracker, recordingPhase, trackTake, type TakeTracker } from './recording-phase.ts';
import { RecordingPhaseStrip, TakeFeedbackLine } from './RecordingPhase.tsx';
import { C, workspaceCss } from './theme.ts';

export interface GrooveboxProps {
 engine: EditorEngine & { metadata: FirmwareMetadata | null };
 voice: VoiceInput;
 session: SessionState;
 transport: Transport | null;
 enabled: boolean;
 busy: boolean;
 message: string;
 onEnable: () => void;
 /** Kept for compatibility; UI commands go through the shared CommandClient (live revision, re-issue). */
 dispatch: (operation: SessionCommand['operation'], boundary?: SessionCommand['boundary']) => void;
 /** Workstream 1/3 integration controls (agent connection, transcript harness, research). */
 agent: ReactNode;
 /** Reveal voice-started results without requiring a click during performance. */
 agentActivityKey?: string | null;
}

/**
 * Dark monochrome DAW workspace: persistent transport on top, tracks on the left, the selected
 * track's editor in the center (drum step lanes or a synth piano roll), and a compact sound/input
 * inspector on the right. No workspace tabs; session operations live in the transport's menu.
 */
export function Groovebox({ engine, voice, session, transport, enabled, busy, message, onEnable, agent, agentActivityKey }: GrooveboxProps) {
 const agentDetails = useRef<HTMLDetailsElement>(null);
 const root = useRef<HTMLDivElement>(null);
 // The transport bar can wrap; keep the sticky inspector just below its actual height.
 useEffect(() => {
  const el = root.current, bar = el?.querySelector('header');
  if (!el || !bar || typeof ResizeObserver === 'undefined') return;
  const sync = () => el.style.setProperty('--vs-top', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  const observer = new ResizeObserver(sync); observer.observe(bar); sync();
  return () => observer.disconnect();
 }, []);
 useEffect(() => { if (agentActivityKey && agentDetails.current) agentDetails.current.open = true; }, [agentActivityKey]);
 const client = useMemo(() => new CommandClient({ getSession: () => engine.getSession(), dispatch: c => engine.dispatch(voice.prepareCommand(c)) }), [engine, voice]);
 const patterns = useMemo(() => new PatternEditQueue({ dispatch: c => engine.dispatch(c), newId: () => crypto.randomUUID() }), [engine]);
 const [result, setResult] = useState<CommandResult | null>(null);
 const [input, setInput] = useState<VoiceInputState>(voice.getState());
 const [, refresh] = useReducer((x: number) => x + 1, 0);
 useEffect(() => {
  client.onResult = setResult;
  patterns.onChange = refresh;
  patterns.handle({ type: 'session', session: engine.getSession() });
  const seenErasureCommands = new Set<string>();
  return engine.subscribe(m => {
   client.handle(m); patterns.handle(m);
   if (m.type === 'transport' && m.transport.captureErasure && !seenErasureCommands.has(m.transport.captureErasure.commandId)) {
    seenErasureCommands.add(m.transport.captureErasure.commandId);
    patterns.cancelPending(m.transport.captureErasure.target.trackId as TrackId);
   }
  });
 }, [engine, client, patterns]);
 useEffect(() => {
  voice.onChange = setInput;
  voice.onBeforeLiveEdit = op => patterns.cancelPending(op.type === 'clear' ? op.target.trackId : undefined);
  return () => { voice.onChange = () => {}; voice.onBeforeLiveEdit = () => {}; };
 }, [voice, patterns]);
 // main.tsx echoes every ack into `message` ("applied", "rejected: …"); the command client already
 // reports those in plain language. Other messages (engine/asset errors, readiness) replace older results.
 const engineMessage = /^(queued|applied|rejected)(:|$)/.test(message) ? null : message;
 useEffect(() => { if (engineMessage) setResult(null); }, [engineMessage]);

 const send = (operation: SessionCommand['operation'], boundary: SessionCommand['boundary'] = 'immediate') => {
  client.send(operation, boundary);
 };
 const rec = transport?.recordingState ?? 'idle';
 const target = displayedTarget(session, transport);
 const trackId: TrackId = target.trackId;
 const lane = (target.lane ?? session.selected.lane ?? 'kick') as Lane;
 const view = patterns.view(trackId);
 const playhead = playheadStep(transport, session.tempo)?.step ?? null;
 const speechReady = !input.speech.enabled || input.speech.status==='ready';
 // This integration includes the engine's targeted-erasure implementation and capture fences.
 const eraseEventAvailable = true;
 const micReady = input.microphone === 'on' || input.microphone === 'test-signal';
 const uncalibrated = input.microphone === 'on' && !input.readiness.ready;
 const edit = (op: PatternOp) => patterns.edit(trackId, op);
 type EraseTarget = Extract<SessionCommand['operation'], { type: 'erase-event' }>['target'];
 const erase = (target: EraseTarget, step: number) => client.send({ type: 'erase-event', target, step }, 'immediate');
 const selectTrack = (id: TrackId) => send({ type: 'select', target: id === 'drums' ? { trackId: 'drums', lane } : { trackId: id } });
 const provisional = [...input.recorder.provisional, ...(input.recorder.live ? [input.recorder.live] : [])].filter(p => p.event.target.trackId === trackId);
 const status = patterns.lastError ?? result?.text ?? engineMessage ?? '';
 const phase = recordingPhase(transport, session.tempo, TRACK_LABEL[trackId]);
 const tracker = useRef<TakeTracker>(emptyTracker);
 tracker.current = trackTake(tracker.current, transport, input.recorder);
 const take = currentTake(input.recorder, tracker.current);
 const liveNote = input.recorder.live?.event.kind === 'note' ? noteName(snapMidiToScale(input.recorder.live.event.midi, session.pitchSnap)) : null;
 const showTake = micReady && (rec !== 'idle' || take.waiting + take.sent + take.saved + take.notKept > 0 || !!take.reason);

 return <div ref={root} className="vs" style={{ minHeight: '100vh', background: C.bg }}>
  <style>{workspaceCss + layoutCss}</style>
  <TransportBar session={session} transport={transport} enabled={enabled} busy={busy} onEnable={onEnable} send={send} target={target}
   canRecord={micReady&&speechReady} recordHint={!speechReady ? 'Speech recognition unavailable; retry or explicitly select manual mode' : !micReady ? 'Enable the microphone in the Input inspector first' : uncalibrated ? input.readiness.advice : null}
   status={status} statusError={!!patterns.lastError || !!result?.error} />
  <div className="vs-body">
   <aside className="vs-left" style={pane}>
    <TrackList session={session} metadata={engine.metadata} selected={trackId} enabled={enabled} locked={rec !== 'idle'} onSelect={selectTrack} send={send} />
   </aside>
   <main className="vs-center" style={pane} aria-label="Editor">
    <h2>{TRACK_LABEL[trackId]}{trackId === 'drums' ? ' · step sequencer' : ' · piano roll'}{view.pending ? ' · edits apply at the next loop' : ''}</h2>
    <RecordingPhaseStrip phase={phase} />
    <PitchSnapControls settings={session.pitchSnap ?? null} trackId={trackId} noteCount={view.notes.length} enabled={enabled}
     onChange={settings => send({ type: 'set-pitch-snap', settings }, 'immediate')}
     onSnap={() => { if (trackId !== 'drums') send({ type: 'snap-notes', trackId }, 'next-loop'); }} />
    {trackId === 'drums'
     ? <DrumGrid hits={view.hits} playhead={playhead} lane={lane} disabled={!enabled} eraseEnabled={eraseEventAvailable}
       provisional={provisional.flatMap(p => p.event.target.lane ? [{ lane: p.event.target.lane as Lane, step: p.step }] : [])}
       onEdit={edit} onErase={(l, step) => erase({ trackId: 'drums', lane: l }, step)} onSelectLane={l => send({ type: 'select', target: { trackId: 'drums', lane: l } })}
       onAudition={engine.audition ? l => engine.audition!({ kind: 'drum', lane: l, velocity: 0.9 }) : undefined} />
     : <PianoRoll key={trackId} label={TRACK_LABEL[trackId]} notes={view.notes} playhead={playhead} disabled={!enabled} eraseEnabled={eraseEventAvailable} onEdit={edit} onErase={step => erase({ trackId }, step)}
       provisional={provisional.flatMap(p => p.event.kind === 'note' ? [{ step: p.step, duration: p.duration, midi: snapMidiToScale(p.event.midi, session.pitchSnap), state: p === input.recorder.live ? 'live' as const : p.status }] : [])}
       onAudition={engine.audition ? (midi, on) => engine.audition!({ kind: 'note', trackId: trackId as Exclude<TrackId, 'drums'>, midi, velocity: on ? 0.8 : 0, on }) : undefined} />}
    {showTake && <TakeFeedbackLine take={take} liveName={liveNote} unit={trackId === 'drums' ? 'hit' : 'note'} />}
   </main>
   <aside className="vs-right" style={{ ...pane, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, alignContent: 'start' }} aria-label="Inspector">
    <details open>
     <summary>Input</summary>
     <InputInspector voice={voice} state={input} transport={transport} enabled={enabled} melodic={trackId !== 'drums'} pitchSnap={session.pitchSnap ?? null} />
    </details>
    <details open>
     <summary>Sound</summary>
     <SoundPanel engine={engine} metadata={engine.metadata} session={session} trackId={trackId} enabled={enabled} />
    </details>
    <details ref={agentDetails}>
     <summary>Agent</summary>
     {agent}
    </details>
   </aside>
  </div>
 </div>;
}

const pane: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: 12, minWidth: 0 };
const layoutCss = `
 .vs-body { display: grid; grid-template-columns: 210px minmax(0, 1fr) 330px; gap: 10px; padding: 10px; align-items: start; }
 /* Long device names, URLs and provider errors wrap inside their pane instead of widening the page. */
 .vs-left, .vs-center, .vs-right { overflow-wrap: anywhere; }
 .vs-right input:not([type=checkbox]):not([type=range]) { max-width: 100%; box-sizing: border-box; }
 /* The inspector scrolls on its own so a tall input section never pushes the editor off screen. */
 @media (min-width: 1101px) { .vs-right { position: sticky; top: calc(var(--vs-top, 52px) + 10px); max-height: calc(100vh - var(--vs-top, 52px) - 20px); overflow-y: auto; overscroll-behavior: contain; } }
 @media (max-width: 1100px) { .vs-body { grid-template-columns: 190px minmax(0, 1fr); } .vs-right { grid-column: 1 / -1; } }
 @media (max-width: 720px) { .vs-body { grid-template-columns: minmax(0, 1fr); } }
`;
