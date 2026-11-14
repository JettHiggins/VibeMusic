import { z } from 'zod';
const id = z.string().min(1);
const frame = z.number().int().nonnegative();
const unit = z.number().min(0).max(1);
export const TrackId = z.enum(['synth-1', 'synth-2', 'synth-3', 'drums']);
export const Lane = z.enum(['kick', 'snare', 'closed-hat']);
export const Target = z.strictObject({ trackId: TrackId, lane: Lane.optional() });
export const Patch = z.strictObject({ engine: z.number().int().nonnegative(), preset: z.number().int().nonnegative(), parameters: z.record(z.string(), z.number().finite()), engineRevision: id });
export const Note = z.strictObject({ id, step: z.number().int().min(0).max(63), duration: z.number().int().min(1).max(64), midi: z.number().int().min(0).max(127), velocity: unit });
export const Hit = z.strictObject({ id, step: z.number().int().min(0).max(63), lane: Lane, velocity: unit });
export const Track = z.strictObject({ id: TrackId, name: id, muted: z.boolean(), volume: unit, patch: Patch, notes: z.array(Note).max(64), hits: z.array(Hit).max(192) });
export const SessionState = z.strictObject({ version: z.literal(1), revision: frame, tempo: z.number().min(40).max(240), bars: z.literal(4), beatsPerBar: z.literal(4), stepsPerBeat: z.literal(4), selected: Target, tracks: z.array(Track).length(4) });
export const PerformanceEvent = z.discriminatedUnion('kind', [
 z.strictObject({ kind: z.literal('onset'), id, target: Target, captureFrame: frame, clockId: id, confidence: unit, velocity: unit }),
 z.strictObject({ kind: z.literal('note'), id, target: Target, captureFrame: frame, endFrame: frame, clockId: id, confidence: unit, velocity: unit, midi: z.number().int().min(0).max(127) })
]);
export const SpeechSpan = z.strictObject({startFrame: frame, endFrame: frame});
const Operation = z.discriminatedUnion('type', [
 z.strictObject({ type: z.literal('select'), target: Target }),
 z.strictObject({ type: z.literal('record'), target: Target }),
 z.strictObject({ type: z.literal('stop-recording') }),
 z.strictObject({ type: z.literal('play'), playing: z.boolean() }),
 z.strictObject({ type: z.literal('tempo'), bpm: z.number().min(40).max(240) }),
 z.strictObject({ type: z.literal('clear'), target: Target }),
 z.strictObject({ type: z.literal('mute'), trackId: TrackId, muted: z.boolean() }),
 z.strictObject({ type: z.literal('undo') }),
 z.strictObject({ type: z.literal('edit-pattern'), trackId: TrackId, notes: z.array(Note).max(64), hits: z.array(Hit).max(192) }),
 z.strictObject({ type: z.literal('volume'), trackId: TrackId, volume: unit }),
 z.strictObject({ type: z.literal('load-session'), session: SessionState }),
 z.strictObject({ type: z.literal('commit-performance'), events: z.array(PerformanceEvent).min(1).max(256), excludedSpans: z.array(SpeechSpan).max(64), verifiedThroughFrame: frame, replacesCommandId: id.optional() }),
 z.strictObject({ type: z.literal('apply-patch'), trackId: TrackId, patch: Patch })
]);
export const SessionCommand = z.strictObject({ id, expectedRevision: frame, boundary: z.enum(['immediate', 'next-loop']), operation: Operation });
export const PatchCandidate = z.strictObject({ id, patch: Patch, provenance: id, previewUrl: z.string(), score: z.number().finite() });
export const Transport = z.strictObject({ clockId: id, sampleRate: z.number().int().positive(), currentFrame: frame, loopStartFrame: frame, playing: z.boolean(), recording: z.boolean(), pendingCommandIds: z.array(id), recordingState: z.enum(['idle','armed','recording']).optional(), recordingStartFrame: frame.optional(), recordingTarget: Target.optional(), armedTarget: Target.optional() });
export const ClientMessage = z.discriminatedUnion('type', [
 z.strictObject({ type: z.literal('session'), session: SessionState }),
 z.strictObject({ type: z.literal('transport'), transport: Transport }),
 z.strictObject({ type: z.literal('ack'), commandId: id, status: z.enum(['queued','applied','rejected']), revision: frame, reason: z.string().optional() }),
 z.strictObject({ type: z.literal('utterance'), id, text: id, clockId: id, startFrame: frame, endFrame: frame, duringRecording: z.boolean() }),
 z.strictObject({ type: z.literal('sound-request'), id, trackId: TrackId, description: id }),
 z.strictObject({ type: z.literal('cancel-job'), jobId: id })
]);
export const ServerMessage = z.discriminatedUnion('type', [
 z.strictObject({ type: z.literal('command'), command: SessionCommand }),
 z.strictObject({ type: z.literal('speech-verified'), clockId: id, throughFrame: frame }),
 z.strictObject({ type: z.literal('command-span'), utteranceId: id, clockId: id, startFrame: frame, endFrame: frame }),
 z.strictObject({ type: z.literal('research'), jobId: id, status: z.enum(['running','complete','cancelled','failed']), progress: unit, candidates: z.array(PatchCandidate), error: z.string().optional() }),
 z.strictObject({ type: z.literal('error'), requestId: id, message: id })
]);
export type SessionState = z.infer<typeof SessionState>;
export type SessionCommand = z.infer<typeof SessionCommand>;
export type PerformanceEvent = z.infer<typeof PerformanceEvent>;
export type Transport = z.infer<typeof Transport>;
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ServerMessage = z.infer<typeof ServerMessage>;
export type PatchCandidate = z.infer<typeof PatchCandidate>;
export const AuditionEvent = z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('note'),trackId:z.enum(['synth-1','synth-2','synth-3']),midi:z.number().int().min(0).max(127),velocity:unit,on:z.boolean()}),
 z.strictObject({kind:z.literal('drum'),lane:Lane,velocity:unit})
]);
export type AuditionEvent=z.infer<typeof AuditionEvent>;
export interface AuditionEngineAdapter extends EngineAdapter { audition(event:AuditionEvent):void; }
export interface EngineAdapter {
 initialize(): Promise<void>;
 getSession(): SessionState;
 dispatch(command: SessionCommand): ClientMessage;
 subscribe(listener: (message: ClientMessage) => void): () => void;
 dispose(): void;
}
export interface AgentAdapter {
 send(message: ClientMessage): void;
 subscribe(listener: (message: ServerMessage) => void): () => void;
 dispose(): void;
}
export { MockEngine, MockAgent, createSession } from './mocks.ts';
