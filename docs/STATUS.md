# Current team status

WS1 maintains this current ledger. PLAN.md defines product intent, AGENTS.md ownership, and shared schemas/CONTRACTS.md the implemented wire interfaces. HANDOFF.md is history. Coordination: https://github.com/JettHiggins/VoiceSynthesizer/issues/9. Read this file/issue at startup, new-capability and pre-PR checkpoints; preserve local work and do not dependency-poll.

## Shared integration baseline

Use origin/engine-integration, not main or old workstream tips. Main is still the documentation baseline. Milestone 0, pinned SLOOP WASM/audio clock, standalone editing/persistence, manual drum/melody capture, service transcript commands, real renderer/research pipeline and candidate preview/acceptance UI are integrated. API access remains deferred. Real speech recognition, classified watermarks and Deep Agents are not delivered.

PR #12 recording-usability engine/contracts are integrated from ece7d80 after Leo's consumer review of bd1428b (clean merge with WS2 stack; 141 tests passed, one skipped). The implementation had passed WS1 local checks, full Node tests, live Python/WebSocket/WASM integration, base backend tests and build; CI at bd1428b passed. This does not prove real microphone/performer usability.

Delivered engine capability (consumer/UI adoption still pending):
- Record accepts next-beat: next beat during playback, four count-in beats from stopped. Explicit next-loop callers keep legacy behavior.
- Armed Record pins its target/deadline through unrelated musical edits; do not re-issue it on revision changes. Other queued musical edits still recheck revision.
- Clear/Undo permit immediate during recording/playback. Undo discards queued input first; discardCaptureOnly handles unsent provisional input without consuming history.
- Reset transport precedes cancelled capture acks. recordingEpoch/captureStartFrame and optional epoch-tagged batches prevent pre-edit audio returning. recordingLoopStartFrame anchors mid-loop provisional placement. See RECORDING-USABILITY.md for exact WS2/WS3 checklists.
- Patch output has a five-millisecond transition (735f122); software tests pass, human listening is open.

PR #8 speech-capture requirements are reviewed and merged. They do not approve a transport/provider. Effective latency includes manual trim, applied exactly once.

## Active owners and next tasks

**WS1 / Jett / @JettHiggins:** integrate reviewed capability-sized PRs, own schemas/engine/root config and final signoff. Review the current WS2 stack and WS3 retrieval PR. Separate ws1/dev-worklet-sync at 248585a is ready for PR/review: current-source dev worklets, compile-error recovery, no stale public artifact. Local checks and actual browser enable/play pass. Repository settings block Actions from creating PRs; a collaborator must open that review. Do not rewrite the UI concurrently with WS2.

**WS2 / Leo / @leoAndrade2332:** PR #7 microphone-test support, #10 guided calibration/fixes, and #11 monochrome workspace/piano roll are reviewed and integrated. Integrate the approved PR #12 merge now: next-beat Record, immediate Clear/Undo, exact epoch/cutoff reset in recorder/worker, discard-only provisional Undo and epoch-tagged batches. Remove automatic Record re-issue. Send final combined tests/limitations and main.tsx wiring notes in the PR. WS1 reviews before merging. Preserve input picker, granted-processing diagnostics and measurements-only reporting.

**WS3 / Lenny / @lennyyanza:** PR #13 adds native-parity preprocessing, retrieval ranking and reproducible listening kits; WS1 review pending. PR #16 backend proposals are integrated (Record next-beat, Clear/Undo immediate), with 106 base backend tests and a tightened live-service/WASM test passing. Coordinate speech-transport proposal with WS2; no provider has been selected. Keep real-time audio independent of inference. Do not substitute the parser for completion of Deep Agents.

## Real-device findings and accepted UI direction

The user tested on Lenny's device. Drum mic capture worked, but hits landed late with wired headphones. Leo separately measured ~120 ms round trip versus a ~62 ms browser estimate, explaining a plausible late-placement cause. This is not yet a calibrated performer pass on Lenny's laptop. Melody produced no notes with a recalled TypeScript/failed-to-load/chord error; exact cause remains unconfirmed.

Required UX: dark monochrome persistent DAW transport/tracks/editor/inspector, no workspace tabs; drum lanes plus editable synth piano roll (create/delete/move/resize, four-bar grid, keyboard and playhead). Guided calibration: visible three-second preparation, four practice/eight measured clicks for timing, progress/Cancel and offset trim; silence measurement has preparation/cancellation without clicks. Preserve old calibration on interruption. Show live pitch and pending/committed/rejected states with actionable engine errors.

