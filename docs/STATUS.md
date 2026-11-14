# Current team status

WS1 maintains this assignment/dependency ledger. Read it and [coordination issue #9](https://github.com/JettHiggins/VoiceSynthesizer/issues/9) at startup, before a new capability and before a PR. PLAN.md defines product intent; shared schemas/CONTRACTS.md define implemented wire interfaces; HANDOFF.md and older issues are history. Use reviewed origin/engine-integration, preserve local work and do not dependency-poll. Independent laptop agents must read GitHub updates themselves.

## Decisions and ownership now

- **STT: local faster-whisper**, selected by Jett. Use a configurable small-model baseline, keep downloads outside Git and measure CPU latency. WS3 need not wait for a cloud provider to implement it.
- **LLM: provider deferred.** Jett is investigating hackathon resources/possible credits; no provider access has been verified or authorized. Keep the parser interim. Deep Agents remains a required unfinished capability. API calls/key setup remain deferred.
- **WS1 / Jett / @JettHiggins:** engine/contracts/build/integration; temporarily owns the browser recording-consumer UI/input wiring by explicit user assignment while Leo is out of usage. The implementation is pushed and awaiting review, detailed below.
- **WS2 / Leo / @leoAndrade2332:** unavailable due to usage limit. Do not duplicate WS1's consumer capability when resuming; read its handoff/review first. Keep ownership of subsequent UI/input/persistence work and real-device tuning.
- **WS3 / Lenny / @lennyyanza:** address the existing review fixes on #13/#14/#15, then implement off-event-loop local STT. Backend recording proposals (#16) are integrated. No LLM choice is needed for those next tasks. Please also open/review WS1's ready branches while Leo is unavailable; that must not block independent WS3 work.

## Shared integration baseline

Main is still the documentation baseline, not the product implementation. engine-integration includes foundation/contracts, pinned SLOOP WASM/audio clock, editable four-bar drums/melodies, persistence, guided microphone calibration/diagnostics, manual capture, transcript command service, real offline renderer/CLAP pipeline, candidate preview/acceptance UI and output transition smoothing. Real microphone speech recognition/classified coverage and Deep Agents are not delivered.

Reviewed integrations:

| Capability | Shared state/evidence |
| --- | --- |
| Recording engine/contracts #12 (2a0625a; source ece7d80) | Next-beat Record; four-beat stopped count-in; immediate Clear/Undo; epoch/cutoff reset before cancelled capture acks; pinned armed Record deadline; loop-origin feedback. Leo reviewed the consumer contract. |
| WS2 #7/#10/#11 (89438d8) | Device picker/processing diagnostics, guided calibration and cancellation, effective-offset trim/reporting, dark persistent workspace and editable synth piano roll. The stacked #10/#11 PRs were closed as already integrated, not merged into their former bases. |
| Backend #16 (bf178b9 ancestry) | Record next-beat, Clear/Undo immediate and stop cancels count-in. 106 base backend tests plus exact live-service/WASM next-beat/live-edit test passed. |
| Original CLAP music loader (0c1c996) | Real pinned official checkpoint inference; not the unmerged #13 ranking changes. Similarity/benchmarks do not establish listening quality. |

Combined integration checks/build and Chromium calibration cancellation passed with synthetic input. Current shared UI still sends legacy recording/live-edit requests until the ready consumer branch is reviewed and merged. No physical-performer signoff is claimed.

## Ready WS1 branches (not integrated)

**ws1/recording-consumer:** user-authorized takeover of Leo's wiring. Next-beat Record; immediate Clear/Undo; epoch-tagged batches; worker/recorder cutoff resets that discard held notes and late old results; composition-origin provisional placement; pending/held-note Undo through both UI and backend proposals with backend command ID preserved. Conflicting queued pattern edits are cancelled, including discard-only Undo whose revision stays unchanged. Sticky transport/session menu; monochrome recording and diagnostics. No automatic Record re-issue.

Shared checks, full Node suite, live Python/WebSocket/WASM integration, production build and Chromium UI/synthetic-input checks passed locally for the consumer implementation. Latest review head: 4d6c90c (only browser regression/documentation additions since the fully green edd6044 implementation). The actual browser capture/YIN worker also extracted and committed C4/E4/G4 at steps 20/24/28 with durations 3/3/4 and playback continuing (p95 analysis ~8.1 ms on this machine). A synthetic drum path committed the four expected hits (~7.2 ms p95). These checks do not establish real voice/device timing. See docs/RECORDING-USABILITY.md and tests/browser on the branch for exact evidence and limitations.

**ws1/dev-worklet-sync at 248585a:** serves current-source dev worklets, bypasses stale generated public code and recovers from compile errors. Shared/full Node/build and real Chromium enable/play passed; docs/DEV-WORKLET.md is the handoff. It does not replace staging the WASM/assets.

CI at f3987e3 passed contracts/web and all firmware tests before failing an outdated research-integration assertion waiting for queued Undo. WS1 reproduced that failure and updated the test to require immediate Undo, preserved notes and continuing nonzero output. The complete real-renderer/MOCK-embedder scenario then passed locally (~78 s); edd6044 contains the fix and [CI run 43609794188](https://github.com/JettHiggins/VoiceSynthesizer/actions/runs/43609794188) completed successfully: contracts/web, native/WASM firmware/research and macOS/Windows software integration all passed. This result is for the consumer branch; its test correction has not yet reached shared integration. The original full-phrase browser correction regression also passes alongside the new next-beat melody check. Additional real-browser synthetic live-capture-edits.js coverage at 4d6c90c passed: Undo discards a note still held inside the worker without consuming history; Clear during a later held note removes prior pending input; only fresh post-cutoff events with the new epoch reach the track, while playback/capture continue (~8.6 ms p95). This is synthetic evidence, not human acceptance.

Repository settings prohibit Actions PR creation; WS1 has SSH push but no other PR-create authentication. Lenny is asked in #9 to open/review both ready branches against engine-integration. Do not report them as integrated before review/merge. Jett's local demo runs the consumer branch.

## WS3 open reviews

**#13 retrieval/listening kits (ed57bff):** reviewed; fix required before merge. WS1 reproduced key_dir=out/'answer-key' putting the answers inside the blind listening folder. Reject all resolved descendants/symlink aliases and add a regression. Isolated base tests: 113 pass/five optional cases skipped. Native preprocessing, prompt/ranking and benchmark evidence is reported by WS3; human comparison is still open.

**#14 speech transport / #15 pipeline:** not approved. Scope speech-status to streamId; add streamId/fromFrame coverage to new speech-verified producers. First seq=0, fixed payload rate and <=one-second payload/context spans are required; WS1 reproduced six-second 8 kHz chunks and rate changes being accepted. Gap/reconnect on the same clock must never verify pre-gap provisional input. available:false must hold commits, not silently enable manual mode. Trim negative startup audio with matching PCM removal and effective latency once. Recognized Groove speech must emit a measured command-span even when interpretation fails; error/no mutation and only appropriate coverage follow. Scripted recognizers/energy segmentation do not prove recognition. Real transcription must be off the event loop; failures hold verification and signal unavailability. Existing review comments have exact regressions; latest heads only merged the base, not those fixes.

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
