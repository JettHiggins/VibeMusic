# Contract v1 integration guide

Source of truth: `packages/contracts/src/index.ts`. Exported JSON Schemas are committed for Python consumers. Change the Zod source, run `npm run contracts:export`, and commit generated changes together. TypeScript consumers import from `@voicesynth/contracts`; Python consumers use JSON Schema Draft 2020-12. Fixtures are examples, not real recorded audio or researched patches.

## Session and clock

The browser owns SessionState and revisions. Track order is synth-1, synth-2, synth-3, drums, corresponding to firmware slots 0–3. Drum lanes are logical names; Workstream 1 maps them to firmware lanes. The session has 64 grid steps. Durations may cross the loop edge; consumers wrap modulo 64. MIDI is integer semitones; velocity and volume are normalized 0–1. Patch parameter keys are firmware parameter IDs expressed as decimal strings, with native numeric values (not normalized). Actual parameter bounds and legal engine/preset combinations are validated by the real engine adapter, not the structural schemas.

All audio frame timestamps refer to the AudioContext sample clock, identified by clockId, at Transport.sampleRate. They are not Date.now timestamps or analysis-worker completion times. A new audio context creates a new clockId. Capture must translate device/input positions to this clock and compensate measured latency once. Reject mismatched clock IDs. Transport snapshots are observations, never a clock to schedule audio from on the UI thread. LoopStartFrame is the first downbeat of the current loop. Audio scheduling belongs in the engine worklet.

## Command lifecycle

The backend receives session snapshots and proposes SessionCommand values. Browser validates schema, expectedRevision, operation semantics, target, and parameter bounds. Reject stale commands rather than rebasing them silently. Duplicate IDs return the previous acknowledgment; do not apply twice. Immediate commands apply synchronously where permitted; next-loop commands receive queued then applied acknowledgments. Recheck revision on application; rejection must not change musical state. Revisions increase once for each applied command or atomic performance batch. Publish a fresh session snapshot after mutations. The real implementation must serialize pending mutations; mocks do not simulate an audio queue.

Record, tempo, clear, undo, and apply-patch use next-loop. Selection, stop-recording, mute, and transport play/stop permit immediate. Stop-recording ends capture promptly and preserves playback. Record schedules count-in and downbeat activation. Clear with a lane clears that lane only; without lane clears the track. Undo restores the previous musical edit. Drum selection/record requires a lane; melodic targets must not have one. Schema validation is structural: engine validation additionally enforces these semantic rules, unique track IDs, valid note/hit placement, and endFrame > captureFrame.

## WebSocket and speech

Workstream 3 implements `ws://127.0.0.1:8000/ws` with JSON text frames validated as ClientMessage/ServerMessage. On connect/reconnect browser sends session then transport. Server requests mutations via command messages; browser replies ack. No replay of pre-disconnect recording commands. Backend never becomes authoritative for session state.

Utterance spans use the same clockId/sample positions as performance events. During recording only recognized wake-phrase commands produce a command and command-span. Browser excludes those spans from provisional musical events before committing them. If recognition is unavailable or its decision misses the pending-loop deadline, stop accepting new recording commits and report the problem; keep playback. Speech transport/audio provider protocols are owned by Workstream 3 and need a contract proposal before integration; v1 utterance is the transcript-level seam.

Sound-request starts a cancellable research job; research messages share jobId and return candidates and progress. Candidate previewUrl is a backend-served URL (empty only in fixtures). Applying a candidate uses apply-patch and must preserve notes. Candidate cycling/acceptance is orchestrated by backend and UI, with browser acknowledgments confirming application.

## Mocks and ownership

`MockEngine` deliberately implements selection only and rejects unsupported operations. It has no audio, transport, quantization, or recording. `MockAgent` responds to sound requests with an empty candidate list. Do not present these as completed musical features.

Workstream 2 owns `apps/web/src/ui`, `apps/web/src/input`, and `apps/web/src/persistence` (create as needed). Workstream 3 owns `services/agent`. Workstream 1 owns `apps/web/src/engine`, root configuration, shared contracts, and integration changes to `main.tsx`. Coordinate UI entrypoint wiring by PR; do not independently replace root manifests or contracts. Use EngineAdapter/AgentAdapter as dependency-injection seams; propose missing methods before relying on them.