WS1 requested fixes on exact original heads of PRs #7/#10. Leo reports fixes in #10 at 10113cf and #11: diagnostic expiry uses processedThrough rather than the held watermark; TimedRun settles on lifecycle cancellation; reports include trim/effective latency; silence measurement is guided. WS1 verified those fixes in source, ran the combined full Node suite/shared checks/live-service integration/build, and exercised timing/silence cancellation in Chromium before integrating the stack.

## Remaining acceptance gates

- Human calibrated drum takes, melody and phrase correction on Lenny's device and each development laptop; retain exact OS/browser/device/commit/error evidence. No raw mic recordings by default.
- Combined next-beat/live-edit workflow with no stale input returning; no tab switching required.
- Preset audition works or provides a precise actionable failure. The recalled chord error is not declared fixed by synthetic tests.
- Three-person blind sound comparison using one shared kit/fingerprint; ranking gains and preset-name benchmarks do not establish perceptual quality.
- Real speech recognition/classification and Deep Agents after the necessary decisions/contracts; full hands-free scenario in PLAN.md.
- Ten-minute audible browser playback and timing/command targets on real macOS/Windows/WSL2 setups. CI and offline clock renders support but do not replace physical acceptance.

## Combined workspace integration checkpoint

PRs #7/#10/#11 are integrated together, including reviewed lifecycle/diagnostic fixes. Chromium showed the dark workspace, no tabs, and synth piano roll; timing/silence preparation and Cancel preserved calibration using a synthetic input. This is not physical-microphone signoff. The top bar still sends legacy next-loop requests and the recorder still needs epoch/cutoff wiring: WS2's immediate next task is adopting merged PR #12. Root browser review found transport scrolls offscreen while using the inspector (scrollY 297, header top -297/bottom -251); WS2 should anchor it and add a scroll regression. Keep the requested monochrome palette, including recording state.

## WS3 retrieval review checkpoint

WS1 reviewed PR #13 at ed57bff and ran the isolated base backend suite (113 passed, five opt-in/asset cases skipped). A focused reproduction showed key_dir=out/'answer-key' writes the supposedly separate answer key under the listening folder. Requested resolved-path descendant rejection and a regression before merge. Default sibling keys/fingerprints and the disclosed family-name-prior caveats are useful. Model parity and benchmark measurements are currently WS3's reported evidence; human listening remains open.

## Speech proposal review (not approved)

PR #14 proposes audio transport and #15 a provider-independent pipeline. WS1 reproduced acceptance of a six-second 8 kHz chunk and a mid-stream payload-rate change. Requested one-second bounds, fixed per-stream rate/initial sequence, streamId-scoped status and streamId/fromFrame coverage on new watermarks. Same-clock gap recovery must not verify old pending audio or silently enable manual commits. Requested recognized wake-span exclusion even when the command fails interpretation. WS2 must wait for the approved revised contract; real STT/Deep Agents remain absent.

## Backend recording integration

Reviewed PR #16 is integrated. Live WebSocket/WASM validation now requires the exact firmware next-beat start, commits a captured hit, clears and undoes it immediately via Groove transcripts while recording/playback continue, then verifies stop/disconnect behavior. This is the transcript-level seam with a synthetic musical event, not microphone speech recognition.

## Ownership and provider decision update

Jett explicitly assigned WS1 the recording-consumer UI/input work while Leo is out of usage. Active branch: ws1/recording-consumer; do not duplicate it on WS2. The user selected local faster-whisper for STT; use a configurable small-model baseline and measure CPU latency. Language-model provider remains deferred while possible existing access is researched; the parser is interim and Deep Agents remains incomplete. API calls/credential setup remain deferred. WS3 can address #13/#14/#15 review fixes and implement off-event-loop local STT without waiting for an LLM provider. docs/TEAM-UPDATE.md records WS1 answers to all issue #3 contract questions and supersedes its old blockers.

## WS1 recording-consumer capability ready

ws1/recording-consumer at f3987e3 is pushed, not yet integrated. WS1 took over Leo's wiring by explicit user request. It includes next-beat Record, immediate Clear/Undo, worker/recorder epoch/cutoff resets, epoch-tagged batches, composition-origin feedback, pending/held-note Undo through UI/backend, cancellation of conflicting queued pattern edits, sticky transport and monochrome recording/diagnostics. Shared checks, full Node suite, service/WASM integration, build and actual Chromium UI/synthetic-input checks passed; physical microphone/speech acceptance is open. See docs/RECORDING-USABILITY.md on the feature branch. Lenny is asked to open/review this PR while Leo is unavailable because repository settings prohibit Actions PR creation and WS1 has no other PR-create authentication. Do not duplicate the capability. This review request does not block independent local STT or existing WS3 review fixes.
