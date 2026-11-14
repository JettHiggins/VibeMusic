# Current team status and restart instructions

WS1 maintains this file. PLAN.md defines the product; AGENTS.md defines ownership; CONTRACTS.md and shared schemas define implemented interfaces. This file records current assignments and evidence. HANDOFF.md is chronological history. New product decisions below supersede conflicting older issue/handoff text, but are not implemented contracts until explicitly marked delivered.

Coordination issue: **Team restart: recording usability and real-device fixes**. The team-update workflow creates/updates it from docs/TEAM-UPDATE.md and links it from issue #3. Read the issue at normal work checkpoints; no repeated polling.

## Shared baseline and evidence

- Restart baseline: engine-integration at 0c1c996 or its reviewed successors. Main is the older documentation baseline. Preserve local work and create fresh capability branches from origin/engine-integration.
- CI passed at 0c1c996, including software checks on Linux/macOS/Windows. This is not physical microphone or audible-glitch signoff.
- WS1 / Jett / @JettHiggins: real pinned SLOOP WASM, four-bar clock, engine commands/recording windows, renderer, contracts, integration and CI delivered. Five-millisecond patch-transition smoothing is published in 735f122; human listening remains open.
- WS2 / Leo / @leoAndrade2332: UI, editing/persistence, calibration, drum onset capture, YIN melody capture/correction and buffering integrated. Synthetic browser input tests pass; real-device acceptance is open.
- WS3 / Lenny / @lennyyanza: local transcript service, sound jobs/previews/acceptance and research framework integrated. Original CLAP music inference is working locally; 153 presets and 128 variations were exercised. Search quality and blind listening are open.
- Candidate preview/acceptance UI already exists. Recording/count-in and the original music checkpoint are no longer blocked as described in old issue #3.
- Real microphone speech recognition, measured speech classification/watermarks, Deep Agents and the complete hands-free acceptance session are not delivered. API access remains deferred. No speech provider has been selected.

## User feedback and accepted product changes

The user tested on Lenny's device. Microphone input worked for drums. Recorded hits were late with wired headphones. Calibration was abrupt, four-bar recording waits were frustrating, Clear was disabled during recording, and Undo felt unavailable because it waited for the loop. Melody produced no notes; the user recalls a TypeScript/failed-to-load/chord error, without exact wording. Do not assume missing samples or treat a synthetic test as resolution.

Accepted changes, not yet implemented:

1. Record on the next beat during playback; from stopped, one-bar count-in. Keep the four-bar composition and sixteenth grid.
2. Immediate Clear/Undo while playback and recording continue. Discard conflicting pre-edit buffered input so delayed analysis cannot restore deleted music. Undo discards current provisional input first, otherwise restores the last applied musical edit.
3. Calibration: instructions, visible three-second countdown, four practice timing clicks plus eight measured clicks, progress and Cancel. Preserve prior valid calibration on failure/cancellation. Show offset/consistency/matched taps and persist manual recording-offset adjustment per device.
4. Dark monochrome DAW workspace: persistent transport at top, track controls left, selected editor center, compact sound/input inspector right. Remove workspace tabs. Keep drums as step lanes; synths use a piano roll with keyboard/pitch axis, four-bar timeline, sixteenth grid, playhead, note creation/deletion, move/resize. Empty rolls center on C4; existing rolls center on notes. Session operations live in a compact menu.
5. Reproduce melody/loading failure on the tested device. Add live detected pitch and provisional-note feedback, distinguish absent input/confidence/queued/rejected states, and show actionable asset/worker/engine errors. Validate singing/humming separately from ordinary speech.

## Active assignments and dependency order

### WS1 — engine, contracts and integration

Own the next-beat scheduler, one-bar stopped count-in, immediate Clear/Undo, and atomic capture invalidation. Publish the contract/examples/schemas and regression tests first. Keep provisional placement aligned to the composition loop origin even when recording begins mid-loop. Coordinate WS2's capture-buffer reset with exact authoritative audio-frame feedback. Existing speech-transport proposals must remain separate from these recording changes. Keep the full hands-free objective; do not mark complete at a manual demo.

