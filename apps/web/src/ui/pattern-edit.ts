import type { ClientMessage, SessionCommand, SessionState } from '@voicesynth/contracts';

type Track = SessionState['tracks'][number];
type Lane = 'kick' | 'snare' | 'closed-hat';
export type TrackId = Track['id'];
export interface Pattern { notes: Track['notes']; hits: Track['hits'] }
/** A pure edit, re-applied to the newest authoritative pattern until the engine applies it. */
export type PatternOp = (pattern: Pattern, newId: () => string) => Pattern;

const cells = (step: number, duration: number) => Array.from({ length: duration }, (_, i) => (step + i) % 64);

export const toggleHit = (lane: Lane, step: number, velocity = 0.8): PatternOp => (p, newId) =>
 p.hits.some(h => h.lane === lane && h.step === step)
  ? { ...p, hits: p.hits.filter(h => !(h.lane === lane && h.step === step)) }
  : { ...p, hits: [...p.hits, { id: newId(), lane, step, velocity }] };

/** Monophonic: a new note replaces any note it overlaps (modulo the loop), like a sung correction. */
export const placeNote = (step: number, midi: number, duration: number, velocity = 0.8): PatternOp => (p, newId) => {
 const occupied = new Set(cells(step, duration));
 return { ...p, notes: [...p.notes.filter(n => !cells(n.step, n.duration).some(c => occupied.has(c))), { id: newId(), step, duration, midi, velocity }] };
};

export const removeNoteAt = (step: number): PatternOp => p => ({ ...p, notes: p.notes.filter(n => !cells(n.step, n.duration).includes(step)) });

export interface EditQueueDeps { dispatch(command: SessionCommand): ClientMessage; newId(): string }

/**
 * Serialises pattern edits into `edit-pattern` commands, one in flight at a time. Edits made while
 * a command is in flight coalesce into the next one; a stale rejection re-applies the same edits on
 * top of the newer session (e.g. after a recorded take landed) instead of overwriting it.
 */
export class PatternEditQueue {
 onChange: () => void = () => {};
 lastError: string | null = null;
 private session: SessionState | null = null;
 private queued: { trackId: TrackId; op: PatternOp }[] = [];
 private inFlight: { id: string; edits: { trackId: TrackId; op: PatternOp }[] } | null = null;
 private minRevision = 0;
 private retries = 0;

 constructor(private deps: EditQueueDeps) {}

 handle(message: ClientMessage) {
  if (message.type === 'session') { this.session = message.session; this.pump(); }
  else if (message.type === 'ack' && this.inFlight && message.commandId === this.inFlight.id && message.status !== 'queued') {
   const flight = this.inFlight; this.inFlight = null;
   this.minRevision = Math.max(this.minRevision, message.revision);
   if (message.status === 'rejected') {
    if (/Stale revision|Playback stopped/.test(message.reason ?? '') && this.retries++ < 4) this.queued.unshift(...flight.edits);
    else { this.retries = 0; this.lastError = `Edit rejected: ${message.reason ?? 'unknown reason'}`; }
   } else { this.retries = 0; this.lastError = null; }
   this.pump();
  }
 }

 edit(trackId: TrackId, op: PatternOp) { this.queued.push({ trackId, op }); this.lastError = null; this.pump(); }

 /** What the UI should show: the authoritative pattern with unapplied edits on top. */
 view(trackId: TrackId): Pattern & { pending: boolean } {
  const track = this.session?.tracks.find(t => t.id === trackId);
  const base: Pattern = { notes: track?.notes ?? [], hits: track?.hits ?? [] };
  const edits = [...(this.inFlight?.edits ?? []), ...this.queued].filter(e => e.trackId === trackId);
  return { ...edits.reduce((p, e) => e.op(p, () => 'pending'), base), pending: edits.length > 0 };
 }

 get busy() { return !!this.inFlight || this.queued.length > 0; }

 private pump() {
  if (this.inFlight || !this.queued.length || !this.session || this.session.revision < this.minRevision) { this.onChange(); return; }
  // Coalesce every queued edit for the first waiting track into one command.
  const trackId = this.queued[0].trackId;
  const edits = this.queued.filter(e => e.trackId === trackId);
  this.queued = this.queued.filter(e => e.trackId !== trackId);
  const track = this.session.tracks.find(t => t.id === trackId)!;
  const next = edits.reduce((p, e) => e.op(p, this.deps.newId), { notes: track.notes, hits: track.hits } as Pattern);
  const command: SessionCommand = { id: this.deps.newId(), expectedRevision: this.session.revision, boundary: 'next-loop', operation: { type: 'edit-pattern', trackId, notes: next.notes, hits: next.hits } };
  this.inFlight = { id: command.id, edits };
  this.onChange();
  let receipt: ClientMessage;
  try { receipt = this.deps.dispatch(command); }
  catch (error) { receipt = { type: 'ack', commandId: command.id, status: 'rejected', revision: this.session.revision, reason: String(error) }; }
  if (receipt.type === 'ack' && receipt.status === 'rejected') this.handle(receipt);
 }
}
