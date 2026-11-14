# Current team status — playtest repair priority

WS1 owns this assignment/dependency ledger. Read AGENTS.md, PLAN.md, PLAYTEST-REPAIR.md, your WORKSTREAM file and coordination issue #9 at startup/capability/PR checkpoints. Preserve local work. Independent laptop agents must read GitHub updates themselves; mentions do not update conversations.

## Latest human evidence / decisions

Jett and Lenny tested the app with Lenny's good microphone. Record before Play appeared to count in forever; drum timing/correcting individual events was frustrating; conversation interfered with singing and synth 3 eventually captured no notes despite louder voice. Exact tested SHA/settings must be recovered from the laptop/handoff. These are reported human failures, not yet WS1-reproduced root causes. Prior synthetic tests do not override them.

Jett chose mouse+voice individual erasure; metronome while playing and recording with mute; aggressive noise cleanup even with artifacts; empty project on launch. Details/acceptance: PLAYTEST-REPAIR.md. Keep the full voice-groovebox roadmap, but repair these before expanding features.

## Owners / dependencies now

| Stream | Immediate assignment | Dependency |
| --- | --- | --- |
| WS1 / Jett / @JettHiggins | Publish plan/goals; reproduce/fix count-in; shared metronome/countdown/targeted-erasure contracts; audio-thread implementation, empty startup, integration/frozen playtest. | Human microphone/fun acceptance after combined fixes. |
| WS2 / Leo / @leoAndrade2332 | Aggressive Noisy room profile, reference/calibration per device/profile, avoid learning foreground as noise, all-synth diagnostics, intuitive committed/provisional erasure and timing/click feedback. | Can reproduce independently now; wait for WS1's published metronome/erase interfaces before wiring. Read WORKSTREAM-2.md. |
| WS3 / Lenny / @lennyyanza | Noisy-room classification/coverage and target continuity; deterministic spoken erase/metronome; offline-test review. | Can reproduce independently now; wait for published shared command interfaces. Read WORKSTREAM-3.md. |

**Repair interfaces are integrated at 5560129** in PLAYTEST-REPAIR-CONTRACT.md, exported schemas and fixtures/PlaytestRepair.json. Engine support remains pending; unsupported new operations reject rather than fake completion. WS2/WS3 may implement against these exact interfaces/examples, but integrated enablement waits for the engine capability. No competing wire shapes. Shared checks and Node 170 passed/one optional skip; no human repair pass claimed.

## Baseline and preserved work

Use reviewed origin/engine-integration, not main or an unmerged teammate tip. Last pre-repair baseline: 4bc67d2. main remains documentation-only. Engine/WASM, four-bar drums/melodies, dark workspace/piano roll, save/load, calibration/manual capture, local faster-whisper and optional OpenRouter Deep Agents are integrated. One live tempo smoke passed (~4.55 s), not model/latency acceptance. This machine has a local key; never print/copy/commit it. No new provider is required for repairs.

Preserve/defer sound research runtime #29 (ws3/voice-research-runtime 5278e62d) and consumer #31 (ws1/voice-research-browser 7ec9b9d); do not expand or merge them merely to perform this repair test. #30 offline-test isolation (8b6f5d8) is independent and useful. #32 WS2 near-grid diagnostics (c4d11c53) is ready for review and may support the timing repair. No feature branch is discarded. WS4 may continue offline evaluation without production overlap.

Previous synthetic evidence: combined backend 234 passed/six optional skips; browser consumer 177 Node passed/one skip plus schema/build/service/WASM and scripted-peer actual UI/audio. Pure pitch-boundary diagnostic reproduces cell changes within ~8 ms of rounding thresholds, not the physical delay. Existing source/CI/handoffs are history, not evidence that latest human failures are fixed.

## Repair gate and handoffs

New Record from stopped must become recording after four beats, while continuous click is labeled distinctly. Erase one committed/provisional event without global reset or stale return. All synths must accept normal-volume singing with room conversation or provide honest foreground/noise guidance. Default launch is empty; explicit saved load remains. Verify quiet/noisy track orders 1-2-3 and 3-1-2, profiling raw capture/targets/pitch/provisional/coverage/commits without saving audio by default.

