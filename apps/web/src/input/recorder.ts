import type { ClientMessage, PerformanceEvent, SessionCommand, SessionState, Transport } from '@voicesynth/contracts';
import type { Onset } from './onset.ts';
import type { SungNote } from './pitch.ts';

/**
 * Turns analysed microphone onsets into verified, atomic `commit-performance` batches.
 *
 * The browser engine stays authoritative: events are provisional until the engine acknowledges
 * the batch as applied. Exactly one batch is in flight, so a queued batch never makes a sibling stale.
 *
 * Verification modes:
 * - `manual`: recording is started and stopped from the UI, with no voice commands during takes,
 *   so there is no speech to exclude. The watermark follows analysed audio.
 * - `speech`: frames are committed only after the speech pipeline reports, via verifyThrough(),
 *   that it has classified them. Recognised command spans are excluded. If speech becomes
 *   unavailable, capture stops accepting events but playback and the composition continue.
 */
export type VerificationMode = 'manual' | 'speech';
export interface RecorderDeps {
 dispatch(command: SessionCommand): ClientMessage;
 newId(): string;
}
export interface RecorderOptions {
 /**
  * Begin submitting this many seconds before the loop boundary. Later verified events
  * replace the queued batch, retaining its boundary and all earlier events.
  */
 batchLeadSeconds?: number;
}
export interface Span { startFrame: number; endFrame: number }
/** step/duration are the expected quantized cells, for live feedback only; the engine quantizes authoritatively. */
export interface ProvisionalEvent { event: PerformanceEvent; step: number; duration: number; status: 'provisional' | 'submitted' }
export interface RecorderStatus {
 mode: VerificationMode;
 capturing: boolean;
 provisional: ProvisionalEvent[];
 committed: number;
 dropped: number;
 lastError: string | null;
 inFlight: string | null;
}
type Window = { clockId: string; startFrame: number; target: NonNullable<Transport['recordingTarget']>; tempo: number; epoch?: number; captureStart: number; gridOrigin: number; open: boolean; cutoff: number };

const MAX_EVENTS = 256, MAX_SPANS = 64, MAX_RETRIES = 4;
/** The engine ignores events below this confidence (CONTRACTS.md); filter locally so counters stay honest. */
export const MIN_CONFIDENCE = 0.6;
const RETRYABLE = /Stale revision|Playback stopped|Performance batch no longer queued/;

export class PerformanceRecorder {
 onChange: (status: RecorderStatus) => void = () => {};
 private session: SessionState | null = null;
 private transport: Transport | null = null;
 private window: Window | null = null;
 private events: ProvisionalEvent[] = [];
 private spans: (Span & { clockId: string })[] = [];
 private analysedThrough = 0;
 private speechVerifiedThrough = -1;
 private speechAvailable = false;
 private inFlight: { id: string; ids: Set<string> } | null = null;
 private retries = 0;
 /**
  * Batches this recorder replaced. Acks travel over a MessagePort, so a replaced batch may still
  * turn out to have been applied before the replacement reached the audio thread.
  */
 private replaced = new Map<string, Set<string>>();
 /** Targeted erasures remain active for the current recording epoch so delayed analysis cannot restore them. */
 private erasures = new Map<string, { clockId: string; fence: NonNullable<Transport['captureErasure']> }>();
 private seenErasureCommands = new Set<string>();
 /** Revision from the last authoritative ack; never build a batch on an older snapshot. */
 private minRevision = 0;
 private committed = 0;
 private dropped = 0;
 private lastError: string | null = null;

 private readonly batchLead: number;

 constructor(private deps: RecorderDeps, private mode: VerificationMode = 'manual', options: RecorderOptions = {}) {
  this.batchLead = options.batchLeadSeconds ?? 0.4;
 }

 setMode(mode: VerificationMode) { this.mode = mode; this.speechVerifiedThrough = -1; this.changed(); }
 /** Speech mode: whether recognition is connected. Losing it stops new commits immediately. */
 setSpeechAvailable(available: boolean) {
  this.speechAvailable = available;
  if (!available && this.mode === 'speech') this.discardUnverified('Speech recognition disconnected; unverified hits were discarded');
  this.changed();
 }

