# Current team status — musical control and hands-free completion

Read AGENTS.md, PLAN.md, HANDSFREE-COMPLETION.md, your WORKSTREAM file and coordination issue #9 at startup/capability/PR checkpoints. Preserve work and secrets. Laptop sessions must read GitHub themselves; notifications do not update their conversations.

## Human result and new priority

Jett finished the `playtest-repair-1` session: creation went much better. Remaining reported issues: neighboring sung pitches vary; presets change late; hands-free sound requests, timeline edits and calibration/tuning fail; language processing sometimes starts before the sentence ends; voice stop-recording did not work. Exact phrases/transcripts and pitch-snap scope have been requested. Do not mark all prior physical checks passed from this qualitative report.

The freeze is over for development. Keep tag playtest-repair-1 immutable. New scope/acceptance is HANDSFREE-COMPLETION.md. Research #29/#31 is no longer deferred; review/adopt it without dropping the latest repair fixes. No new API key setup is required; existing OpenRouter/free-model and local faster-whisper decisions persist, with credentials backend-local.

## Assignments / dependencies

| Stream | Next task | Dependency |
| --- | --- | --- |
| WS1 / Jett | Publish key-snap / immediate-patch / browser-action contracts and fixtures, implement engine behavior, review #29/#31 and integrate/test the full hands-free path. | Independent now; consumers use only published contracts. |
| WS2 / Leo | Reproduce immediate-preset and sung-pitch UX; key controls/preview + explicit existing-track action; browser calibration/profile action executor and progress/cancel; then mic test. | Wait for new key/browser-action publication before wire use. Existing UI/input reproduction can start now. |
| WS3 / Lenny | Reproduce/fix premature endpointing and voice stop first; then bounded timeline/key/calibration intent/tools, real sound research rollout in #29 and cooperation with #31. | Speech/stop reproduction is independent now. Key/browser-action commands await publication; research contracts already exist. |

Concrete source findings: UI PatchEditQueue and engine currently enforce next-loop patches, explaining preset delay. Repair freeze intentionally excluded voice research #29/#31; that gap now needs completion. Parser already recognizes Groove stop/stop recording, but acoustic failure remains open. Current segmenter has a four-second cap and a short hangover: investigate rather than treating fragments as final intentions.

## Baseline / evidence

Use origin/engine-integration, not documentation-only main or old unmerged feature heads. Frozen test source f3eb3d9 included reviewed #38/#39 engine, #36 input/UI, #34/#37 commands, #33/#35 speech repairs and #32 timing diagnostics. Final checks at that freeze: Node 193 passed/one optional skip; backend 356 passed/six optional skips; schemas/build/service-WASM and actual synthetic-signal Chromium UI flows passed. CI covered Linux parity/web and Windows/macOS integration. This is historical foundation evidence, not proof of the new requests or full hands-free acceptance.

Small owner branches/PRs, merged by WS1. Shared changes require examples/tests before consumers; do not mutate engine timing from model callbacks. Keep raw mic audio/models/secrets out of Git. Publish a new frozen combined test only after software checks and then obtain real whole-sentence/hands-free/fun evidence. Preserve the complete roadmap in PLAN.md.
