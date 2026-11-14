# Current team status — playtest repair

WS1 owns this assignment/dependency ledger. Read AGENTS.md, PLAN.md, docs/PLAYTEST-REPAIR.md, your WORKSTREAM file and coordination issue #9 at startup/capability/PR checkpoints. Preserve local work. GitHub updates do not enter independent laptop conversations automatically; agents must read them. Do not use unreviewed compatibility branches as feature bases.

## Current shared baseline

Use reviewed `origin/engine-integration`. `main` is still the documentation-only branch, not the application integration branch. The shared branch includes the pre-repair application (4bc67d2), approved repair contracts (5560129), reviewed offline-provider isolation #30, noisy-room speech coverage/command-tail fixes #33/#35, and timing diagnostics #32. Reviewed UI/input #36 and target/voice-command repairs #34/#37 are now integrated. The WS1 engine repair branches still await peer review/integration; new controls stay gated until then.

Jett's real test on Lenny's microphone reported infinite apparent Record-before-Play count-in, hard drum timing/individual correction, noisy-room melody capture failing progressively by synth 3, and unwanted demo-song startup. Recover the exact failed laptop SHA/settings if possible. Automated tests do not override these human failures.

Selected behavior: empty stopped startup (explicit load only), metronome on during playback/recording with mouse/voice mute, mouse AND precise voice erasure, aggressive Noisy room cleanup accepting artifacts. The detailed behavior and acceptance criteria are in PLAYTEST-REPAIR.md; the larger voice-groovebox roadmap remains in PLAN.md.

## Current assignments and dependencies

| Stream | Next owned work | Dependency / exact source |
| --- | --- | --- |
| WS1 / Jett / @JettHiggins | Obtain peer review of engine capabilities; review consumer follow-ups; integrate compatible repairs, rebuild matching assets, run final combined checks and publish one frozen laptop-test commit. | Transport `ws1/transport-playtest-repair` d856621 and erase `ws1/targeted-erasure` ab9342b need peer-created/reviewed PRs. This environment can push but cannot authenticate PR creation. |
| WS2 / Leo / @leoAndrade2332 | Reviewed #36 is integrated. Review WS1 engine branches, then participate in frozen real-mic conversation trials on every synth; retain same-ID surviving input on erase. | Contracts are published; **do not wait for another interface decision**. Engine enablement awaits WS1 integration. Read WORKSTREAM-2.md; #36 cc2300ea is accepted, not waiting for more source fixes. |
| WS3 / Lenny / @lennyyanza | #34/#37 source fixes are accepted/integrated. Please open/review WS1 transport d856621 and erasure ab9342b PRs next; preserve/defer research, then join the frozen microphone test. | No remaining provider/contract or source-fix wait on #34/#37. Integrated #34 8c46ebb and #37 3b8e262 after combining their resolver. Read WORKSTREAM-3.md. |

`PLAYTEST-REPAIR-CONTRACT.md`, generated schemas and fixtures/PlaytestRepair.json are normative. New operations are immediate-only. Targeted erase fences matching old input through its inclusive application frame, without global epoch reset. An already-valid queued performance batch keeps the SAME ID and unchanged surviving events across this erase only; already-stale batches are not rescued. Transport fence precedes queue acknowledgments/session. Provisional-only erase need not change revision; WS3 must invalidate old model intents using captureErasure.commandId.

## Remaining software gate

WS1 capabilities (transport deadline, default-on click/mute, empty startup and individual erasure) are pushed/tested but still need peer review/integration. Please open/review `ws1/transport-playtest-repair` d856621 and `ws1/targeted-erasure` ab9342b. This environment can push source/review comments but cannot authenticate PR creation and has no connected GitHub browser. Rebuild WASM for `vs_erase_note`, enable the reviewed UI erasure seam and run final combined/browser checks before naming the freeze. Source handoffs are TRANSPORT-PLAYTEST-REPAIR.md and TARGETED-ERASURE-REPAIR.md on those branches.

#34/#37 original and mixed-family ambiguous-target reports are fixed in the combined integration. #36 now reports insufficient quiet separately from missing audio, excludes quiet-but-pitched foreground from floor measurement and shows a rolling normal-volume margin/reference. These source requests are closed; real conversation/noise/voice acceptance remains open.

## Verified evidence and limits

Shared reviewed speech repairs: backend **245 passed/six optional skips** including available real-renderer tests. Sentinel-parent provider/key configuration remained disabled in the local service/WASM integration test. Timing diagnostics: three focused YIN/segmenter/recorder tests and shared checks passed; placement and latency compensation are unchanged.

`ws1/playtest-integration` is an isolated compatibility-review branch, **not the frozen test build**. It combines pending WS1 capabilities, #34/#36/#37 and reviewed #32 to detect integration failures. Do not treat its unsafe pending parser cases as accepted. Combined Node **190 passed/one optional skip**, shared checks and build passed; backend **309 passed/six optional skips**. Real recorder-to-WASM erasure test preserves the survivor's command ID and fences late input. Python-WebSocket-coordinator-WASM positive tests confirm spoken-operation metronome mute without revision change and erase defaulting to the active take after selection changes; these use typed transcripts, not acoustic STT.

Actual Chromium UI/AudioWorklet/WASM checks passed fresh/stopped Record, displayed audio-frame deadline, metronome button mute, drum mouse erase and piano-roll Delete while other music/playback/capture continued. Input was seeded events/synthetic silence, not physical timing, noisy-room singing or human fun acceptance. WS1 reproduced a firmware beat-counter reset defect after play/stop; fresh stopped count-in passed before that fix, so do not claim the exact original first-press cause fully established.

## Freeze and human acceptance

No frozen repair build yet. Use PLAYTEST-REPAIR-RESULTS.md only after WS1 publishes the exact reviewed commit and matching asset instructions. Test quiet and conversational-noise synth orders 1→2→3 and 3→1→2, normal voice/gain, individual committed/provisional correction, stale/ambiguous commands, metronome/count-in distinction and ten minutes of groove building without code changes. Record pitch/provisional/verification/target/commit diagnostics, not raw audio by default. Jett's timing/correction/usability/fun decision is required before repair completion.

## Preserved scope

Keep sound-research runtime #29 (5278e62d) and consumer #31 (7ec9b9d1) deferred/preserved; do not expand or merge them merely to run this repair test. WS4 may continue offline evaluation without production overlap. OpenRouter/free-model and local faster-whisper decisions already exist; credentials remain backend-local, never printed/copied/committed. No provider call or new API setup is needed for repairs. All-three-device acceptance, original module-load reproduction, blind listening and full hands-free sound design remain larger unfinished gates.

Latest reviewed combination: Node **193 passed/one optional skip**, shared checks passed, backend **350 passed/six optional skips**, service/WebSocket/WASM integration passed. All 28 reported target-refusal combinations passed across selections. Jett requested that WS1 **pause the goal when the frozen build is ready for the human test**, give exact commit/startup/checklist, and not mark the repair complete before that test.
