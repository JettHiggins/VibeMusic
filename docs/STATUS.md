# Current team status — voice reliability and UI cleanup

Read PLAN.md, AGENTS.md, VOICE-RELIABILITY-ROUND.md, your WORKSTREAM file and coordination issue #9. Fetch current origin/engine-integration at startup/capability/PR checkpoints and preserve local work. Independent laptops do not receive live conversation instructions automatically.

## Latest human result

The musical-controls interim test is complete. Jett reports intermittent hands-free success, provider quota/rate-limit errors, unsupported browser-status, unreliable humming/fast-note capture, short held notes in both piano roll and sound, and overflowing/cluttered mic-enabled UI. Clarification: key snapping's chosen pitches were reasonable; fast notes were missed. Suspected over-high silence floor is a hypothesis. Full hands-free/fun acceptance remains open.

Jett added a top product priority: spoken instrument requests have never fetched a sound or visibly launched research. WS3 must trace and fix the real speech-to-search path now; typed research success from prior integration does not close this failure. Supported descriptions should route to real local research without needing LLM quota. WS1 will verify integrated patch/preview behavior and WS2 keeps real progress/failures visible.

## Current assignments — start all three independently

| Stream | Owns this round | Next deliverable |
| --- | --- | --- |
| WS1 / Jett | Melody DSP/calibration/segmentation/recording internals, duration/render tracing, Vochlea behavior study, integration/contracts. Temporary input-file ownership is in AGENTS.md / VOICE-RELIABILITY-ROUND.md. | Focused hum/fast-note/held-duration fix and measured regression evidence; integrate peer work. |
| WS2 / Leo | UI/layout/theme/presentation only this round, using existing input methods/state. | No mic-enabled page overflow; simpler essential controls and optional advanced details, tested at laptop sizes. |
| WS3 / Lenny | Backend protocol, provider resilience, whole-sentence speech/stop and bounded tools. | Spoken instrument requests launch real research/progress/results and preview/accept/Undo; fix protocol/provider failures along that path, then speech regressions. |

Branches: ws1/melody-reliability, ws2/mic-workspace-cleanup, ws3/speech-resilience. Start from current origin/engine-integration, never the immutable test tags or documentation-only main. Preserve uncommitted work and existing feature branches. Existing contracts/engine/browser executor are integrated; no new contract, key or provider choice is required to begin. For the first round, keep wire/public input interfaces compatible. Each stream has independent follow-ups; a shared optional extension is not a reason to stop useful work. Runtime goal limits still apply.

Current source evidence: Connection.handle lacks browser-status and browser-action-ack branches despite valid ClientMessage schemas; it emits unsupported-message errors. This is a real current-source gap, though a stale laptop service may also be involved. Language errors currently combine 402/429 into the displayed quota/rate message; resilient cooldown/degraded behavior is pending. Pitch segmentation uses a noise-floor-relative gate and fixed onset/deviation/release rules; the actual cause of missed/short notes remains to be traced.

## Already integrated foundation

Real SLOOP groovebox, empty startup, drum grid/piano roll, persistence, short count-in/next-beat recording, immediate erase/Clear/Undo, local speech/OpenRouter infrastructure, real CLAP/SLOOP research path, immediate presets, optional key/root/scale UI and explicit Snap/Undo, browser action routing and corrected input executor. PRs #40/#41 are integrated; do not wait for them or duplicate their implementation. Actual research still requires real configuration and warm matching corpus.

Application source 4566dd8 passed Linux contracts/web, real-renderer/firmware and Windows/macOS integration CI (run 43655308001). Latest executor checks were Node 246 pass/one optional skip, schema/build and actual browser capture/analysis with a synthetic source. These are foundation evidence, not proof that the new human failures are fixed. Prior details: reviews/PR40-FIXED-EXECUTOR.md, MUSICAL-CONTROLS-INTEGRATION.md, KEY-CONTROLS-INTEGRATION.md and reviews/REAL-CLAP-INTEGRATION.md.

## One-hour return check-in

See VOICE-RELIABILITY-ROUND.md for P0 tasks, file boundaries, reproducible acceptance and independent follow-ups. Push small tested PRs during the work window; each stream writes docs/handoffs/voice-reliability-wsN.md with exact commit/PR, before/after, checks, unresolved failures and physical-test limits. WS1 maintains this ledger and integrates. Do not assume free quota can be removed by code or synthetic tests establish human singing quality.

The previous test freeze is over for development. Keep playtest-musical-controls-1 / playtest-repair-1 immutable as comparison builds. The next human test snapshot follows combined checks; do not claim full-product completion or silently drop remaining Deep Agents/speech/research roadmap requirements.
