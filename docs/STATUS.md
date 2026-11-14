# Current team status — musical control and hands-free completion

Read AGENTS.md, PLAN.md, HANDSFREE-COMPLETION.md, your WORKSTREAM file and coordination issue #9 at startup/capability/PR checkpoints. Preserve work and secrets. Laptop sessions must read GitHub themselves; notifications do not update their conversations.

## Human result and new priority

Jett finished the `playtest-repair-1` session: creation went much better. Remaining reported issues: neighboring sung pitches vary; presets change late; hands-free sound requests, timeline edits and calibration/tuning fail; language processing sometimes starts before the sentence ends; voice stop-recording did not work. Exact phrases/transcripts and pitch-snap scope have been requested. Do not mark all prior physical checks passed from this qualitative report.

The freeze is over for development. Keep tag playtest-repair-1 immutable. New scope/acceptance is HANDSFREE-COMPLETION.md. Research #29/#31 is no longer deferred; review/adopt it without dropping the latest repair fixes. No new API key setup is required; existing OpenRouter/free-model and local faster-whisper decisions persist, with credentials backend-local.

## Assignments / dependencies

| Stream | Next task | Dependency |
| --- | --- | --- |
| WS1 / Jett | Immediate-patch contract is published; engine capability 25a6388 is ready for review. Key/browser-action contracts and fixtures are now published; Key engine a2278a3 is ready for review; Browser-action routing fb68594 is ready for review; next review #29/#31 and integrate the full hands-free path. | Independent now; consumers use only published contracts. |
| WS2 / Leo | Reproduce immediate-preset and sung-pitch UX; key controls/preview + explicit existing-track action; browser calibration/profile action executor and progress/cancel; then mic test. | Immediate-patch contract is ready in MUSICAL-CONTROL-CONTRACT.md; adopt against ws1/immediate-patches 25a6388. Key/browser-action interfaces are published in MUSICAL-CONTROL-CONTRACT.md; implement executor via BrowserActionAdapter. Root owns coordinator/main routing. |
| WS3 / Lenny | Reproduce/fix premature endpointing and voice stop first; then bounded timeline/key/calibration intent/tools, real sound research rollout in #29 and cooperation with #31. | Speech/stop reproduction is independent now. Key/browser-action interfaces are published; producers enable only with actual browser-status/engine support. Research contracts already exist. |

Concrete source findings: UI PatchEditQueue and engine currently enforce next-loop patches, explaining preset delay. Repair freeze intentionally excluded voice research #29/#31; that gap now needs completion. Parser already recognizes Groove stop/stop recording, but acoustic failure remains open. Current segmenter has a four-second cap and a short hangover: investigate rather than treating fragments as final intentions.

## Baseline / evidence

Use origin/engine-integration, not documentation-only main or old unmerged feature heads. Frozen test source f3eb3d9 included reviewed #38/#39 engine, #36 input/UI, #34/#37 commands, #33/#35 speech repairs and #32 timing diagnostics. Final checks at that freeze: Node 193 passed/one optional skip; backend 356 passed/six optional skips; schemas/build/service-WASM and actual synthetic-signal Chromium UI flows passed. CI covered Linux parity/web and Windows/macOS integration. This is historical foundation evidence, not proof of the new requests or full hands-free acceptance.

Small owner branches/PRs, merged by WS1. Shared changes require examples/tests before consumers; do not mutate engine timing from model callbacks. Keep raw mic audio/models/secrets out of Git. Publish a new frozen combined test only after software checks and then obtain real whole-sentence/hands-free/fun evidence. Preserve the complete roadmap in PLAN.md.

## First new capability

Published contract: f5dbbdb, MUSICAL-CONTROL-CONTRACT.md. Engine branch `ws1/immediate-patches` **25a6388** allows immediate smoothed patches while preserving explicit next-loop callers. Six focused tests, full Node 196 passed/one optional skip, shared checks/build/service-WASM passed. Handoff: docs/IMMEDIATE-PATCHES.md on that branch. Peer-create/review its focused PR; WS2 switches PatchEditQueue/feedback to immediate and WS3 switches patch acceptance boundaries. Current shared UI still waits for the loop, so the human preset-delay report is not yet closed. Key/browser-action interfaces remain the next WS1 task.

## Key and browser-action contract publication

Integrated schema/helper/fixtures source 4f7c9ea: optional SessionState.pitchSnap (missing/null Off), immediate set-pitch-snap, explicit next-loop snap-notes, shared snapMidiToScale, browser-status/browser-action/browser-action-ack and BrowserActionAdapter seam. Details: MUSICAL-CONTROL-CONTRACT.md; examples: fixtures/MusicalControls.json. Node 196 passed/one optional skip, shared TypeScript/Python schema checks and 69 focused backend app/connection/language tests passed. These are contract/helper checks, not engine/executor completion. WS1 key engine is ready separately at a2278a3; unsupported operations still reject on the shared branch until reviewed integration. WS2/WS3 can implement exact consumers/producers without inventing interfaces. Restart matching browser/service schemas after pulling.

## Key engine ready for review

`ws1/key-snapping` **a2278a3** implements current-at-commit scale snapping and explicit undoable next-loop existing-track snap, with Off/old-save compatibility and no-op revision preservation. Five focused real-WASM tests passed, including real recorder stale retry after a queued raw note's key changes; full Node 201 passed/one optional skip, shared checks/build/service-WASM passed. Handoff: docs/KEY-SNAPPING.md on that branch. Please peer-create/review the engine PR; WS2 can implement the visible key controls/preview using the published helper and WS3 can implement commands. This is not yet visible/integrated completion. WS1 next owns coordinator/main browser-action routing and #29/#31 review.

## Browser routing ready for review

`ws1/browser-action-routing` **fb68594** adds the published adapter bridge in coordinator/main. Seven routing/lifecycle tests pass; full Node 203 passed/one optional skip, shared checks/build and provider-disabled service/WASM regression pass. Handoff: docs/BROWSER-ACTION-ROUTING.md on that branch. It routes only browser actions to the actual executor, forwards only emitted outcomes, guards clocks/status/IDs/reconnects and does not pretend calibration is implemented. Main attaches when VoiceInput supplies all four BrowserActionAdapter methods. WS2 must not dispatch the same action again from handleServerMessage. Guard rejections echo requested context; only browser-status updates authoritative input configuration. Backend IDs must be fresh across reconnects. The live WS2 executor and WS3 producer remain pending, and tests use a scripted adapter rather than real calibration. Next WS1 task: review/combine sound research #29/#31 without losing current repairs.
