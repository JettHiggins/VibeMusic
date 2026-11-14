# Current team status

WS1 maintains this assignment/dependency ledger. Read it and [coordination issue #9](https://github.com/JettHiggins/VoiceSynthesizer/issues/9) at startup, before a new capability and before a PR. PLAN.md defines product intent; shared schemas/CONTRACTS.md define implemented wire interfaces; HANDOFF.md and older issues are history. Use reviewed origin/engine-integration, preserve local work and do not dependency-poll. Independent laptop agents must read GitHub updates themselves.

## Decisions and ownership now

- **STT: local faster-whisper**, selected by Jett. Use a configurable small-model baseline, keep downloads outside Git and measure CPU latency. WS3 need not wait for a cloud provider to implement it.
- **LLM: provider deferred.** Jett is investigating hackathon resources/possible credits; no provider access has been verified or authorized. Keep the parser interim. Deep Agents remains a required unfinished capability. API calls/key setup remain deferred.
- **WS1 / Jett / @JettHiggins:** engine/contracts/build/integration; temporarily owns the browser recording-consumer UI/input wiring by explicit user assignment while Leo is out of usage. The implementation is pushed and awaiting review, detailed below.
- **WS2 / Leo / @leoAndrade2332:** PR #20 handoff received and integrated; current usage availability is unconfirmed. Do not duplicate WS1's consumer capability when resuming; read its handoff/review first. Keep ownership of subsequent UI/input/persistence work and real-device tuning.
- **WS3 / Lenny / @lennyyanza:** PR #13 retrieval and #14 speech transport are reviewed and integrated; finish the #15 pipeline review and implement off-event-loop local faster-whisper. WS1 temporarily owns browser speech streaming while Leo is unavailable. Backend recording proposals (#16) are integrated. No LLM choice is needed for those next tasks. Please also open/review WS1's ready branches while Leo is unavailable; that must not block independent WS3 work.

## Shared integration baseline

Main is still the documentation baseline, not the product implementation. engine-integration includes foundation/contracts, pinned SLOOP WASM/audio clock, editable four-bar drums/melodies, persistence, guided microphone calibration/diagnostics, manual capture, transcript command service, real offline renderer/CLAP pipeline, candidate preview/acceptance UI and output transition smoothing. Real microphone speech recognition/classified coverage and Deep Agents are not delivered.

Reviewed integrations:

| Capability | Shared state/evidence |
| --- | --- |
| Recording engine/contracts #12 (2a0625a; source ece7d80) | Next-beat Record; four-beat stopped count-in; immediate Clear/Undo; epoch/cutoff reset before cancelled capture acks; pinned armed Record deadline; loop-origin feedback. Leo reviewed the consumer contract. |
| WS2 #7/#10/#11 (89438d8) | Device picker/processing diagnostics, guided calibration and cancellation, effective-offset trim/reporting, dark persistent workspace and editable synth piano roll. The stacked #10/#11 PRs were closed as already integrated, not merged into their former bases. |
| Backend #16 (bf178b9 ancestry) | Record next-beat, Clear/Undo immediate and stop cancels count-in. 106 base backend tests plus exact live-service/WASM next-beat/live-edit test passed. |
| Original CLAP music loader (0c1c996) | Real pinned official checkpoint inference; not the unmerged #13 ranking changes. Similarity/benchmarks do not establish listening quality. |

Combined integration checks/build and Chromium calibration cancellation passed with synthetic input. PR #20 at cfa89a2 is now reviewed/integrated: shared UI requests next-beat Record and immediate Clear/Undo with epoch/cutoff resets, held-note discard, pinned transport and monochrome state. Shared schemas, full Node suite, live service/WASM integration and build passed after merging it with #13/#14. No physical-performer signoff is claimed.

## WS1 integration and remaining review

**Recording consumer is integrated through PR #20 at cfa89a2.** Leo opened the handoff PR with the same implementation already tested on the WS1 consumer branch. The combined ws1/integration-preview branch remains useful for the remaining dev-worklet change, but its recording code is now shared. The speech sender at ws1/speech-capture remains a separate unmerged capability. No real microphone acceptance is implied by these integrations.

**Integrated recording-consumer source:** user-authorized takeover of Leo's wiring. Next-beat Record; immediate Clear/Undo; epoch-tagged batches; worker/recorder cutoff resets that discard held notes and late old results; composition-origin provisional placement; pending/held-note Undo through both UI and backend proposals with backend command ID preserved. Conflicting queued pattern edits are cancelled, including discard-only Undo whose revision stays unchanged. Sticky transport/session menu; monochrome recording and diagnostics. No automatic Record re-issue.

Shared checks, full Node suite, live Python/WebSocket/WASM integration, production build and Chromium UI/synthetic-input checks passed locally for the consumer implementation. Latest review head: 4d6c90c (only browser regression/documentation additions since the fully green edd6044 implementation). The actual browser capture/YIN worker also extracted and committed C4/E4/G4 at steps 20/24/28 with durations 3/3/4 and playback continuing (p95 analysis ~8.1 ms on this machine). A synthetic drum path committed the four expected hits (~7.2 ms p95). These checks do not establish real voice/device timing. See docs/RECORDING-USABILITY.md and tests/browser on the branch for exact evidence and limitations.

**ws1/dev-worklet-sync at 248585a:** serves current-source dev worklets, bypasses stale generated public code and recovers from compile errors. Shared/full Node/build and real Chromium enable/play passed; docs/DEV-WORKLET.md is the handoff. It does not replace staging the WASM/assets.

CI at f3987e3 passed contracts/web and all firmware tests before failing an outdated research-integration assertion waiting for queued Undo. WS1 reproduced that failure and updated the test to require immediate Undo, preserved notes and continuing nonzero output. The complete real-renderer/MOCK-embedder scenario then passed locally (~78 s); edd6044 contains the fix and [CI run 43609794188](https://github.com/JettHiggins/VoiceSynthesizer/actions/runs/43609794188) completed successfully: contracts/web, native/WASM firmware/research and macOS/Windows software integration all passed. That CI result is for the consumer branch; the immediate-Undo research test correction reached shared integration with f8058df and the consumer with #20. The original full-phrase browser correction regression also passes alongside the new next-beat melody check. Additional real-browser synthetic live-capture-edits.js coverage at 4d6c90c passed: Undo discards a note still held inside the worker without consuming history; Clear during a later held note removes prior pending input; only fresh post-cutoff events with the new epoch reach the track, while playback/capture continue (~8.6 ms p95). This is synthetic evidence, not human acceptance.

Repository settings prohibit Actions PR creation; WS1 has SSH push but no other PR-create authentication. PR #20 resolved consumer review/creation. The dev-worklet capability still needs a PR/review, and speech-capture remains an in-progress feature branch. Jett's local demo now runs the combined integration-preview branch.

## Speech/retrieval integration checkpoint

**PR #13 at 0465dd7 is reviewed and integrated.** The resolved-path descendant/symlink blind-key leak is fixed and regression-tested. Native-parity preprocessing, ranking and reproducible kits are now in the shared baseline. Ranking uses a disclosed preset-name prior; benchmark gains are not human listening evidence. No blind listening has been completed by WS1.

**PR #14 at 49ca90b is approved and integrated.** Browser microphone streaming can now use the committed SpeechAudio/SpeechStatus schemas and scoped speech-verified shape. First sequence is zero; rate stays fixed; payload and context span are each <=one second. Status echoes streamId. Every new audio-driven coverage producer sends streamId/fromFrame; consumers accept only the active stream/clock and never bridge missing audio with a later watermark. available:false holds commits and never silently selects manual mode. Trim negative startup PCM along with timestamps and compensate effective latency once. The service remains a validation/unavailable stub until a recognizer is wired; this is contract approval, not real speech recognition.

**PR #15 at c8f4ed4 is still under review, not integrated.** Lenny revised the pipeline for scoped coverage/off-event-loop behavior. WS1 inspected it: 133 base tests pass/two optional skips, but delayed capture-context handling blocks approval. A queued Groove stop transcript delivered after recording stops becomes play(false), emits no exclusion span and then verifies the old audio. Preserve recording-time meaning across asynchronous stop/new-take transitions; add delayed-result/late-segment-closure regressions. Exact reproduction is in docs/reviews/SPEECH-PIPELINE-C8F4ED4.md and the PR review comment. Then WS3 wires selected local faster-whisper and measures real speech latency. Scripted recognizers do not establish recognition quality. Deep Agents remains required after the pending LLM-provider decision; API calls/key setup remain deferred.

WS1 review evidence: isolated speech backend 123 passed/two skipped; isolated retrieval backend 125 passed/five skipped. Combined base backend 142 passed/five optional skips, schemas, full Node suite, live service/WASM integration and build pass. The real-renderer/MOCK-embedder research integration passed (~77 s): candidate previews/acceptance, preserved melody, immediate Undo and continuing nonzero output. Its assertion is reconciled to the already approved immediate Undo behavior. This does not measure semantic retrieval or human listening quality. Human microphone and blind-listening gates remain open.

## Issue #3 contract answers

(a) Keep current research wire shape until a focused additive metadata proposal is reviewed; explicit track/description metadata can be proposed for voice-started jobs. This does not block STT/review fixes.
(b) Audition uses non-mutating previewUrl playback; accept applies the patch and Undo restores accepted state.
(c) Armed Record keeps its original deadline through unrelated edits. Other queued musical mutations retain strict revision checks; never replay discarded capture/Clear intentions.
(d) Recognized Groove wake speech is excluded even when the command is not understood; report error with no mutation.
(e) Stop-recording cancels armed/count-in Record and keeps playback, without consuming a musical revision.
These answers and the STT decision are published through #9 and linked from #3; its original blocker table is stale.

## Real-device findings and remaining gates

The user got drum mic input on Lenny's device but hits landed late with wired headphones. Leo separately measured ~120 ms round trip versus ~62 ms browser estimate; that is a plausible cause, not a calibrated performer pass on Lenny's device. Melody produced no notes with a recalled TypeScript/failed-to-load/chord error; exact cause is unconfirmed.

- Human calibrated drum takes, sung melody and phrase correction on Lenny's and development devices: retain OS/browser/device/commit/exact error evidence, no raw recordings by default.
- Reviewed consumer integration and combined next-beat/live Clear/Undo without stale audio returning.
- Preset audition and exact loading-failure diagnosis; synthetic melody success does not close the user's device report.
- One shared fingerprinted blind kit, three human listeners and comparison against preset-only retrieval. No listening results yet.
- Real STT/classified coverage, then Deep Agents after the LLM decision, followed by the complete hands-free PLAN.md scenario.
- Ten-minute audible playback and timing/command targets on real macOS/Windows/WSL2 setups. CI and offline renders support, not replace, physical acceptance.

## WS4 — fourth teammate, independent evaluation work

WS4 owns only evals/, tools/evaluation/ and docs/WS4-HANDOFF.md for the tickets in docs/WS4-TICKETS.json. Start with the hands-free command acceptance corpus, then the standalone blind-listening summarizer, then the held-out sound-description/refinement rubric. All are independent of API access, app runtime and model downloads, and must not modify WS1/WS2/WS3 implementations. Copyable startup instruction: docs/WS4-START.md. One focused PR per ticket against engine-integration; WS1 integrates.

## Browser speech consumer in progress

WS1 is implementing ws1/speech-capture (8659c98), based on approved integration plus the prepared recording/worklet preview. Independent worklet speech tap and frame-aligned 100 ms PCM worker are implemented/tested, with continuous silence, pre-enable sample exclusion, matching startup PCM trim and terminal gap handling. Payload uses the approved context rate (44.1 kHz); local recognizer adaptation owns model-rate conversion. At feature head 63422ff the worker is connected to the local socket and explicit hands-free UI. Stream/clock/fromFrame coverage gates, bounded socket buffering, no implicit manual fallback, explicit retry and pending-capture/take reset are implemented. Tests cover mode transitions and same-clock gap coverage. An actual Chromium-to-service synthetic-silence run validated 4410 frames/8820 PCM bytes and the real unavailable response: Record stayed blocked, playback continued, explicit opt-out alone selected manual mode. Positive scripted classified-flow integration, actual faster-whisper, delayed-result fixes and human measurements remain open. See docs/BROWSER-SPEECH.md on that branch. Transport streaming is verified on this feature branch; do not claim actual speech recognition or human acceptance, and do not duplicate this browser implementation on WS2.
