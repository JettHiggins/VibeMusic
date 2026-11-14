@leoAndrade2332 @lennyyanza — Jett requested this update while your workstream agents are running. Please pass it to your session or have it read this issue and the latest docs/STATUS.md before the next capability/PR. A GitHub notification cannot directly inject instructions into a separate laptop conversation.

## New priority from real-device testing

The user tried the app on Lenny's device. Drums captured microphone audio, but recorded hits were late with **wired headphones**. Calibration had insufficient preparation, waiting four bars to record was frustrating, Clear was disabled during recording, and Undo waited for the loop. Melody produced no notes and a recalled TypeScript/failed-to-load/chord error; exact cause is unknown.

The user has explicitly chosen:

- **Next-beat recording during playback**, **one-bar count-in from stopped**.
- **Immediate Clear/Undo while recording/playback continue**, with conflicting buffered audio discarded so old music cannot return.
- **Dark monochrome DAW workspace**, persistent transport/tracks/editor/inspector, **no workspace tabs**, drum step lanes and a **synth piano roll**.
- Guided calibration with a preparation countdown, practice clicks, progress, cancellation and adjustable recording offset.

## Assignments: work in parallel without duplicating interfaces

**WS1 / Jett:** shared contract and engine changes first: scheduling, live edits, exact capture cutoffs, schemas/examples/tests and integration. WS1 is not concurrently rewriting the workspace UI.

**WS2 / Leo:** begin calibration UX, persistent monochrome workspace/piano roll and real-device melody/latency diagnosis now. Add detected pitch/provisional-note feedback and actionable loading errors. Wait only for WS1's approved contract commit before integrating scheduling/live-edit resets; do not invent competing shared fields. Own apps/web/src/ui, input and persistence. Coordinate main.tsx wiring with WS1.

**WS3 / Lenny:** help reproduce/capture the synth error on your device. Continue service-owned work, then adopt WS1's exact contract commit for backend proposals/tests. Speech transport remains a proposal coordinated with WS2. API access is deferred; no speech/LLM provider was selected. Deep Agents remains a requirement. Search quality can proceed independently using fixed prompts and a shared blind-listening kit.

## Restart correctly

Preserve local work. Fetch and base new capability branches on **origin/engine-integration**, starting from **0c1c996 or its reviewed successors**, not main or old workstream tips. Read AGENTS.md, PLAN.md, docs/STATUS.md, docs/CONTRACTS.md and the latest handoff sections. Open PRs to engine-integration with base SHA, behavior, tests, limitations and dependencies. At startup/new-capability/pre-PR checkpoints check this issue for steering; do not repeatedly dependency-poll.

## Existing work to preserve

UI/persistence/drum capture/YIN melody capture, recording windows, candidate preview/acceptance UI and original CLAP music inference are already integrated. Old issue #3 lists several of these as blocked; those entries are stale. 0c1c996 passed CI. Physical-device acceptance, speech recognition, Deep Agents and sound-quality listening are still open. The electric-piano search ranking a timpani is quality evidence to investigate, not a reason to rebuild the working loader.

Please acknowledge here with your agent's branch/base SHA, current edits, and your next owned task so WS1 can reconcile overlap. The full updated acceptance checklist is in docs/STATUS.md.

## WS1 capability is published for review — latest update

The recording contract/engine branch is **ws1/recording-usability at bd1428b**: [review comparison](https://github.com/JettHiggins/VoiceSynthesizer/compare/engine-integration...ws1/recording-usability), [exact consumer handoff](https://github.com/JettHiggins/VoiceSynthesizer/blob/ws1/recording-usability/docs/RECORDING-USABILITY.md). Local shared checks, full Node tests, real-service/WASM integration, 99 backend tests and the production build pass. It is **not merged**, and UI/input/backend adoption is not complete. GitHub repository settings denied automatic PR creation; a collaborator must open the PR from that comparison or explicitly enable authenticated PR creation.

Leo: I reviewed PR #7's command/calibration changes. Preserve its useful diagnostics, input picker and real-device findings (~62 ms browser estimate versus ~120 ms measured). The capability now keeps an armed Record's original deadline through mute/select changes; remove the previous automatic Record re-issue workaround when adopting it. A re-issued next-beat Record during count-in could change its start time. Align calibration to the approved 3-second preparation, 4 practice and 8 measured clicks, plus cancellation and offset adjustment. Use recordingEpoch/captureStartFrame reset-before-ack feedback to discard old input; use recordingLoopStartFrame for provisional placement and discardCaptureOnly for provisional Undo. Keep the existing useful tests, updating expectations to the new contract.

Lenny: after the reviewed merge, Record proposals should use next-beat, Clear/Undo immediate, and normal transport/session validation must accept the new optional fields. Speech-provider decisions remain deferred. PR #8's capture requirements are useful input to your separate speech-transport proposal. WS1 is not touching your service implementation in this capability.

Output smoothing was separately published on engine-integration in 735f122. This is signal-level tested, not yet human-listened. Please acknowledge your current branch/base and overlap in this issue when you next check GitHub.

## Review/access request

Leo: your acknowledgment and PR #10 match the new priorities. Because GitHub Actions cannot create PRs here, please use your existing authenticated GitHub access to **open a PR from JettHiggins/VoiceSynthesizer:ws1/recording-usability into engine-integration**, then review the capture-reset and armed-record behavior before adopting it. The branch is bd1428b; local checks are recorded in its handoff. Please do not merge it yourself: WS1 remains integrator and will merge after review/CI. If you cannot open that PR either, report the exact access failure here; your workspace/calibration work can continue independently.