 handle(message: ClientMessage) {
  if (message.type === 'session') { this.session = message.session; if (this.window) this.window.tempo = message.session.tempo; this.pump(); }
  else if (message.type === 'transport') this.onTransport(message.transport);
  else if (message.type === 'ack') this.onAck(message);
 }

 /** Recognised wake-phrase command, in capture-clock frames. */
 addCommandSpan(span: Span & { clockId: string }) {
  if (span.endFrame < span.startFrame) return;
  this.spans.push(span);
  if (this.spans.length > MAX_SPANS * 4) this.spans.splice(0, this.spans.length - MAX_SPANS * 4);
  const before = this.events.length;
  this.events = this.events.filter(e => e.status === 'submitted' || e.event.clockId !== span.clockId || !overlaps(e.event.captureFrame, endOf(e.event), span));
  this.dropped += before - this.events.length;
  this.changed();
 }

 verifyThrough(clockId: string, frame: number) {
  if (this.window && clockId !== this.window.clockId) return;
  this.speechVerifiedThrough = Math.max(this.speechVerifiedThrough, Math.floor(frame));
  this.pump();
 }

 /**
  * Onsets carry raw capture-worklet frames. latencyFrames is subtracted here and nowhere else.
  * analysedThrough is the raw frame up to which analysis is complete.
  */
 addOnsets(onsets: Onset[], latencyFrames: number, clockId: string, analysedThrough: number) {
  for (const onset of onsets) {
   const frame = Math.round(onset.frame - latencyFrames);
   this.accept(clockId, 'drums', frame, frame, onset.confidence, onset.velocity, target => ({ kind: 'onset', id: this.deps.newId(), target, captureFrame: frame, clockId, confidence: onset.confidence, velocity: onset.velocity }));
  }
  this.analysed(analysedThrough, latencyFrames);
 }

 /** Sung notes from the pitch segmenter, same frame conventions as addOnsets. */
 addNotes(notes: SungNote[], latencyFrames: number, clockId: string, analysedThrough: number) {
  for (const note of notes) {
   const start = Math.round(note.startFrame - latencyFrames);
   let end = Math.round(note.endFrame - latencyFrames);
   // A note still sounding when the take closed is kept up to the cut-off.
   if (this.window && !this.window.open) end = Math.min(end, this.window.cutoff);
   if (end <= start) { this.dropped++; continue; }
   this.accept(clockId, 'melodic', start, end, note.confidence, note.velocity, target => ({ kind: 'note', id: this.deps.newId(), target, captureFrame: start, endFrame: end, clockId, confidence: note.confidence, velocity: note.velocity, midi: note.midi }));
  }
  this.analysed(analysedThrough, latencyFrames);
 }

 private analysed(analysedThrough: number, latencyFrames: number) {
  // Contract frames are integers: round events, floor watermarks (never claim a partial frame).
  this.analysedThrough = Math.max(this.analysedThrough, Math.floor(analysedThrough - latencyFrames));
  this.pump();
 }

 private accept(clockId: string, kind: 'drums' | 'melodic', start: number, end: number, confidence: number, velocity: number, make: (target: Transport['recordingTarget'] & {}) => PerformanceEvent) {
  const w = this.window;
  const fits = w && (kind === 'drums' ? w.target.trackId === 'drums' && !!w.target.lane : w.target.trackId !== 'drums' && !w.target.lane);
  // Both analysers always run; events of the other kind are irrelevant to this take, not "ignored".
  if (w && !fits) return;
  // Late analysis results for audio before the cut-off still count after the take closes.
  if (!w || clockId !== w.clockId || (this.mode === 'speech' && !this.speechAvailable)) { this.dropped++; return; }
  if (start < w.captureStart || (!w.open && start > w.cutoff) || confidence < MIN_CONFIDENCE || velocity <= 0) { this.dropped++; return; }
  if (this.spans.some(s => s.clockId === clockId && overlaps(start, end, s))) { this.dropped++; return; }
  const event = make({ ...w.target });
  const step = this.stepOf(start);
  const duration = kind === 'drums' ? 1 : Math.max(1, Math.min(64, this.stepOf(end, false) - this.stepOf(start, false)));
  const provisional = { event, step, duration, status: 'provisional' as const };
  if (this.erased(provisional)) { this.dropped++; return; }
  this.events.push(provisional);
 }

