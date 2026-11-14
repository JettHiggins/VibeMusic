# Combined speech validation — 2026-11-14

Validation branch: ws3/combined-speech-check. It combines WS3 PRs #24 (compound commands), #25 (timed wake alignment), #26 (Deep Agents), and WS1 browser speech head bdb4ffc. This is a feature validation branch, not reviewed engine-integration. Individual reviews and WS1 integration remain required.

The merge resolution preserves all README sections and all test cases. In Connection._speech_utterance, use the aligned job.context_start_frame for take context, then split commands in spoken order with one shared measured exclusion span and distinct IDs. Keep pending Record/count-in context for a later Stop. Language inference still runs asynchronously; a later Stop invalidates an earlier delayed model proposal. Two additional scripted cross-capability regressions cover these combinations.

Checks on this combined branch:

- Backend including opt-in real faster-whisper: 236 passed, four optional research skips.
- Shared schema/checks, Node 162 passed/one optional integration skip, production build passed.
- Actual headless Chromium capture/worklet/PCM/YIN/socket/WASM with local faster-whisper base.en CPU/int8, four threads. Generated speech used Microsoft Zira Desktop on Windows, trimmed to audible samples; no human audio, no cloud API/key, no scripted transcripts/spans/coverage in these browser runs. The unchanged WS1 scripts mention eSpeak in their return labels, but these fixtures were Zira, not eSpeak.

| Browser scenario | Actual result |
| --- | --- |
| local-stt-melody.js at /?testStopAt=8: half-second pause | Notes [[19,3,60],[23,3,64],[27,4,67]] exactly matched expected starts/durations/pitches. Three committed, recording false, playback true, exclusion/stop/coverage indices [34,35,36], no page errors. |
| Same short-pause script/audio/frontend against an isolated approved old backend at 72a43af | Expected failure: zero committed, 14 dropped, playback true, recording false, no pipeline errors. Whole-segment span [287174,401833] erased the notes. This comparison isolates the backend fix from the speech-fixture choice. |
| Long-pause melody (default stop at 10 s) | Notes [[25,3,60],[29,3,64],[33,4,67]] exactly matched expected. Three committed, recording false, playback true; exclusion/stop/coverage [53,54,55]. |
| local-stt-loop.js: generated kicks plus spoken Record kick / Groove stop | Steps [28,32,36] exactly matched expected. Three committed, recording false, playback true; exclusion/stop/coverage [46,47,48], command audio excluded. |

Absolute grid steps vary with the engine origin; each script compares actual steps to its independently derived expected positions. Tests used isolated headless browser processes and backend ports 8767/8768, Vite 4179. This establishes a synthetic integrated before/after improvement; WS1 should still reproduce with its original eSpeak fixture. It does not establish human latency/recognition, the original physical module/chord loading report, ten-minute audible playback, blind listening or live-model quality. Generated fixtures, caches, temporary baseline and isolated environments stay ignored.
