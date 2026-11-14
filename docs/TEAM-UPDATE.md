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