 /** Includes submitted input: Undo must discard capture before consuming musical history. */
 resetPendingCapture() {
  this.events=[];this.inFlight=null;this.replaced.clear();this.retries=0;
  this.analysedThrough=-1;this.speechVerifiedThrough=-1;this.lastError=null;this.changed();
 }
 beginSpeechCoverage(clockId:string,firstFrame:number) {
  if(this.window?.clockId===clockId)this.window.captureStart=Math.max(this.window.captureStart,firstFrame);
 }
 get hasPendingCapture() { return this.events.length > 0; }

 get capturing() {
  if (!this.window?.open) return false;
  return this.mode === 'manual' || this.speechAvailable;
 }

 status(): RecorderStatus {
  return { mode: this.mode, capturing: this.capturing, provisional: this.events.map(e => ({ ...e })), committed: this.committed, dropped: this.dropped, lastError: this.lastError, inFlight: this.inFlight?.id ?? null };
 }

 private stepOf(frame: number, wrap = true) {
  const w = this.window!;
  const stepFrames = (this.transport?.sampleRate ?? 44100) * 60 / (w.tempo * 4);
  const step = Math.round((frame - w.gridOrigin) / stepFrames);
  return wrap ? ((step % 64) + 64) % 64 : step;
 }

 private onTransport(t: Transport) {
  const previous = this.transport;
  this.transport = t;
  if (previous && previous.clockId !== t.clockId) { this.discardUnverified('Audio clock changed; pending hits were discarded'); this.window = null; this.spans = []; }
  // Epoch resets arrive before cancelled-batch acks. Forget every old ID, retry and event;
  // later terminal acks intentionally have nothing to match and cannot resurrect old audio.
  const epochReset = t.recordingEpoch !== undefined && this.window && this.window.epoch !== t.recordingEpoch;
  if (epochReset) {
   this.erasures.clear(); this.seenErasureCommands.clear();
   this.events = []; this.inFlight = null; this.replaced.clear(); this.retries = 0;
   this.lastError = null; this.analysedThrough = -1; this.speechVerifiedThrough = -1;
   this.window = { ...this.window!, epoch: t.recordingEpoch, captureStart: t.captureStartFrame ?? t.recordingStartFrame ?? t.currentFrame,
    gridOrigin: t.recordingLoopStartFrame ?? t.loopStartFrame, tempo: this.session?.tempo ?? 120 };
  }
  const active = t.recordingState === 'recording' || t.recording;
  if (active && t.recordingTarget && t.recordingStartFrame !== undefined) {
   if (!this.window || this.window.startFrame !== t.recordingStartFrame || this.window.clockId !== t.clockId) {
    // A new take replaces the engine's window; unsent events from the old take can no longer apply.
    if (this.window) this.discardUnverified('A new take started before earlier hits were verified');
    // A batch the engine no longer lists as pending, with no acknowledgment yet, belongs to the old
    // take: forget it rather than chaining the new take's batches onto it.
    if (this.inFlight && !t.pendingCommandIds.includes(this.inFlight.id)) {
     const lost = this.inFlight.ids;
     this.events = this.events.filter(e => !lost.has(e.event.id));
     this.dropped += lost.size; this.inFlight = null; this.replaced.clear();
     this.lastError = "The previous take's last batch was not acknowledged by the engine";
    }
    this.window = { clockId: t.clockId, startFrame: t.recordingStartFrame, target: t.recordingTarget, tempo: this.session?.tempo ?? 120, epoch: t.recordingEpoch, captureStart: t.captureStartFrame ?? t.recordingStartFrame, gridOrigin: t.recordingLoopStartFrame ?? t.recordingStartFrame, open: true, cutoff: t.currentFrame };
    this.speechVerifiedThrough = -1;
   }
   this.window.open = true; this.window.cutoff = t.currentFrame;
  } else if (this.window?.open) {
   // The engine ended the window somewhere after the last frame we saw recording; stay conservative.
   this.window.open = false;
   const cutoff = this.window.cutoff, before = this.events.length;
   this.events = this.events.filter(e => e.status === 'submitted' || e.event.captureFrame <= cutoff);
   this.events.forEach(e => { if (e.status === 'provisional' && e.event.kind === 'note' && e.event.endFrame > cutoff) e.event = { ...e.event, endFrame: cutoff }; });
   this.events = this.events.filter(e => endOf(e.event) > e.event.captureFrame || e.event.kind === 'onset');
   this.dropped += before - this.events.length;
  }
  const fence = t.captureErasure;
  if (fence && !this.seenErasureCommands.has(fence.commandId) && fence.recordingEpoch === t.recordingEpoch && this.window?.epoch === fence.recordingEpoch && this.window.clockId === t.clockId) {
   this.seenErasureCommands.add(fence.commandId);
   const key = `${t.clockId}|${fence.recordingEpoch}|${fence.target.trackId}|${fence.target.lane ?? ''}|${fence.step}`;
   const previousFence = this.erasures.get(key)?.fence;
   if (!previousFence || fence.throughFrame > previousFence.throughFrame) this.erasures.set(key, { clockId: t.clockId, fence });
   const before = this.events.length;
   this.events = this.events.filter(event => !this.erased(event));
   this.dropped += before - this.events.length;
  }
  this.pump();
 }

