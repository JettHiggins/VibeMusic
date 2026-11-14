import type { ClientMessage, SessionCommand, SessionState } from '@voicesynth/contracts';

type Operation = SessionCommand['operation'];
type Boundary = SessionCommand['boundary'];
export interface CommandEngine {
 dispatch(command: SessionCommand): ClientMessage;
 getSession(): SessionState;
}
export interface CommandResult { id: string; text: string; status: 'queued' | 'applied' | 'rejected' | 'retrying'; error: boolean }

/**
 * Re-issuing these is the same as the user pressing the button again: the operation is absolute
 * (set tempo to N, load this session). Undo is relative and is
 * never re-issued, because it could undo a different edit than the user saw. Record is pinned by the engine; Clear must not replay after fresh input.
 */
const REISSUABLE = new Set<Operation['type']>(['tempo', 'load-session']);

/** No queued/applied/rejected answer in this time means the audio engine is not processing commands. */
export const NO_ANSWER_MS = 3000;

interface Pending { operation: Operation; boundary: Boundary; revision: number; reissues: number; answered?: boolean }

/**
 * One path for UI-initiated session commands.
 *
 * Next-loop commands are checked against the session revision when the boundary arrives. Any other
 * edit applied in the meantime (an instant mute or selection, another queued change) makes them
 * stale, and the engine rejects them. Only tempo/load absolute intentions may be re-issued.
 * Record is pinned by the engine to its original deadline. Clear and Undo must never be
 * replayed after fresh capture or an explicit live edit.
 */
export class CommandClient {
 onResult: (result: CommandResult) => void = () => {};
 private pending = new Map<string, Pending>();
 private superseded = new Set<string>();
 private revision: number;

 constructor(private engine: CommandEngine, private newId: () => string = () => crypto.randomUUID(), private maxReissues = 3, private noAnswerMs = NO_ANSWER_MS) {
  this.revision = engine.getSession().revision;
 }

 /** Sends with the engine's latest revision, never a possibly stale UI copy. */
 send(operation: Operation, boundary: Boundary = 'immediate'): string {
  return this.dispatch({ operation, boundary, revision: this.engine.getSession().revision, reissues: 0 });
 }

 private dispatch(entry: Pending): string {
  const id = this.newId();
  entry.revision = this.engine.getSession().revision;
  entry.answered = false;
  this.pending.set(id, entry);
  // A stale or crashed audio worklet rejects nothing and acknowledges nothing; say so instead of silence.
  setTimeout(() => { const e = this.pending.get(id); if (e && !e.answered) { this.pending.delete(id); this.onResult({ id, status: 'rejected', error: true, text: `${describe(e.operation, 'queued').split(':')[0]} got no answer from the audio engine. If you pulled new code, restart npm run dev (the engine worklet is rebuilt at startup), then reload the page.` }); } }, this.noAnswerMs);
  let receipt: ClientMessage;
  try { receipt = this.engine.dispatch({ id, expectedRevision: entry.revision, boundary: entry.boundary, operation: entry.operation }); }
  catch (error) { receipt = { type: 'ack', commandId: id, status: 'rejected', revision: entry.revision, reason: String(error) }; }
  if (receipt.type === 'ack' && receipt.status === 'rejected') this.handle(receipt);
  return id;
 }

 handle(message: ClientMessage) {
  if (message.type === 'session') { this.onRevision(message.session.revision); return; }
  if (message.type !== 'ack') return;
  if (this.superseded.has(message.commandId)) { if (message.status !== 'queued') this.superseded.delete(message.commandId); return; }
  const entry = this.pending.get(message.commandId);
  if (!entry) return;
  entry.answered = true;
  if (message.status === 'queued') { this.report(message.commandId, entry, 'queued'); return; }
  this.pending.delete(message.commandId);
  if (message.status === 'applied') { this.report(message.commandId, entry, 'applied'); return; }
  const reason = message.reason ?? 'rejected';
  if (/Stale revision/.test(reason) && REISSUABLE.has(entry.operation.type) && entry.reissues < this.maxReissues) {
   entry.reissues++;
   this.report(this.dispatch(entry), entry, 'retrying');
   return;
  }
  this.report(message.commandId, entry, 'rejected', reason);
 }

 private onRevision(revision: number) {
  if (revision === this.revision) return;
  this.revision = revision;
  // Re-issue queued absolute commands built on an older revision before their boundary arrives.
  for (const [id, entry] of [...this.pending]) {
   if (entry.boundary !== 'next-loop' || entry.revision >= revision || !REISSUABLE.has(entry.operation.type) || entry.reissues >= this.maxReissues) continue;
   this.pending.delete(id); this.superseded.add(id);
   entry.reissues++;
   this.dispatch(entry);
  }
 }

 private report(id: string, entry: Pending, status: CommandResult['status'], reason?: string) {
  this.onResult({ id, status, error: status === 'rejected', text: describe(entry.operation, status, reason) });
 }
}

const TARGET: Record<string, string> = { 'synth-1': 'Synth 1', 'synth-2': 'Synth 2', 'synth-3': 'Synth 3', drums: 'Drums', kick: 'Kick', snare: 'Snare', 'closed-hat': 'Hats' };
const nameOf = (t: { trackId: string; lane?: string }) => TARGET[t.lane ?? t.trackId] ?? t.trackId;

/** Plain-language status for the display instead of raw ack strings. */
export function describe(op: Operation, status: CommandResult['status'], reason?: string): string {
 const what = op.type === 'tempo' ? `Tempo ${op.bpm} BPM`
  : op.type === 'record' ? `Record ${nameOf(op.target)}`
  : op.type === 'clear' ? `Clear ${nameOf(op.target)}`
  : op.type === 'mute' ? `${op.muted ? 'Mute' : 'Unmute'} ${nameOf({ trackId: op.trackId })}`
  : op.type === 'select' ? `Select ${nameOf(op.target)}`
  : op.type === 'play' ? (op.playing ? 'Play' : 'Stop')
  : op.type === 'stop-recording' ? 'Stop recording'
  : op.type === 'undo' ? (op.discardCaptureOnly ? 'Discard pending input' : 'Undo')
  : op.type === 'load-session' ? 'Load session'
  : op.type === 'volume' ? `${nameOf({ trackId: op.trackId })} volume ${Math.round(op.volume * 100)}%`
  : op.type;
 if (status === 'queued') return op.type === 'record' ? `${what}: armed (next beat, or four count-in beats from stopped)` : `${what}: applies at the next loop`;
 if (status === 'retrying') return `${what}: another change landed first; re-sent for the next loop`;
 if (status === 'applied') return `${what}: done`;
 const why = (reason ?? '').replace(/^Error:\s*/, '');
 const plain = /Stale revision/.test(why) ? 'the session changed before it could apply; press it again'
  : /Overlapping monophonic notes/.test(why) ? 'synth tracks play one note at a time, and this would overlap two notes (remove the overlap or use another synth track)'
  : /Nothing to undo/.test(why) ? 'there is nothing to undo'
  : /Stop recording before/.test(why) ? why.replace('Stop recording before', 'stop recording before')
  : why || 'rejected';
 return `${what} not applied: ${plain}`;
}
