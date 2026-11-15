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

Current source evidence: protocol handlers and provider cooldown are now integrated (366f07e/4132702 from PR43), so valid browser-status/acks no longer fall through on the current service. A real browser/parser/service test completed profile/offset/noise-calibration requests with actual status and acks. Full endpointing PR43 remains unmerged: a forced-cut valid sound-request prefix still starts research before its sentence ends. Separately, default-off/unconfigured research sends a failed job with no adoptable voice context; the actual browser stays idle/error null. These are concrete current findings, not proof of the laptop's exact configuration. See reviews/PR43-SENTENCE-REVIEW.md and reviews/VOICE-INSTRUMENT-REQUEST-TRACE.md. Melody acquisition/hold/transition fixes are now integrated; contaminated calibration/physical noise remain to investigate.

## Already integrated foundation

Real SLOOP groovebox, empty startup, drum grid/piano roll, persistence, short count-in/next-beat recording, immediate erase/Clear/Undo, local speech/OpenRouter infrastructure, real CLAP/SLOOP research path, immediate presets, optional key/root/scale UI and explicit Snap/Undo, browser action routing and corrected input executor. PRs #40/#41 are integrated; do not wait for them or duplicate their implementation. Actual research still requires real configuration and warm matching corpus.

Application source 4566dd8 passed Linux contracts/web, real-renderer/firmware and Windows/macOS integration CI (run 43655308001). Latest executor checks were Node 246 pass/one optional skip, schema/build and actual browser capture/analysis with a synthetic source. These are foundation evidence, not proof that the new human failures are fixed. Prior details: reviews/PR40-FIXED-EXECUTOR.md, MUSICAL-CONTROLS-INTEGRATION.md, KEY-CONTROLS-INTEGRATION.md and reviews/REAL-CLAP-INTEGRATION.md.

## One-hour return check-in

See VOICE-RELIABILITY-ROUND.md for P0 tasks, file boundaries, reproducible acceptance and independent follow-ups. Push small tested PRs during the work window; each stream writes docs/handoffs/voice-reliability-wsN.md with exact commit/PR, before/after, checks, unresolved failures and physical-test limits. WS1 maintains this ledger and integrates. Do not assume free quota can be removed by code or synthetic tests establish human singing quality.

The previous test freeze is over for development. Keep playtest-musical-controls-1 / playtest-repair-1 immutable as comparison builds. The next human test snapshot follows combined checks; do not claim full-product completion or silently drop remaining Deep Agents/speech/research roadmap requirements.


## Current round delivery checkpoints

- **Integrated WS1 melody source e06cf85** (including ddaa515, 5b44528 and 561321f): gentle-level held notes, clear quiet acquisition, stable adjacent semitones and rolling pitch-transition history. Scale/public interfaces unchanged. Expanded capture/noise alignment and vibrato phase/rate tests caught/fixed an extra note-loss regression before integration; the native phrase-correction test passes.
- **Integrated WS2 PR #42 / 0408009**: compact mic/pitch/key summary and bounded layout. Actual Chromium three-size overflow/keyboard checks, visual review and calibration regression passed. Leo can continue independent UX/real-device follow-ups; do not duplicate merged work.
- **Integrated only WS3 protocol/provider commits 366f07e + 4132702 from PR #43**. Browser status/acks and exact key/calibration commands work with the real parser/service/executor; scripted provider failures test shared cooldown and no replay. Full endpointing head 5c0fe27 is excluded pending the concrete valid-prefix correction and browser coverage integration check. Lenny owns these plus the actual spoken instrument path; typed research/model success is insufficient.

Combination branch ws1/reliability-integration **6c213e4**, now integrated. Full Node **260 passed / one optional skip**; backend **418 passed / six optional skips**; schema/build and provider-disabled real service/WebSocket/WASM integration passed. Actual browser/Python input actions: 15 status messages, three complete acks, no unsupported errors, music preserved. Quiet four-sixteenth and full-bar capture passed with synthetic audio; actual rendered SLOOP confirms a long sustained gate versus a short gate and real note-off. Details/limits: reviews/RELIABILITY-COMBINATION.md. Physical microphone/long utterance/research listening and full hands-free acceptance remain open.

WS1 next: calibration/background and loop-crossing/every-track input checks, then integrate corrected WS3 sentence/instrument work. WS2 next: physical/interaction follow-ups and nonblocking meter aria-range correction. WS3 next: fix the valid-prefix and hidden-unavailable instrument paths, demonstrate actual configured spoken search/preview/accept/Undo, and coordinate any eight-second browser coverage versus longer backend hold requirement. No new provider/key decision is required for independent work; external free quota is not claimed fixed by code.


## Calibration and loop-crossing capability integrated

WS1 **1a0e6dd** is integrated from ws1/calibration-reliability. A reproduced 250 ms unpitched burst previously raised a quiet room's estimate toward -20 dBFS. The estimator now uses a steady majority (at least 75% within six dB of the median), ignores brief burst/digital-silence outliers, and rejects heavily unstable input while preserving prior valid calibration. A genuinely steady noisy room still measures high. Worker refusals use the existing noise-floor-unavailable path rather than timing out as a missing mic; duplicate failure punctuation/text is fixed. Public/wire interfaces and scale mapping are unchanged.

Validation: 20 focused calibration/worker tests; full Node **264 passed / one optional skip**, checks/build pass. Actual browser controlled-noise capture measured -59.835 dBFS despite a brief burst, then rejected a heavily unstable sample in ~1.6 s without replacing the valid calibration or musical state. Actual capture/YIN/recorder/WASM loop-crossing tests passed on all three synth tracks (step60/duration16 each); rendered SLOOP PCM stays held across the wrap and releases at actual note-off. These are synthetic-source/DSP tests, not physical-room/hearing acceptance. Details/scripts are in docs/handoffs/voice-reliability-ws1.md. WS3's endpointing and actual spoken instrument fixes remain open as above.