### WS2 — input and workspace

Start independent calibration UX, dark persistent workspace/piano roll and Lenny-device failure reproduction now. Own input capture, calibration, pitch/onset diagnostics, buffering and UI. Do not change shared scheduling semantics independently; integrate WS1's published contract commit before wiring next-beat/live-edit behavior. Coordinate entrypoint wiring with WS1; WS1 will not concurrently rewrite the UI. Diagnose late capture/compensation/quantization using a repeatable tap test, then add regression tests for reproduced causes. Do not broadly lower thresholds without evidence.

### WS3 — local service and research

Help capture/reproduce the synth error on Lenny's device. Keep work inside services/agent and owned handoff notes. Adopt WS1's merged scheduling/edit contracts in the parser/proposal queue and tests. Propose speech transport with WS2 capture requirements before relying on new message types. No API/key setup or provider assumption. Deep Agents remains required; the deterministic parser is an interim implementation. Independently evaluate search quality on fixed prompts using one reproducible shared blind-listening kit; preserve the integrated original music loader and preview UI.

### Integration order

1. This priority/status publication and GitHub coordination notice.
2. WS1 contract/engine capability PR; WS2 independent UX/reproduction and WS3 independent diagnosis/research in parallel.
3. WS2/WS3 integrate the exact approved contract commit and open capability-sized PRs to engine-integration. Include base SHA, behavior, tests, limitations, dependency and next owner.
4. WS1 reviews/merges; all owners test the combined recording workflow on Lenny's device and their own laptops.
5. Complete speech/Deep Agents only after the necessary provider decision/contracts, then run the full PLAN.md acceptance session. Do not push implementation to main before integrated review/signoff.

## Evidence required for this usability pass

- Calibration is predictable, cancellable, and leaves prior settings intact on failure.
- Measured wired-headphone tap patterns land on intended cells after calibration/offset adjustment.
- Record starts within one beat during playback and after four count-in beats from stopped.
- Clear/Undo work immediately during capture without stopping playback or resurrecting old events.
- Hummed/sung notes appear with diagnosis visible; correcting a phrase preserves other notes.
- Presets audition or report a specific loading failure. The main workflow requires no tabs.
- Human results include commit, OS/browser, input/output devices, calibration values, observed failures and exact errors. Raw microphone recordings remain opt-in and uncommitted.
- Ten-minute audible playback, speech acknowledgments, blind listening and full hands-free cross-platform acceptance remain separate outstanding gates.

## Recording contract ready for review (not merged)

WS1 capability is on `ws1/recording-usability` at `bd1428b`. Review: https://github.com/JettHiggins/VoiceSynthesizer/compare/engine-integration...ws1/recording-usability. Read docs/RECORDING-USABILITY.md on that branch. It includes next-beat starts, four-beat stopped count-in, immediate Clear/Undo, reset-before-ack recordingEpoch/captureStartFrame feedback, optional epoch-tagged batches and a fixed composition grid origin for mid-loop capture. Armed Record checks revision on receipt, then pins its target/deadline through unrelated edits. Other queued musical commands retain application-time revision checks.

Local shared checks, complete Node suite, real Python/WebSocket/WASM integration, 99 base backend tests and production build pass. Human/device acceptance and consumer UI wiring remain open. Repository settings prohibit Actions from creating PRs; the workflow posted the review link in issue #9. A collaborator must open the PR or explicitly enable authenticated PR creation. No PR review/merge is claimed.

WS2 PR #7 has real-device evidence (browser estimate ~62 ms versus ~120 ms measured), diagnostics and device-selection work worth preserving. On integration remove its automatic re-issue of an already armed Record; the new engine preserves that original count-in. Update calibration from 2 warm-up/10 measured clicks to the approved preparation + 4 practice/8 measured flow. Integrate epoch/cutoff reset and provisional Undo per the capability handoff. WS2 PR #8 documents speech capture requirements; speech transport is still a separate proposal.
