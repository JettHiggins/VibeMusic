# Team restart: playtest repair supersedes feature work

@leoAndrade2332 @lennyyanza — Jett's latest human playtest found infinite apparent stopped-record count-in, difficult timing/individual correction, noisy-room singing failure reaching no notes on synth 3, and unwanted demo startup. Approved priority: docs/PLAYTEST-REPAIR.md; current goals: docs/WORKSTREAM-1.md, WORKSTREAM-2.md, WORKSTREAM-3.md; docs/STATUS.md is authoritative.

- WS1 publishes metronome/targeted-erasure/countdown interfaces first, then engine deadlines/click/erase/empty startup and integration. These new interfaces are NOT published by this planning commit; no competing wire shapes.
- Leo: reproduce noise/timing now, implement aggressive Noisy room capture plus Music alternative and per-profile calibration; diagnose pitch vs verification/target failures; wire erasure/metronome/countdown after contract publication.
- Lenny: reproduce noisy speech/coverage/target continuity now; implement deterministic spoken erasure/metronome after publication; review independent offline-test guard.

Fresh launch empty, metronome ON during playback/recording with mute, mouse+voice erasure, aggressive cleanup accepting artifacts are Jett's selected defaults. Save current work and start fresh repair branches from reviewed engine-integration. Preserve/defer sound-search PRs #29/#31; do not add features during this pass. #30 isolation and #32 diagnostics can support repair after review. Keep secrets/audio/models out of Git. No new API setup needed. Human frozen-commit microphone/fun test is required; synthetic checks do not override the failed session. Independent agents must read this update themselves.
