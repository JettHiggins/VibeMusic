# Current team status

WS1 maintains this ledger. Read PLAN.md, this file and [coordination issue #9](https://github.com/JettHiggins/VoiceSynthesizer/issues/9) at startup, before a capability and before a PR. Fetch at those checkpoints, preserve local work, start from reviewed origin/engine-integration and do not dependency-poll. Independent laptop agents must read GitHub updates themselves. Older HANDOFF.md and issue comments may be stale.

## Decisions — 2026-11-14

- STT: local faster-whisper, configurable model, off the event loop. Dependencies now include SciPy for actual 44.1 kHz browser resampling. No cloud speech provider is needed.
- LLM: **Jett selected OpenRouter, free models only**, superseding the deferred provider decision. The key is available to Jett but has not been installed or tested here. Deep Agents remains unfinished; the existing parser is interim.
- WS3 should implement configurable backend-only OpenRouter access and LangChain Deep Agents with typed, validated tools, bounded inference/tool steps and explicit timeout/quota errors. Preserve browser validation, capture-time wake semantics and sample-clock independence. No paid fallback. Do not place keys in browser/VITE variables, source, logs, GitHub or agent conversations.
- Initial candidate to evaluate: inclusionai/ling-3.2-flash:free (current catalog supports tools and structured outputs). This is a candidate, not a measured winner. openrouter/free is a free-only experimental alternative, but random model choice makes regression comparison less reproducible. Compare command correctness and latency against the fixed WS4 corpus before picking a demo default.
- Each teammate should receive a distinct revocable key through an encrypted secret-sharing channel. Store it only in a local ignored backend environment file or environment. The current service does not yet implement OpenRouter configuration or automatic .env loading; WS3 must deliver and document that setup. No live provider requests have been made by WS1.

Official references checked today: [free catalog and quotas](https://openrouter.ai/collections/free-models), [Ling model](https://openrouter.ai/inclusionai/ling-3.2-flash:free), [free router](https://openrouter.ai/docs/guides/routing/routers/free-router). Free :free usage currently has 20 requests/minute and 50/day on an unfunded account; additional keys do not multiply account quota.

## Owners and next actions

| Owner | Delivered / current state | Next action |
| --- | --- | --- |
| WS1 — Jett / @JettHiggins | Engine/contracts/build/integration; next-beat Record, stopped four-beat count-in, immediate Clear/Undo and epoch resets. Temporarily owns browser speech capture. | Publish reviewed integrations; obtain peer review of ws1/speech-capture at ac612d3, integrate it, then run combined hands-free/device acceptance. |
| WS2 — Leo / @leoAndrade2332 | Dark persistent workspace, editable synth piano roll, calibration/device diagnostics; #20 recording consumer and #23 worker-load diagnostics integrated. Usage availability unconfirmed; recent PR delivery observed. | Review WS1 speech branch without duplicating it; reproduce Lenny's exact melody-loading error and tune real input from device evidence. |
| WS3 — Lenny / @lennyyanza | #13 CLAP retrieval, #14 speech contract, #15 pipeline, #16 recording proposals, #21 local faster-whisper and #22 issue-3 tests integrated. | Start focused OpenRouter/Deep Agents PR from latest integration; wire safe backend config, typed tools and evaluation. Provider choice and issue #3 are no longer blockers. |
| WS4 — fourth teammate | Issues #17–#19 published; no delivered PR observed. Owns evals/, tools/evaluation/, docs/WS4-HANDOFF.md. | Start #17 command acceptance corpus, then #18 blind-listening summarizer, then #19 sound/refinement rubric. Read docs/WS4-START.md. |

## Branch / integration state

Main remains c198257, the documentation baseline, **not the product release**. Use engine-integration to run the reviewed product. Do not delete feature branches yet.

Reviewed and integrated: WS2 #4–#7/#10/#11/#20/#23; WS1 recording contract/engine #12; WS3 service/research #1/#2/#13/#14/#15/#16/#21/#22. Stacked PRs may be closed as already integrated when their former bases prevent GitHub displaying a normal merge. Source ancestry, not branch existence, establishes integration.

The latest review includes #15 c62613d (capture-time context), #21 d637213 (real STT plus optional mic self-check), #22 75f4181 (issue-3 regressions), #23 d34f10e (worker URL/line diagnostics and current mic guide). The previous delayed-Groove-stop and missing-SciPy blockers are fixed. Remaining exact device melody failure is not presumed fixed by diagnostics.

**Unmerged WS1 capability:** ws1/speech-capture at ac612d3. Contains independent browser speech tap/PCM worker, scoped coverage gates, explicit hands-free mode, bounded backlog, failed-connection isolation and explicit Retry, plus dev-worklet refresh. Request a peer-created/reviewed PR to engine-integration. Repository settings prohibit Actions PR creation; WS1 has SSH push but no separate PR-create authentication. ws1/integration-preview and ws1/dev-worklet-sync are parent review history; do not merge them separately after the speech branch. ws1/recording-consumer is integrated through #20. Other old workstream branches retain history; no new unreviewed work is implied by their existence.

## Validation and limits

Combined reviewed #15/#21/#22/#23 baseline: shared schemas/checks, full Node suite, live service/WebSocket/WASM integration and production build passed. Fresh declared dev+speech installation passed pip check and backend suite: **167 passed, 5 skipped**. An opt-in real faster-whisper test passed using synthetic espeak; no live API or human recording. The last two head updates add the optional microphone self-check and documentation only; script syntax checked. They do not establish actual microphone recognition.

The delayed-result reproduction now emits exclusion span, error/no mutation, then verification when an old take ends; it cannot turn Groove stop into playback stop or affect a newer take. Tests cover stop/new-take/count-in/late segment closure and held wake joining.

Browser speech branch evidence: real Chromium capture/worklet/worker/socket/WASM integration with scripted coverage passed, including command-span exclusion, continuing playback, unavailable and stalled-service failure/retry. Browser head ac612d3 adopts reviewed integration 6377130. Actual faster-whisper recognized synthetic Record kick / Groove stop and committed three generated hits at expected steps [21,25,29], with exclusion -> stop-recording -> verification, playback continuing and no pipeline error. This rerun used the fresh declared speech environment, including SciPy, and the current bounded-backlog/recovery client. Combined schema checks, Node suite (162 passed/one optional skip), explicit live-service/WASM integration and production build passed. The isolated test service/browser were stopped. Peer review and shared browser merge remain open. These are synthetic checks, not physical voice/device acceptance.

Recording consumer: actual browser/YIN synthetic C4/E4/G4 extraction, phrase correction, live held-note Undo/Clear and fresh epoch capture passed. CI at edd6044 passed contracts/web, firmware/research and macOS/Windows software integration. Synthetic p95 analysis was ~7–9 ms on WS1's machine; this does not establish real-device latency.

## Issue #3 answers — remain in force

(a) Keep existing research wire shape; propose additive track/description metadata separately if needed for concurrent voice jobs.
(b) Audition uses non-mutating previewUrl; accept applies a patch and Undo restores it.
(c) Armed Record keeps its original deadline through unrelated edits. Other queued musical edits retain revision checks; never replay discarded capture/Clear intentions.
(d) Recognized Groove wake speech is excluded even when interpretation fails; error with no mutation precedes classified coverage.
(e) Stop-recording cancels armed/count-in Record, keeps playback and does not consume a musical revision.

## Remaining completion gates

- Merge peer-reviewed browser speech capability; complete OpenRouter-backed **Deep Agents**, not only the interim parser.
- Physical calibrated drums, sung melody and phrase correction. User's drum mic worked on Lenny's device but hits were late with wired headphones. Leo measured ~120 ms round trip versus ~62 ms browser estimate on his setup; this is not a calibrated performer pass on Lenny's device.
- Reproduce exact TypeScript/chord/module-loading melody error with URL/console/device/commit; test preset audition as well as pitch capture. See docs/MIC-TESTING.md.
- One fingerprinted blind kit, three human listeners, comparison against preset-only retrieval. CLAP rank/score improvements do not establish listening quality.
- Full hands-free PLAN.md scenario, real command latency targets and ten-minute audible playback on target devices. Software CI is supporting evidence, not physical signoff.

Handoffs must include PR/commit, behavior, validation, limitations and next integration step. No secrets, raw microphone recordings, downloaded models or large generated corpora in Git.
