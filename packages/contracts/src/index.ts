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
export const PitchSnap = z.strictObject({ root: z.number().int().min(0).max(11), scale: z.enum(['major','minor']) });
export const SessionState = z.strictObject({ version: z.literal(1), revision: frame, tempo: z.number().min(40).max(240), bars: z.literal(4), beatsPerBar: z.literal(4), stepsPerBeat: z.literal(4), selected: Target, tracks: z.array(Track).length(4), pitchSnap: PitchSnap.nullable().optional() });
export const PerformanceEvent = z.discriminatedUnion('kind', [
 z.strictObject({ kind: z.literal('onset'), id, target: Target, captureFrame: frame, clockId: id, confidence: unit, velocity: unit }),
 z.strictObject({ kind: z.literal('note'), id, target: Target, captureFrame: frame, endFrame: frame, clockId: id, confidence: unit, velocity: unit, midi: z.number().int().min(0).max(127) })
]);
export const SpeechSpan = z.strictObject({startFrame: frame, endFrame: frame});
const Operation = z.discriminatedUnion('type', [
 z.strictObject({ type: z.literal('set-pitch-snap'), settings: PitchSnap.nullable() }),
 z.strictObject({ type: z.literal('snap-notes'), trackId: z.enum(['synth-1','synth-2','synth-3']) }),
 z.strictObject({ type: z.literal('metronome'), enabled: z.boolean() }),
 z.strictObject({ type: z.literal('erase-event'), target: Target, step: z.number().int().min(0).max(63) }),
 z.strictObject({ type: z.literal('select'), target: Target }),
 z.strictObject({ type: z.literal('record'), target: Target }),
 z.strictObject({ type: z.literal('stop-recording') }),
 z.strictObject({ type: z.literal('play'), playing: z.boolean() }),
 z.strictObject({ type: z.literal('tempo'), bpm: z.number().min(40).max(240) }),
 z.strictObject({ type: z.literal('clear'), target: Target }),
 z.strictObject({ type: z.literal('mute'), trackId: TrackId, muted: z.boolean() }),
 z.strictObject({ type: z.literal('undo'), discardCaptureOnly: z.boolean().optional() }),
 z.strictObject({ type: z.literal('edit-pattern'), trackId: TrackId, notes: z.array(Note).max(64), hits: z.array(Hit).max(192) }),
 z.strictObject({ type: z.literal('volume'), trackId: TrackId, volume: unit }),
 z.strictObject({ type: z.literal('load-session'), session: SessionState }),
 z.strictObject({ type: z.literal('commit-performance'), events: z.array(PerformanceEvent).min(1).max(256), excludedSpans: z.array(SpeechSpan).max(64), verifiedThroughFrame: frame, replacesCommandId: id.optional(), recordingEpoch: frame.optional() }),
 z.strictObject({ type: z.literal('apply-patch'), trackId: TrackId, patch: Patch })
]);
export const SessionCommand = z.strictObject({ id, expectedRevision: frame, boundary: z.enum(['immediate', 'next-beat', 'next-loop']), operation: Operation });
export const PatchCandidate = z.strictObject({ id, patch: Patch, provenance: id, previewUrl: z.string(), score: z.number().finite() });
export const CaptureErasure = z.strictObject({commandId:id,recordingEpoch:frame,throughFrame:frame,target:Target,step:z.number().int().min(0).max(63)});
export const Transport = z.strictObject({ metronomeEnabled:z.boolean().optional(),armedStartFrame:frame.optional(),countInBeatsRemaining:z.number().int().min(0).max(4).optional(),captureErasure:CaptureErasure.optional(),clockId: id, sampleRate: z.number().int().positive(), currentFrame: frame, loopStartFrame: frame, playing: z.boolean(), recording: z.boolean(), pendingCommandIds: z.array(id), recordingState: z.enum(['idle','armed','recording']).optional(), recordingStartFrame: frame.optional(), recordingTarget: Target.optional(), armedTarget: Target.optional(), recordingEpoch: frame.optional(), captureStartFrame: frame.optional(), recordingLoopStartFrame: z.number().finite().optional() });
// Speech transport (Workstream 3 proposal): microphone audio for server-side recognition.
// startFrame/endFrame are AudioContext frames on the latency-corrected performance timeline,
// half-open [startFrame, endFrame). data is base64 little-endian 16-bit mono PCM at sampleRate
// (the payload rate; frames stay on the context clock). At most 1 s of 48 kHz audio per chunk.
const base64 = z.string().min(4).max(128000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const SpeechAudio = z.strictObject({ type: z.literal('speech-audio'), streamId: id, seq: frame, clockId: id, startFrame: frame, endFrame: frame, sampleRate: z.number().int().min(8000).max(48000), encoding: z.literal('pcm-s16le'), data: base64 });
export const SpeechStatus = z.strictObject({ type: z.literal('speech-status'), streamId: id, available: z.boolean(), provider: id, reason: z.string().optional() });
// Voice research/preview v1 extension. These are UI orchestration, never musical edits.
export const ResearchContext = z.strictObject({ type: z.literal('research-context'), requestId: id, jobId: id, trackId: z.enum(['synth-1','synth-2','synth-3']), description: id, origin: z.literal('voice') });
export const CandidatePreview = z.strictObject({ type: z.literal('candidate-preview'), id, jobId: id, candidateId: id });
export const PreviewAck = z.strictObject({ type: z.literal('preview-ack'), id, jobId: id, candidateId: id, status: z.enum(['started','ended','rejected']), reason: id.optional() });
// Browser-local input actions are not musical edits and never enter the audio engine's queue.
export const BrowserOperation = z.discriminatedUnion('type', [
 z.strictObject({type:z.literal('calibrate-input'),mode:z.enum(['noise','timing','check-timing','full'])}),
 z.strictObject({type:z.literal('cancel-input-action'),actionId:id}),
 z.strictObject({type:z.literal('set-input-profile'),profile:z.enum(['noisy-room','music'])}),
 z.strictObject({type:z.literal('set-input-offset'),milliseconds:z.number().int().min(-150).max(150)})
]);
export const BrowserAction = z.strictObject({type:z.literal('browser-action'),id,clockId:id,expectedInputRevision:frame,operation:BrowserOperation});
export const BrowserActionAck = z.strictObject({type:z.literal('browser-action-ack'),id,clockId:id,inputRevision:frame,status:z.enum(['running','complete','cancelled','rejected']),reason:id.optional()});
export const BrowserStatus = z.strictObject({
 type:z.literal('browser-status'),clockId:id,inputRevision:frame,available:z.boolean(),
 microphone:z.enum(['off','starting','on','test-signal']),profile:z.enum(['noisy-room','music']),
 calibration:z.strictObject({noiseMeasured:z.boolean(),noiseFloorDb:z.number().finite(),latencySource:z.enum(['default','tap-along']),latencyMs:z.number().finite().nonnegative(),offsetAdjustMs:z.number().int().min(-150).max(150)}).nullable(),
 activeAction:z.strictObject({id,kind:z.enum(['calibrate-input','set-input-profile','set-input-offset']),phase:z.enum(['starting','countdown','practice','measuring','analysing','reconnecting'])}).nullable(),
 guidance:z.string().max(500).optional()
});
export const ClientMessage = z.discriminatedUnion('type', [
 BrowserStatus,
 BrowserActionAck,
 z.strictObject({ type: z.literal('session'), session: SessionState }),
 z.strictObject({ type: z.literal('transport'), transport: Transport }),
 z.strictObject({ type: z.literal('ack'), commandId: id, status: z.enum(['queued','applied','rejected']), revision: frame, reason: z.string().optional() }),
 z.strictObject({ type: z.literal('utterance'), id, text: id, clockId: id, startFrame: frame, endFrame: frame, duringRecording: z.boolean() }),
 z.strictObject({ type: z.literal('sound-request'), id, trackId: TrackId, description: id }),
 z.strictObject({ type: z.literal('cancel-job'), jobId: id }),
 PreviewAck,
 SpeechAudio
]);
export const ServerMessage = z.discriminatedUnion('type', [
 BrowserAction,
 z.strictObject({ type: z.literal('command'), command: SessionCommand }),
 // streamId/fromFrame are optional for older producers; every speech-audio pipeline sends both.
 // Coverage is [fromFrame, throughFrame] (inclusive) of one contiguous stream, never across a gap.
 z.strictObject({ type: z.literal('speech-verified'), clockId: id, throughFrame: frame, streamId: id.optional(), fromFrame: frame.optional() }),
 z.strictObject({ type: z.literal('command-span'), utteranceId: id, clockId: id, startFrame: frame, endFrame: frame }),
 z.strictObject({ type: z.literal('research'), jobId: id, status: z.enum(['running','complete','cancelled','failed']), progress: unit, candidates: z.array(PatchCandidate), error: z.string().optional() }),
 z.strictObject({ type: z.literal('error'), requestId: id, message: id }),
 ResearchContext,
 CandidatePreview,
 SpeechStatus
]);
export type SessionState = z.infer<typeof SessionState>;
export type PitchSnap = z.infer<typeof PitchSnap>;
export type BrowserOperation = z.infer<typeof BrowserOperation>;
export type BrowserAction = z.infer<typeof BrowserAction>;
export type BrowserActionAck = z.infer<typeof BrowserActionAck>;
export type BrowserStatus = z.infer<typeof BrowserStatus>;
export type SessionCommand = z.infer<typeof SessionCommand>;
export type PerformanceEvent = z.infer<typeof PerformanceEvent>;
export type Transport = z.infer<typeof Transport>;
export type CaptureErasure = z.infer<typeof CaptureErasure>;
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ServerMessage = z.infer<typeof ServerMessage>;
export type PatchCandidate = z.infer<typeof PatchCandidate>;
export type SpeechAudio = z.infer<typeof SpeechAudio>;
export type SpeechStatus = z.infer<typeof SpeechStatus>;
export type ResearchContext = z.infer<typeof ResearchContext>;
export type CandidatePreview = z.infer<typeof CandidatePreview>;
export type PreviewAck = z.infer<typeof PreviewAck>;
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
export {snapMidiToScale} from './pitch-snap.ts';
