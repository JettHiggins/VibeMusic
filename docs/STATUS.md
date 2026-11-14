# Current team status — frozen repair test

**Ready for Jett's human test: tag `playtest-repair-1`.** Exact commit is in coordination issue #9 and the test handoff. Read [FROZEN-PLAYTEST.md](FROZEN-PLAYTEST.md) for checkout/startup/test steps. WS1 pauses the goal for this test at Jett's request. Human acceptance is **pending**, not passed.

## Shared build and scope

`engine-integration` now combines reviewed count-in/metronome/empty-startup #38, targeted engine erasure #39, microphone/UI #36, deterministic target/metronome/erase #34/#37, noisy-room speech coverage/spans #33/#35 and timing diagnostics #32. Leo reviewed the exact WS1 engine heads d856621 and ab9342b in #38/#39 with no blocker. WS1 resolved their combined engine merge, enabled the reviewed erasure UI seam and rebuilt matching WASM. `main` remains documentation-only; it is not the app integration branch.

The build starts empty/stopped. Record starts after four beats from stopped or on the next beat while playing. Playback/recording metronome defaults on and can be muted. Mouse/voice targeted erasure removes one lane hit or whole occupied melody note, fences old input without a global epoch reset, preserves unrelated captured music and retains a surviving queued batch's command ID. No stale erasure replay. Invalid/conflicting targets/positions refuse. Noisy room requests browser suppression, calibration excludes confident foreground pitch, and input feedback distinguishes insufficient quiet, foreground margin, pitch and speech verification. These features still require physical testing.

## Evidence

Final integrated source: **193 Node tests passed/one optional skip; 356 backend tests passed/six optional skips**. Shared TypeScript/Python schema checks, frontend build and provider-disabled local Python-WebSocket-coordinator-WASM integration passed. Matching WASM rebuilt from pinned upstream bac9c05ea7627449405aa10e48da21d75b6c8c56, including `vs_erase_note`.

Actual Chromium UI/AudioWorklet/WASM passed empty startup, fresh/stopped Record with displayed audio-frame deadlines, metronome button mute, drum mouse erase and piano-roll Delete, preserving other music/playback/capture. Real recorder-to-WASM tests preserve the survivor's command ID and reject delayed matching input. Voice-operation integration uses typed transcripts and verifies metronome revision independence and active-take targeting after selection changes. Both #38/#39 CI runs passed web/contracts, firmware parity and Windows/macOS integration.

Synthetic signals, seeded events, typed transcripts and CI do **not** establish acoustic latency, background conversation rejection, real singing on every synth or fun. The firmware reset-counter defect was reproduced after play/stop; do not claim the exact original first-press laptop cause fully established.

## Assignments during the freeze

| Stream | Next action |
| --- | --- |
| WS1 / Jett | Hand off the fixed tag/commit, pause the goal and collect the real microphone/fun result before further repair edits or completion. |
| WS2 / Leo | Preserve existing work; help run/report physical input, timing, profile and individual-erasure checks on the frozen build. No code changes during the session. |
| WS3 / Lenny | Preserve existing work; help run/report local speech, target transitions, coverage and voice correction on the frozen build. #34/#37 are integrated, not waiting on source changes. |

Use PLAYTEST-REPAIR-RESULTS.md. Test normal-volume synth orders 1→2→3 and 3→1→2, quiet then with conversation, individual committed/provisional corrections, stale/ambiguous commands and ten minutes building a groove without code changes. Copy numeric diagnostics and exact commit/OS/browser/profile/calibration; raw microphone audio stays unrecorded by default. If a take fails, record pitch/provisional/verification/target/commit feedback rather than only increasing gain. Jett decides timing, usability and fun acceptance. Resume WS1 with the results.

## Preserved roadmap

Keep research #29/#31 deferred and preserved. No new API setup is needed for repair commands; existing backend-local credentials stay private and unchanged. All-device acceptance, original module-load reproduction, blind listening and complete hands-free sound design remain larger unfinished gates in PLAN.md. Passing this repair test does not finish the entire project. Other sessions read issue #9/this ledger at their next checkpoint; GitHub mentions do not update agent conversations automatically.