 private erased(event: ProvisionalEvent) {
  for (const { clockId, fence } of this.erasures.values()) {
   if (clockId !== event.event.clockId || event.event.captureFrame > fence.throughFrame || event.event.target.trackId !== fence.target.trackId || event.event.target.lane !== fence.target.lane) continue;
   const duration = event.event.kind === 'note' ? event.duration : 1;
   for (let i = 0; i < duration; i++) if ((event.step + i) % 64 === fence.step) return true;
  }
  return false;
 }

 private watermark() {
  const t = this.transport;
  if (!t || !this.window) return -1;
  // Never claim frames the engine has not reached, nor audio not yet analysed.
  let mark = Math.min(t.currentFrame, this.analysedThrough);
  if (this.mode === 'speech') mark = Math.min(mark, this.speechVerifiedThrough);
  if (!this.window.open) mark = Math.min(mark, this.window.cutoff);
  return Math.floor(mark);
 }

 private pump() {
  if (!this.session || !this.window || this.window.clockId !== this.transport?.clockId) { this.changed(); return; }
  if (this.mode === 'speech' && !this.speechAvailable) { this.changed(); return; }
  if (this.session.revision < this.minRevision) { this.changed(); return; }
  if (!this.nearBoundary()) { this.changed(); return; }
  const mark = this.watermark();
  const submitted = this.inFlight ? this.events.filter(e => this.inFlight!.ids.has(e.event.id)) : [];
  const ready = this.events.filter(e => e.status === 'provisional' && endOf(e.event) <= mark).slice(0, MAX_EVENTS-submitted.length);
  if (!ready.length) { this.changed(); return; }
  this.submit([...submitted,...ready], mark, this.inFlight?.id);
 }

 /** Start batching near the boundary; subsequent verified events replace the queued batch. */
 private nearBoundary() {
  const t = this.transport!;
  if (!this.window!.open || !t.playing || !Number.isFinite(this.batchLead)) return true;
  const loop = t.sampleRate * 60 / ((this.session?.tempo ?? 120) * 4) * 64;
  const elapsed = ((t.currentFrame - t.loopStartFrame) % loop + loop) % loop;
  return loop - elapsed <= this.batchLead * t.sampleRate;
 }

