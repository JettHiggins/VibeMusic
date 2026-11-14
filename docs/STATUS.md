# Current team status

WS1 owns this ledger. Read PLAN.md, this file and [coordination issue #9](https://github.com/JettHiggins/VoiceSynthesizer/issues/9) at startup/capability/PR checkpoints. Preserve local work and start from reviewed origin/engine-integration. Independent laptop sessions must read updates themselves; mentions do not update their conversations.

## Current decisions and delivery — 2026-11-14

- Local faster-whisper stays selected for STT. OpenRouter, **free models only**, is selected for language inference. No paid fallback. Keys remain backend-local, never in Git, browser/VITE variables, logs or agent conversations.
- WS1 reviewed/integrated #24 multi-command speech, #25 measured wake alignment, #26 actual LangChain Deep Agents and #27 browser PCM/coverage/recovery. Their previous implementation/review blockers are resolved. Main remains documentation-only at c198257; use engine-integration for the product.
- One live OpenRouter smoke test with the user's locally configured key proposed tempo 110 correctly at next-loop, in 4547 ms using inclusionai/ling-3.2-flash:free. This verifies one provider/tool path, not model quality, p95 latency or a complete hands-free session. Familiar parser commands still bypass LLM latency. Candidate model is configurable and unranked.
- Setup: services/agent/.env.example and docs/TEAM-API-SETUP.md. The backend now loads only its ignored services/agent/.env; process variables take precedence. Each teammate gets a distinct revocable key through encrypted secret sharing. Never paste keys into GitHub/chat.

## Owners and immediate work

| Owner | Delivered | Next action |
| --- | --- | --- |
| WS1 — Jett / @JettHiggins | Engine/contracts/build/integration, recording usability, temporary browser speech wiring; #24–#27 reviewed and combined. | Review/publish voice research visibility and non-mutating audition contracts, coordinate consumers/producers, then full hands-free acceptance. Prune only old integrated branch tips; preserve current work. |
| WS2 — Leo / @leoAndrade2332 | Dark workspace/piano roll, calibration/diagnostics, live recording consumer and worker-load diagnostics. | Physical late-hit/melody-loading reproduction and near-grid pitch timing. Do not duplicate integrated speech wiring. Availability is not assumed from prior usage limits. |
| WS3 — Lenny / @lennyyanza | Local speech, alignment/compound commands, free-only Deep Agents, renderer/CLAP research. | Voice research proposal awaits WS1 contract work; then implement approved producers/tools. Continue live provider/corpus evaluation after WS4 corpus delivery. |
| WS4 — fourth teammate | #17–#19 evaluation tickets published; no delivered PR observed at this checkpoint. | #17 frozen command corpus, then #18 listening summarizer, then #19 held-out sound/refinement rubric. Own evals/, tools/evaluation/, docs/WS4-HANDOFF.md. |

## Reviewed integration and validation

Earlier foundations and deliveries #1/#2/#4–#8/#10–#16/#20–#23 remain integrated. Next-beat recording, stopped four-beat count-in, immediate Clear/Undo, pending/held-note discard and epoch/cutoff protection are shared. Old branches are history, not separate installations. Current #24–#27 source tips are 8c56f3d / 90a8cb6 / bc02a8e / bdb4ffc. WS1 resolved overlapping imports/tests and preserved aligned capture-time context plus ordered command splitting; two cross-capability regressions were adopted from WS3's combined validation.

Fresh declared dev+speech+LLM environment: uv pip check clean; backend **234 passed / six optional skips**; Node **162 passed / one optional skip**, schemas, explicit live-service/WebSocket/WASM integration and production build passed. Deep Agents graph and SDK tests use scripted/mock responses; the single live smoke test is separately identified above.

WS1 independently reran the original eSpeak/harmonic fixtures through actual Chromium capture/PCM/YIN/socket/WASM + real faster-whisper base.en CPU/int8:

- Half-second melody/Stop pause: all three notes preserved; repeat exact notes [[28,3,60],[32,3,64],[36,4,67]]. Exclusion -> Stop -> coverage; playback continued. Original all-note deletion is resolved in this synthetic scenario.
- First short-pause run preserved notes but failed strict grid timing: actual [[16,3,60],[19,4,64],[23,5,67]], expected [[16,3,60],[20,3,64],[24,4,67]]. Intermittent near-grid timing remains open; no assertion was weakened and this is not a full timing pass.
- Long pause: exact [[27,3,60],[31,3,64],[35,4,67]]. Drums: exact steps [29,33,37]. Both stopped recording and kept playback. Positions vary with actual origin; scripts derive expected values.

WS3 independently reported the same old-backend failure/new-backend preservation with synthetic Microsoft Zira fixtures on ws3/combined-speech-check bbae132. Both sets are synthetic, not human recognition/audio-quality acceptance. CI on prior shared/browser delivery and individual #24–#26 was green; the newly merged head has local checks above and must receive its own CI result. Do not claim pending remote checks passed.

## Remaining product gaps / completion gates

1. **Voice research visibility and audition:** WS3's ws3/voice-research-proposal identifies that voice-started jobs do not populate the current browser panel and voice audition has no non-mutating operation. WS1 must approve/publish shared schemas, then browser adoption/preview and backend producers/tools must land together. Model/provider availability alone does not close milestone 4. Manual candidate preview remains available.
2. **Human performance:** calibrated kick/snare/hats, sung melody and phrase correction. User's drum mic worked on Lenny's device but hits were late. Leo measured ~120 ms round trip versus ~62 ms browser estimate on his setup; not a performer pass on Lenny's device.
3. **Original loading failure:** exact TypeScript/chord/module error remains unconfirmed; diagnostics now preserve worker URL/line. Reproduce with OS/browser/device/commit, audition/pitch status and exact error. See docs/MIC-TESTING.md.
4. **Model evaluation:** frozen WS4 corpus, actual free-provider correctness/refusal/latency comparison. One correct 4.55 s smoke test does not establish the two-second ordinary-command target; parser path is independent.
5. **Human sound evaluation:** one fingerprinted blind kit, three listeners, comparison against preset-only picking. Rank/score improvements are not listening evidence.
6. **Full acceptance:** hands-free drums/melody/correction/sound description/refinement/audition/accept/Clear/Undo/Stop; ten-minute audible playback and timing targets on actual target devices. CI supports, not replaces, human acceptance.

## Issue #3 answers remain in force

(a) Existing research wire shape stays until the focused voice research proposal is approved. (b) Audition is non-mutating; accept changes the patch, Undo restores it. (c) Armed Record keeps its deadline through unrelated edits; no replay of discarded capture/Clear. (d) Recognized Groove speech is excluded even on interpretation failure, before coverage. (e) Stop-recording cancels armed/count-in Record and keeps playback without consuming a musical revision.

Handoffs include commit/PR, behavior, validation, limitations and next step. Never commit secrets, raw microphone recordings, model downloads or generated corpora.