WS1 merges reviewed repair PRs and publishes one frozen commit. Test ten minutes on Lenny's device with no code changes during play; assess timing/corrections/usability/fun. All-three-device acceptance, original module-load reproduction, blind listening and complete hands-free sound design remain larger unfinished gates. Do not mark the whole project complete when this repair passes.

WS1 reproduced a count-in clock-reset defect: after play/stop at firmware beat 80, Record stays armed after four beats because the pending target was compared with the reset counter. Fresh stopped count-in passed, so the exact first-press laptop sequence still needs browser confirmation. WS1 is implementing fixed audio-frame deadlines.

## WS1 transport repair ready for review

ws1/transport-playtest-repair **d856621** implements fixed audio-frame Record deadlines, worklet nonzero-origin initialization, no armed Record/Play restart, fractional-tempo countdown feedback, default-on playback/capture metronome with immediate transport-only mute, and empty startup. Node 175 passed/one optional skip, shared checks, live-service/WASM integration and build pass. Actual Chromium controls/WASM with synthetic silence passed fresh Record-before-Play, displayed-deadline activation, stopped restart, empty capture and non-mutating engine mute. Human test is still required. Handoff: docs/TRANSPORT-PLAYTEST-REPAIR.md on that branch.

Not yet shared engine implementation: request peer-created/reviewed PRs against engine-integration. WS2 can wire the published countdown/metronome fields against this review source while keeping a focused consumer PR, and continue noisy-room reproduction independently. Preserve old sound-search work.

## Targeted erasure and incoming repair work

WS1 `ws1/targeted-erasure` **ab9342b** (implementation f04c82e) is pushed for review. Immediate committed/provisional erasure preserves unrelated tracks/lanes/capture, fences delayed input, retains surviving queued performance under its original command ID, rejects stale commands and releases only the currently erased sequenced pitch. Requires rebuilt WASM with `vs_erase_note`; old melodic assets reject explicitly. Seven focused real-WASM tests and the full suite (177 passed/one optional skip), checks/build and provider-disabled local service integration passed. Chromium AudioWorklet/WASM passed with directly submitted synthetic events; not mic, classifier, UI eraser or human acceptance. Handoff: docs/TARGETED-ERASURE-REPAIR.md on that branch. Both WS1 feature branches still need review/integration; shared engine-integration does not yet enable these operations.

Incoming review queue at this checkpoint: WS2 #36 noisy-room capture/repair controls (5295c5f1), WS3 #33 coverage (713975de), #34 target safety (e19b72fd), and #35 command-tail spans (ecbc07b5, stacked on #33). These are submitted work, not accepted fixes. Review exact heads, integrate compatible changes and run combined checks before naming the frozen laptop-test commit. No waiting on API access for these repairs.

## Reviewed repair integration checkpoint

WS1 reviewed and integrated #30 offline-provider isolation and #33/#35 adaptive steady-noise coverage/command-tail spans. Shared backend suite: **245 passed / six optional skips**, including available real-renderer tests. Local service/WASM integration passed with intentionally configured sentinel parent providers/key, proving subprocess isolation. These are repair building blocks; real conversational noise and physical singing remain unverified.

**#34 needs changes:** at e19b72fd, `clear synth 4` still clears the selected synth, and conflicting explicit synth targets pick the first. Reproductions and required regressions are posted in the exact-head review. Lenny owns the fix and the still-missing deterministic metronome/erase commands plus erasure-intent invalidation.

**#36 follow-up:** profile and same-ID fence consumption pass combined automated checks. A silence measurement that filters foreground singing can time out claiming no microphone audio even though audio is arriving; report the real insufficient-quiet cause. Normal-volume foreground reference/guidance is still outstanding. Leo owns these; physical conversation testing remains required.

`ws1/playtest-integration` is an isolated review/integration preparation branch, **not the frozen test build**. It combines pending WS1 capabilities and #34/#36 for compatibility testing; do not use it as a new feature base or treat #34 as accepted. Combined Node 186 passed/one optional skip, checks/build/local-service integration passed, and an additional real recorder-to-WASM fence regression passed. Actual Chromium UI passed fresh/stopped Record, metronome button mute, drum mouse erasure and piano-roll Delete while preserving unrelated music/playback/capture. Synthetic silence/seeded events only; no acoustic/noise/fun signoff. WS1 still needs peer review of d856621 and ab9342b, consumer follow-ups and a final combined check before freezing.