 private submit(batch: ProvisionalEvent[], mark: number, replacesCommandId?: string) {
  const first = Math.min(...batch.map(e => e.event.captureFrame)), last = Math.max(...batch.map(e => endOf(e.event)));
  const excludedSpans = this.spans.filter(s => s.clockId === this.window!.clockId && s.startFrame <= last && s.endFrame >= first).slice(-MAX_SPANS).map(({ startFrame, endFrame }) => ({ startFrame, endFrame }));
  const command: SessionCommand = {
   id: this.deps.newId(), expectedRevision: this.session!.revision, boundary: 'next-loop',
   operation: { type: 'commit-performance', ...(this.window!.epoch === undefined ? {} : { recordingEpoch: this.window!.epoch }), events: batch.map(e => e.event), excludedSpans, verifiedThroughFrame: mark, ...(replacesCommandId?{replacesCommandId}:{}) },
  };
  batch.forEach(e => { e.status = 'submitted'; });
  if (replacesCommandId && this.inFlight) this.replaced.set(replacesCommandId, this.inFlight.ids);
  this.inFlight = { id: command.id, ids: new Set(batch.map(e => e.event.id)) };
  this.changed();
  let receipt: ClientMessage;
  try { receipt = this.deps.dispatch(command); }
  catch (error) { receipt = { type: 'ack', commandId: command.id, status: 'rejected', revision: this.session!.revision, reason: String(error) }; }
  if (receipt.type === 'ack' && receipt.status === 'rejected') this.onAck(receipt);
 }

 private onAck(ack: Extract<ClientMessage, { type: 'ack' }>) {
  const replaced = this.replaced.get(ack.commandId);
  if (replaced && ack.status !== 'queued') {
   this.replaced.delete(ack.commandId);
   if (ack.status === 'applied') {
    // It applied before our replacement arrived: those events are committed; never resend them.
    const before = this.events.length;
    this.events = this.events.filter(e => !replaced.has(e.event.id));
    this.committed += before - this.events.length;
    if (this.inFlight) for (const id of replaced) this.inFlight.ids.delete(id);
    this.minRevision = Math.max(this.minRevision, ack.revision);
   }
   this.changed();
   return;
  }
  const flight = this.inFlight;
  if (!flight || ack.commandId !== flight.id || ack.status === 'queued') return;
  this.inFlight = null;
  this.minRevision = Math.max(this.minRevision, ack.revision);
  const batch = this.events.filter(e => flight.ids.has(e.event.id));
  if (ack.status === 'applied') {
   this.events = this.events.filter(e => !flight.ids.has(e.event.id));
   this.committed += batch.length; this.lastError = null; this.retries = 0;
   this.pump(); return;
  }
  const reason = ack.reason ?? 'rejected';
  if (!batch.length) {
   // A targeted erase can remove every event from an already-submitted command.
   // Its terminal rejection is expected and the fence already counted those events as dropped.
   this.retries = 0; this.lastError = null; this.pump(); return;
  }
  if (RETRYABLE.test(reason) && this.retries < MAX_RETRIES) {
   // Resubmit the same verified events under a new command ID against the current revision.
   // If the newer session snapshot has not arrived yet, its arrival triggers pump().
   this.retries++;
   batch.forEach(e => { e.status = 'provisional'; });
   this.pump(); return;
  }
  this.retries = 0;
  this.events = this.events.filter(e => !flight.ids.has(e.event.id));
  this.dropped += batch.length; this.lastError = `Engine rejected ${batch.length} hit(s): ${reason}`;
  this.pump();
 }

 private discardUnverified(reason: string) {
  const pending = this.events.filter(e => e.status === 'provisional');
  if (pending.length) { this.dropped += pending.length; this.lastError = reason; }
  this.events = this.events.filter(e => e.status === 'submitted');
 }

 private changed() { this.onChange(this.status()); }
}

function overlaps(start: number, end: number, span: Span) { return start <= span.endFrame && end >= span.startFrame; }
function endOf(event: PerformanceEvent) { return event.kind === 'note' ? event.endFrame : event.captureFrame; }
