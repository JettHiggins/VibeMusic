# Current project status

Use origin/engine-integration for the shared app; main is the older documentation baseline. Development is unfrozen. Old playtest tags are historical comparisons. Read this ledger and [issue9](https://github.com/JettHiggins/VoiceSynthesizer/issues/9) at startup/capability/PR checkpoints; GitHub updates are not delivered automatically to laptop agent conversations.

## Latest physical test and priorities

Hands-free was enabled when fast `duh duh — duh duh` notes appeared then mostly disappeared. Speech exclusion is a plausible cause, not proven: also distinguish verification/disconnect resets and overlapping-note replacement. Continued rate limits make deterministic commands valuable. Entry on the downbeat and rhythmic placement remain difficult; current capture already rounds starts/ends to sixteenths.

Jett confirmed the friend's $10 credits are **Google Cloud credits**. Target a credit-backed Cloud project/Vertex AI configuration, not an assumed AI Studio key. Adapter/project/authentication and credit eligibility remain to verify; no Google live calls have been made. See [current round](MELODY-RETENTION-ROUND.md) and [provider setup](TEAM-API-SETUP.md).

## Current assignments

| Stream | Scope | Next deliverable |
| --- | --- | --- |
| WS1 / Jett | Input internals under AGENTS override; engine/contracts/build/CI/integration | Trace live -> queued -> excluded/reset/committed notes in manual versus speech mode. Publish compatible rhythm-snap/next-bar proposal and tests before consumers use new fields. Review/integrate owner fixes. |
| WS2 / Leo | UI/presentation/persistence | Clear bar/beat/count-in preparation and truthful live/pending/committed feedback using existing state now; compact snap/start controls after approved contract. Preserve range navigation and live edits. |
| WS3 / Lenny | services/agent, speech/language/research | Protect musical syllables from false-wake exclusion/model requests; add Google Cloud/Vertex behind existing bounded Deep Agents validation. Offline provider/429/timeout coverage can start without credentials. |

Current copyable goals are WORKSTREAM-1.md, WORKSTREAM-2.md and WORKSTREAM-3.md. No stream needs to wait for credentials to perform its independent work. New timing interfaces require WS1 publication first.

## Integrated capabilities

- Real pinned SLOOP browser WASM; empty projects, drum grid, editable piano roll, persistence, immediate presets, metronome, short count-in/next-beat recording and live erase/Clear/Undo.
- Calibrated onset/YIN capture, quiet/held/fast-note improvements, noise-floor outlier/unstable-sample handling, optional key/scale snap and explicit Snap/Undo.
- Live growing view-only notes, low/high range follow, manual navigation/edge markers and distinct provisional/submitted state. Mic-enabled monochrome laptop layout is bounded.
- Local faster-whisper speech, exact commands, browser input actions, OpenRouter Deep Agents with bounded validated proposals/shared cooldown, real CLAP/SLOOP research and voice preview lifecycle when configured. Research requires model/corpus setup; it is not available merely because schemas exist.
- Both previously published streams are integrated: WS2 through466d669 (PR44), WS3 through edb758f including eda96f2 (PR43). Restart app AND service after pulling.

## Verified baseline and limits

Runtime baseline c357dc8: **274 Node passed/1 optional skip**, **445 backend passed/6 optional skips**, shared type/schema/build and real Python WebSocket/WASM integration passed. All four cross-platform/firmware CI jobs passed (run43673203319). Subsequent81a49c4 only published the latest work plan; this is historical baseline evidence, not a claim about future edits.

Synthetic browser checks cover fast/held/loop-crossing notes, live edits, low/high preview/navigation and overflow at1280x720,1366x768,1440x900. They do not prove physical singing quality. The current false-wake diagnostic in tests/diagnostics/melody-speech-protection.py produces3 proposed guard failures and2 passing controls with scripted transcripts; this is an unresolved regression target, not the user's actual ASR transcript.

Remaining limits:

- Physical melody consistency, disappearing notes, microphone/noise/gain behavior and musical timing/fun remain unaccepted.
- Speech endpointing can execute a valid prefix before a later continuation. Early stop needs roughly0.25s dip; long open requests refuse with short-request guidance. Full natural-language browser-action tools remain unfinished.
- Full acoustic sound search -> preview -> accept/Undo is intermittent. Peer Windows synthetic tests reported4/5 passes; root real-STT/CLAP browser probes reached candidates/audition but failed capture/socket guards before acceptance. Resource pressure was observed, not established as the sole cause. Do not relax safety guards or claim the failure fixed.
- Gemini/Vertex is not implemented/configured yet; switching providers does not solve speech exclusion or guarantee quota.
- Human sound/listening quality, full hands-free acceptance and ten-minute audible playback on target laptops remain open.

## Next physical test

After reviewed retention/timing/provider fixes and combined software checks, use [MIC-TESTING](MIC-TESTING.md). Include the fast repeated phrase with hands-free off/on, held/quiet/fast notes on all synths, loop crossing, live erase/Undo/Clear, explicit rhythmic placement, whole spoken sound request with real candidates/audition/accept/Undo, and Groove stop preserving playback. Record exact commit, OS/browser/device/profile, sanitized transcript/error and timing. Raw audio remains opt-in and outside Git.
