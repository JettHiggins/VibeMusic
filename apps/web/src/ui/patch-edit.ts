import type { ClientMessage, SessionCommand, SessionState } from '@voicesynth/contracts';
import type { FirmwareMetadata } from '../engine/metadata.ts';

type Patch = SessionState['tracks'][number]['patch'];
type TrackId = SessionState['tracks'][number]['id'];

/** Shared envelope/filter parameters worth exposing on every engine (firmware IDs). */
export const COMMON_PARAMS = [1, 2, 4, 5];

export interface PatchControl { id: number; name: string; min: number; max: number; value: number }

/** Controls for a melodic track: the common envelope/filter set plus the engine's eight macros. */
export function patchControls(patch: Patch, metadata: FirmwareMetadata): PatchControl[] {
 const engine = metadata.engines[patch.engine];
 const preset = engine?.presets[patch.preset];
 if (!engine || !preset) return [];
 const value = (id: number) => patch.parameters[String(id)] ?? preset.parameters[id];
 const common = COMMON_PARAMS.map(id => ({ id, ...metadata.parameters[id] }));
 const macros = engine.parameters.map((d, i) => ({ id: metadata.engineParamOffset + i, ...d })).filter(d => d.name !== '-' && d.max > d.min);
 return [...common, ...macros].map(d => ({ id: d.id, name: d.name, min: d.min, max: d.max, value: value(d.id) }));
}

export function withEngine(patch: Patch, engine: number, preset = 0): Patch { return { ...patch, engine, preset, parameters: {} }; }
export function withParameter(patch: Patch, id: number, value: number): Patch { return { ...patch, parameters: { ...patch.parameters, [String(id)]: Math.round(value) } }; }

/**
 * Latest-wins patch edits: one `apply-patch` in flight; further changes replace the desired patch
 * and follow after the authoritative acknowledgment. Stale rejections resubmit the desired patch.
 */
export class PatchEditQueue {
 onChange: () => void = () => {};
 lastError: string | null = null;
 private session: SessionState | null = null;
 private desired = new Map<TrackId, Patch>();
 private inFlight: { id: string; trackId: TrackId; patch: Patch } | null = null;
 private minRevision = 0;
 private retries = 0;

 constructor(private deps: { dispatch(command: SessionCommand): ClientMessage; newId(): string }) {}

 handle(message: ClientMessage) {
  if (message.type === 'session') { this.session = message.session; this.settle(); this.pump(); }
  else if (message.type === 'ack' && this.inFlight?.id === message.commandId && message.status !== 'queued') {
   const flight = this.inFlight; this.inFlight = null;
   this.minRevision = Math.max(this.minRevision, message.revision);
   if (message.status === 'rejected') {
    if (/Stale revision|Playback stopped/.test(message.reason ?? '') && this.retries++ < 4) { if (!this.desired.has(flight.trackId)) this.desired.set(flight.trackId, flight.patch); }
    else { this.retries = 0; this.lastError = `Sound change rejected: ${message.reason ?? 'unknown reason'}`; this.desired.delete(flight.trackId); }
   } else this.retries = 0;
   this.pump();
  }
 }

 set(trackId: TrackId, patch: Patch) { this.desired.set(trackId, patch); this.lastError = null; this.pump(); }

 /** The patch to display: desired if pending, otherwise authoritative. */
 view(trackId: TrackId): Patch | null {
  return this.desired.get(trackId) ?? (this.inFlight?.trackId === trackId ? this.inFlight.patch : null) ?? this.session?.tracks.find(t => t.id === trackId)?.patch ?? null;
 }
 pending(trackId: TrackId) { return this.desired.has(trackId) || this.inFlight?.trackId === trackId; }

 private settle() {
  for (const [trackId, patch] of this.desired) {
   const current = this.session?.tracks.find(t => t.id === trackId)?.patch;
   if (current && JSON.stringify(current) === JSON.stringify(patch)) this.desired.delete(trackId);
  }
 }

 private pump() {
  if (this.inFlight || !this.session || this.session.revision < this.minRevision || !this.desired.size) { this.onChange(); return; }
  const [trackId, patch] = this.desired.entries().next().value!;
  this.desired.delete(trackId);
  const command: SessionCommand = { id: this.deps.newId(), expectedRevision: this.session.revision, boundary: 'next-loop', operation: { type: 'apply-patch', trackId, patch } };
  this.inFlight = { id: command.id, trackId, patch };
  this.onChange();
  let receipt: ClientMessage;
  try { receipt = this.deps.dispatch(command); }
  catch (error) { receipt = { type: 'ack', commandId: command.id, status: 'rejected', revision: this.session.revision, reason: String(error) }; }
  if (receipt.type === 'ack' && receipt.status === 'rejected') this.handle(receipt);
 }
}
