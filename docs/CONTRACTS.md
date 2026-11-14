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

## Real engine translation

Workstream 1 now provides `apps/web/src/engine/snapshot.ts`: `firmwareSnapshot(session, metadata)` validates and translates the logical session to upstream worklet state. Zero-velocity events are silent. Initial melodies are monophonic; overlapping notes are rejected, including overlap across the loop edge. Ties carry durations across steps. Drum velocities map to SLOOP's four native levels. Engine patches use native integer parameter ranges; timing, mixer, and arpeggiator state are session-owned. Complete research patches may include those fields: their values are validated but ignored in favor of the session. Custom drum patch parameters await a separate kit contract. Metadata includes factory FM6 packed patches, so FM6 auditions use actual factory voices. This translation is tested against real WASM. BrowserEngine implements EngineAdapter with real worklet playback, transport, and boundary-scheduled edits.

## Audio-thread command implementation

`BrowserEngine.dispatch` returns a submission receipt (`queued`); authoritative queued/applied/rejected acknowledgments are emitted by the worklet subscription. The session snapshot updates only on application. Commands while stopped apply immediately even when scheduled next-loop, except record: it starts playback/count-in and arms capture for the following loop. While playing, queued changes apply at the sample-rounded four-bar boundary, using exported firmware beat/phase and split render blocks. Queued commands are rechecked for stale revisions; stop rejects and clears pending commands. Duplicate IDs replay their last acknowledgment without reapplying. Undo history holds the last 64 musical mutations. Record and stop-recording now control the engine recording window; they do not acquire a microphone. Transport is published around every 2048 samples. The core supports integer tempos, matching firmware BPM representation.

## Agent-service integration

Workstream 3 commit `3a62724` is merged into engine-integration. `apps/web/src/integration/agent.ts` implements AgentAdapter over the actual local WebSocket. `coordinator.ts` forwards engine session/transport/ack events and dispatches validated backend proposals. It exposes server messages (including command-span) for the microphone/UI owner to consume. A submission receipt from BrowserEngine is not forwarded as an authoritative queued acknowledgment; the worklet's event is. Synchronous pre-submission rejection is forwarded so the backend does not wait forever.

Connections are explicit. Reconnection sends a fresh session and latest clock snapshot; utterances are never buffered for replay. `submitTranscript` is a development seam with a zero-length span at the latest observed audio frame. Real recognition must supply measured capture-clock utterance spans through ClientMessage; do not use UI receipt timestamps for speech exclusion. Microphone capture and command-span exclusion are not implemented by this coordinator.

## Recording and performance batches (additive v1 extension)

`record` starts a count-in when stopped, or arms the next four-bar downbeat during playback. The firmware metronome sounds while a record command is armed. At the boundary the engine selects its target and opens a recording window. Transport now optionally includes recordingState (idle/armed/recording), recordingStartFrame, and recordingTarget. Existing recording boolean means active capture, not arming. Input analysis must use recordingTarget rather than the UI selection. `stop-recording` ends the window promptly, cancels armed takes, and preserves playback. Playback stop also ends recording. Tempo changes/restarts reject during an active take; stop the take first. Microphone capture itself belongs to Workstream 2.

`commit-performance` is a next-loop SessionCommand from the input pipeline, not a natural-language agent tool. It contains 1–256 PerformanceEvents, up to 64 excludedSpans (AudioContext frame ranges), and verifiedThroughFrame. The input pipeline must only advance that watermark when speech classification has completed for those frames; merely receiving audio or an agent connection is not verification. The engine rejects foreign clocks, mismatched targets, invalid windows, future/unverified events, and malformed note durations atomically. Command-span overlaps, confidence below 0.6, and zero velocities are ignored. Remaining onsets/notes quantize to nearest sixteenth starts/ends (minimum one step, maximum one loop). New hits replace the selected lane/grid position; new notes remove overlapping old notes modulo 64. Unoccupied time preserves existing music.

The engine retains the latest recording window after stopping, so a final verified batch can be submitted against the current revision after the stop acknowledgment. A new record command replaces that window: flush final verified events before switching targets. Normal stale-revision rejection still applies to queued batches; stop-recording changes revision, so resubmit rejected final events with a new command ID/current revision rather than silently rebasing. Keep event buffering in the input pipeline until authoritative application. Session revisions and undo history update once per applied batch.

BrowserEngine.getAudioContext() exposes the actual shared 44.1 kHz context after initialization so the capture worklet uses the same sample clock. Correct measured input latency once in the input pipeline. SessionCoordinator.captureAllowed is false on agent disconnect and requests local stop-recording on disconnect when the last transport shows an armed/active take; the input owner must also stop submitting new events immediately when disconnected. Wire actual measured recognition spans via ClientMessage rather than the development transcript field's zero-length span.

Pull the updated schemas and restart the Python service after contract changes; its JSON Schema validators are cached per process. `fixtures/PerformanceBatch.json` is a structurally valid example, not real captured audio.

## Manual editing and restore

`edit-pattern` and `load-session` require next-loop boundaries. `volume` permits immediate changes. Complete semantics and audition capability examples are in EDITING.md. Pattern arrays are limited to 64 monophonic notes or 192 drum hits, with unique event IDs per track. Imported fractional BPM rejects at firmware validation. Load replaces musical state with a fresh revision, releases live voices, clears the old recording window, and rejects during an armed/active take.
