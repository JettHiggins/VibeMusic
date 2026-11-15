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

/** Remove the overlapped cells' notes so the track stays monophonic (the engine rejects overlaps). */
function withoutOverlaps(notes: Pattern['notes'], step: number, duration: number, except: string) {
 const occupied = new Set(cells(step, duration));
 return notes.filter(n => n.id === except || !cells(n.step, n.duration).some(c => occupied.has(c)));
}
const wrap = (step: number) => ((Math.round(step) % 64) + 64) % 64;

/** Piano roll: move a note to a new start step and pitch; notes it lands on are replaced. */
export const moveNote = (id: string, step: number, midi: number): PatternOp => p => {
 const note = p.notes.find(n => n.id === id);
 if (!note) return p;
 const target = Math.max(0, Math.min(127, Math.round(midi)));
 const moved: typeof note = { ...note, step: wrap(step), midi: target };
 // A chord moves with its root; pitches pushed outside MIDI 0..127 are omitted, as triadFor does.
 if (note.chord?.length) { const chord = note.chord.map(m => m + target - note.midi).filter(m => m >= 0 && m <= 127); if (chord.length) moved.chord = chord; else delete moved.chord; }
 return { ...p, notes: [...withoutOverlaps(p.notes, moved.step, moved.duration, id).filter(n => n.id !== id), moved] };
};

/** Piano roll: change a note's length (1..64 steps); notes it now covers are replaced. */
export const resizeNote = (id: string, duration: number): PatternOp => p => {
 const note = p.notes.find(n => n.id === id);
 if (!note) return p;
 const resized = { ...note, duration: Math.max(1, Math.min(64, Math.round(duration))) };
 return { ...p, notes: [...withoutOverlaps(p.notes, resized.step, resized.duration, id).filter(n => n.id !== id), resized] };
};

export const deleteNote = (id: string): PatternOp => p => ({ ...p, notes: p.notes.filter(n => n.id !== id) });

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
  // Unapplied items get unique placeholder IDs (`pending:N`) so the UI can key and skip them safely.
  let n = 0;
  return { ...edits.reduce((p, e) => e.op(p, () => `pending:${n++}`), base), pending: edits.length > 0 };
 }

 /** IDs created by view() for edits the engine has not applied yet. */
 static isPlaceholder(id: string) { return id.startsWith('pending:'); }

 /** Explicit Clear/Undo supersedes local intentions; never replay them on stale rejection. */
 cancelPending(trackId?: TrackId) {
  this.queued = this.queued.filter(e => trackId !== undefined && e.trackId !== trackId);
  if (this.inFlight && (trackId === undefined || this.inFlight.edits.some(e => e.trackId === trackId))) this.inFlight = null;
  this.retries = 0; this.lastError = null; this.onChange();
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
