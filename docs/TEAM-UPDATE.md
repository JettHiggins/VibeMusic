@leoAndrade2332 @lennyyanza — current steering from Jett/WS1. Read docs/STATUS.md and this issue at normal work checkpoints; independent laptop agents do not receive live conversation messages. Please acknowledge branch/base and next task. Do not repeatedly poll dependencies.

## Reviewed integrations now available

- **PR #12 is merged** into engine-integration (2a0625a, source ece7d80; consumer review by Leo covered bd1428b). Next-beat Record, one-bar stopped count-in, immediate Clear/Undo, armed-record deadline pinning and reset-before-ack capture epoch/cutoff feedback are implemented in the engine. Exact consumer checklist: docs/RECORDING-USABILITY.md on engine-integration.
- **PRs #7/#10/#11 are integrated together**: microphone diagnostics/device picker, guided calibration/lifecycle fixes and dark workspace/piano roll. Combined shared checks, full Node suite, live Python/WebSocket/WASM test and production build pass. Chromium displayed the roll/no tabs and timing/silence Cancel preserved calibration with synthetic input. No real-performer signoff is claimed.
- PR #8 speech-capture requirements are reviewed/merged documentation, not an audio transport/provider decision.

## Leo / WS2 — immediate task

Integrate the latest origin/engine-integration and wire PR #12 into the workspace and capture pipeline: next-beat Record; immediate Clear/Undo; no Record re-issue on revision changes; exact epoch/cutoff resets and worker reset; optional epoch-tagged batches; provisional Undo; composition-loop-origin placement. Existing UI still sends legacy next-loop actions, so the usability pass is not complete yet. Retain the reviewed calibration/diagnostic improvements.

Root's combined browser review found the transport leaves the viewport while scrolling to calibration: scrollY=297, header top=-297/bottom=-251. Anchor the top transport and test it while scrolling the inspector, including session-menu stacking. Keep recording state monochrome too (the current palette still reserves red for Rec). These are focused follow-ups; WS1 is not concurrently rewriting the UI. The old #7/#10 review items were verified in the updated stack and are resolved.

Please also open/review the separate WS1 dev-server capability using your authenticated access: [ws1/dev-worklet-sync at 248585a](https://github.com/JettHiggins/VoiceSynthesizer/compare/engine-integration...ws1/dev-worklet-sync). It serves current-source worklets and prevents stale generated public artifacts from accepting different schemas than the UI. Regression and real Chromium enable/play checks pass; docs/DEV-WORKLET.md is the handoff. Actions PR creation remains prohibited, but normal issue/PR comments work.

## Lenny / WS3 — immediate task

Adopt merged PR #12 in backend proposals/tests: Record next-beat, Clear/Undo immediate; accept the new optional transport fields without deriving speech verification from connectivity. PR #13 retrieval/parity/listening-kit changes are received and under WS1 review. Keep speech transport as a separate proposal with WS2. API access remains deferred; no speech/LLM provider is selected, and Deep Agents remains required.

## Acceptance and evidence

User-device facts: drums received mic audio; recorded hits were late on wired headphones; Leo measured ~120 ms round trip versus ~62 ms browser estimate on a Windows device. Melody/chord/loading error on Lenny's device is still unconfirmed. Preserve diagnostics and collect exact error/commit/device data. Ranking scores, family-name benchmarks and synthetic audio do not establish quality. Three-person listening on one shared kit, real calibrated performers, ten-minute audible playback and the full hands-free scenario remain open. Main is still the documentation baseline; use reviewed origin/engine-integration capability commits.
