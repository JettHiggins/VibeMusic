# Workstream 2 handoff — UI and musical input

Branch `ui-input`, based on `engine-integration` @ `ca78e57` (milestone 0 foundation `a19badd` plus the real engine, recording windows, `commit-performance`, editing and `load-session`). Owned directories: `apps/web/src/input`, `apps/web/src/ui`, `apps/web/src/persistence`.

## What this slice adds (milestone 2: first voice slice, drums)

Microphone → onset → verified performance batch → real SLOOP engine.

| Piece | File | Notes |
| --- | --- | --- |
| Capture | `input/capture-worklet.ts` | AudioWorklet on the engine's own AudioContext, so frames are the shared sample clock. Copies and timestamps 1024-frame blocks only; posts them over a MessageChannel directly to the worker. Gaps are signalled, never papered over. |
| Analysis | `input/analysis-worker.ts`, `input/onset.ts` | Worker, not audio thread. One-pole high-pass, 512-point spectral flux (log magnitude, half-wave rectified) at 128-frame hops, adaptive threshold (median + k·MAD over 250 ms), local-maximum peak picking with one hop of lookahead, energy gate above the calibrated noise floor, required energy rise (≥ 9 dB over the quietest level in the previous 50 ms, so decaying pitch sweeps never retrigger), 70 ms retrigger guard that a hit ≥ 12 dB louder may override, and sample-accurate rise refinement. |
| Calibration | `input/calibration.ts`, `persistence/calibration-store.ts` | Noise floor = 90th percentile of 23 ms RMS windows over 1.5 s of silence. Latency = median click→onset offset from an 8-click tap-along (rejects < 6 matches or spread > 25 ms). Defaults to `baseLatency + outputLatency + track latency` until calibrated. Stored per device in localStorage (numbers only, never audio). |
| Buffering/commit | `input/recorder.ts` | Provisional events, latency subtracted exactly once, integer frames, confidence < 0.6 filtered locally (the engine ignores those, so counters stay honest), command-span exclusion, verification watermark, one in-flight `commit-performance` batch, retry on stale revision/playback-stop with a new command ID after the newer snapshot, conservative cut-off at take end, final batch after stop. |
| Orchestration | `input/voice-input.ts` | Engine messages → recorder; `command-span` → exclusion; agent connection → speech availability. |
| Session files | `persistence/session-file.ts` | Versioned envelope `{format:'voicesynth-session', formatVersion:1, savedAt, name, session}` for local saves (localStorage) and JSON import/export. Also accepts a bare SessionState. Validated with the shared schema; corrupt saved entries are skipped. Its results are meant to feed `load-session` (UI controls are the next PR). |
| UI | `ui/InputPanel.tsx` | Mic enable + level meter (with noise-floor marker), silence/timing calibration, lane select, record/stop, play/stop, clear lane, undo, mute, tempo ±5, count-in/recording state, bar/beat, 64-step lane grid with provisional (dashed) and committed hits, counters and errors. |

`main.tsx` wiring is minimal (four lines) and needs integrator review since that file is Workstream 1's.

Raw microphone audio is never persisted, uploaded or sent to the backend.

## Verification modes

- **manual** (default in the UI): take started and stopped from buttons, no voice commands during takes, so there is no speech to exclude; the watermark follows analysed audio and the engine clock.
- **speech**: events commit only after the speech pipeline reports verification through a frame; recognised command spans are excluded and passed as `excludedSpans`. On disconnect, unverified events are discarded and capture stops; playback and the composition continue.

## Contract proposal needed (not used yet)

CONTRACTS.md requires `verifiedThroughFrame` to advance only when speech classification has completed, but v1 has no message carrying that watermark. `utterance`/`command-span` only describe recognised speech. Proposed additive `ServerMessage`:

```json
{ "type": "speech-verified", "clockId": "…", "throughFrame": 1234567 }
```

Meaning: every utterance that starts at or before `throughFrame` has been classified, and any wake-phrase command among them has already been sent as `command-span`. The browser takes `min(throughFrame, analysed, engine frame)`. `PerformanceRecorder.verifyThrough(clockId, frame)` is the consumer seam. Until Workstream 1 accepts this (or an alternative), hands-free (`speech`) takes cannot commit, and the UI uses manual takes.

## Checks run (Windows 11, Node 26.13.1, engine assets from CI run 43575605059 for `411ec19`)

- `npx tsc --noEmit`: clean.
- `npm test`: 66 pass, 1 skipped (Workstream 3's opt-in live-service test). This includes all of Workstream 1's real-WASM tests on Windows, plus:
  - `tests/input-onset.test.ts`: kick/snare/hat onsets within 2 ms; no double triggers (flams, decaying pitch sweeps in silence and in noise); weak transients don't mask louder hits; velocity tracks level; noise rejection; block-size invariance; p95 analysis per 1024-frame block < 50 ms; noise floor; tap-along latency, both synthetic and through the detector.
  - `tests/input-recorder.test.ts`: latency compensation applied once, single in-flight batch, analysis/clock watermark, speech verification, span exclusion and `excludedSpans`, stale-revision resubmission with a new ID, semantic rejection reported, confidence filter, take boundaries, final batch after stop.
  - `tests/input-engine.test.ts` (real SLOOP WASM): record kick → count-in → downbeat → beatboxed audio with 90 ms latency and ±10 ms human error plus a percussive “Groove stop” span → steps `[0, 6, 8, 14, 36]` exactly, playback continues after stop.
  - `tests/persistence.test.ts`: round trip, shared fixture import, invalid/foreign/future rejection, local saves, per-device calibration.
- `npm run build`: worklet and worker bundled as separate assets.
- Browser (Chromium in the Claude desktop browser pane, Vite dev server, real WASM): clicked Enable audio → Record Kick (count-in shown, recording at downbeat) → fed a scheduled test signal of 8 kicks with ±8 ms error through the identical worklet → worker → recorder path → clicked Stop recording. The engine committed exactly steps `[0, 4, 6, 10, 16, 28, 40, 52]`, with 0 ignored, no errors, playback still running and the take idle. Analysis p95 was 0.9 ms. The first browser run found double triggers on decaying sweeps, which led to the energy-rise rule and its regression test.

## Limitations

- The test signal enters after the microphone, so it doesn't exercise acoustic or device latency. No real performer or microphone has been measured yet. Acoustic latency, detection on real beatboxing, and count-in audibility need checking on each laptop with headphones.
- Hands-free takes wait on the contract above and on Workstream 3 speech recognition.
- Melody (YIN), save/load/import/export controls (wiring `session-file.ts` to `load-session`), the pattern editor (`edit-pattern`, `volume`, auditions) and the compact FM-1-style layout are the next Workstream 2 PRs.
- Engine assets were taken from CI because Docker Desktop doesn't start on this laptop; local `build-engine.py --docker` is unverified here.

## Next integration step

Integrator: review the `main.tsx` wiring, merge `ui-input` into `engine-integration`, and decide on the `speech-verified` proposal. Workstream 3: emit `command-span` for wake-phrase commands with measured capture-clock frames, plus the verification watermark once agreed.

## Integrated engine/input corrections

The branch is merged into engine-integration. The speech-verified proposal is accepted and routed to PerformanceRecorder, with latency-corrected timestamp semantics in CONTRACTS.md; no fake watermark is generated from connectivity. Hands-free speech is still pending.

Later verified hits now replace the still-queued batch so the complete take can land at the following loop. The superseded command is terminally rejected and the new command includes the older immutable events plus new events. Stopping capture no longer changes the saved session revision. Real-WASM tests now require the complete verified take by the following loop.

Browser testing exposed double triggers on low kick chirps at different FFT-hop phases. Energy-rise detection now uses full-window RMS instead of sub-cycle hop RMS, and a six-phase regression reproduces the earlier failure. Diagnostic test buffers have zero round-trip compensation because they bypass microphone/speaker latency; actual microphone defaults and tap calibration are unchanged. The panel no longer pins a completed take's lane after selecting another lane.

The Linux Chromium software-path diagnostic produced exactly steps [4, 8, 12, 20], four committed hits, continued playback after stop, and about 3.2 ms analysis p95. It injects synthetic audio after the microphone; it does not validate acoustic latency or real beatboxing. The reusable Playwright CLI function is tests/browser/input-pipeline.js.

## Second batch (branch `ui-melody`, PR #5)

| Piece | File | Notes |
| --- | --- | --- |
| Pitch | `input/pitch.ts` | YIN in the analysis worker: FFT cross-correlation difference function, CMND threshold 0.15, parabolic refinement, 75–1100 Hz, 1024-sample window, 256-sample hop. |
| Notes | `input/pitch.ts` (`NoteSegmenter`) | Clarity ≥ 0.8 and level gate; 3-hop onset agreement; a pitch change must hold 12 hops (~70 ms) at > 0.9 semitone, so ±0.6 semitone vibrato never splits; octave errors folded; a 9 dB dip then 6 dB rise splits repeated pitches; minimum 70 ms; flushed when the take closes. No forced scale. |
| Recorder | `input/recorder.ts` | Note events for melodic targets, watermark waits for note ends, notes still sounding at stop are clamped to the cut-off, analysis that arrives late (for audio before the cut-off) still counts after stop. Uses Workstream 1's `replacesCommandId` batch replacement (below), so a whole take, notes included, lands on the following loop. |
| Session UI | `ui/SessionPanel.tsx` | Save to this browser, list and load saves, export a file, import a file → `load-session` at the next loop (undo restores the previous session). |
| Editor | `ui/pattern-edit.ts`, `ui/PatternEditor.tsx` | Drum lane toggles, synth note placement and removal (monophonic, wraps the loop edge), pitch/octave/length, audition keyboard (note-off on release or leave) and drum audition, per-track volume. `PatternEditQueue` merges clicks within a loop into one `edit-pattern`, and after a stale rejection re-applies the edits on top of the newer session instead of overwriting a take. |
| Recording UI | `ui/InputPanel.tsx` | Targets Kick/Snare/Hats/Synth 1–3, a note grid with pitch names, and dashed provisional cells. |

Checks: `npm test` 84 pass, 1 skipped. New: `input-pitch` (accuracy within 0.2 semitone from G2 to G5, phrase boundaries within 20–30 ms, legato, vibrato, repeats, octave folding, block-size invariance, p95 < 50 ms), melodic recorder cases, `pattern-edit` (ops, coalescing, stale re-apply, real WASM), and the real-WASM reload. `input-engine` now also runs the **milestone 3 acceptance on real SLOOP WASM**: a sung four-bar melody records exactly, then re-singing bar 3 replaces only bar 3 while playback continues.

Browser (real WASM, test signal through the identical worklet → worker path): Record Synth 1 committed all 10 sung notes exactly, and the phrase landed on the loop after it was sung. A second take that sang only bar 3 replaced exactly those three notes and kept the other seven. The session panel saved, then after clearing Synth 1 loaded the save back. The editor placed E4 at steps 5 and 9 during playback with two clicks, both landing at the boundary, with other tracks untouched.

Audition sound was not checked by ear. Basic Pitch: see `docs/benchmarks/basic-pitch.md`.

## Compact groovebox layout (on `ui-melody`)

`ui/Groovebox.tsx` replaces the harness page with an original, hardware-inspired layout: a status display (BPM, live bar.beat, transport, record/count-in state, transport/tempo/undo keys), a four-channel strip (select, engine · preset, note/hit count, mute, volume), and tabs for Record, Edit, Sound, Session and Agent. The agent/transcript harness is unchanged and moved into the Agent tab. `ui/SoundPanel.tsx` plus `ui/patch-edit.ts` add engine and factory preset selection, envelope/filter (ATK/DEC/REL/FLT) and the engine's named macros with firmware ranges, applied through `apply-patch` latest-wins (one in flight, stale resubmission). Drum kit sounds stay fixed until there is a drum-kit contract.

Checks: `patch-edit` tests (controls and ranges from real metadata; three rapid changes during playback resolve to the last value through real WASM, with notes preserved). Browser: playback from the display with live bar.beat, select Synth 1 → Sound → preset WURLI applied at the loop boundary with its 4 notes kept, and the layout fits at 375 px wide. `npm test` 86 pass, 1 skipped.

Merged with integration `18b9139`: the recorder keeps Workstream 1's batch replacement and speech-verified routing, the earlier 0.4 s boundary-timed batching was removed in favour of it, and the panel uses `displayedTarget` (window target while recording, `armedTarget` during count-in) for synth targets too.

### After merging `18b9139` (batch replacement)

- Race fixed in `recorder.ts`: acks cross a MessagePort, so a batch can apply on the audio thread after the recorder sent its replacement. The replaced batch's `applied` ack now counts its events as committed, and the retry resends only the new events. Covered by a test with deferred, out-of-order acknowledgments.
- When a new take starts, an in-flight batch that the engine no longer lists in `pendingCommandIds` is dropped and reported instead of being chained onto.
- Browser, with a freshly built worklet: a 7-note sung take with vibrato landed in full at the boundary right as the phrase ended, through successive replacements, with no errors.
- Pitfall: `public/engine-runtime.js` is built when the dev server starts. After pulling engine/contract changes, restart `npm run dev`. A stale worklet rejects new contract fields before its acknowledgment path, so commands get no ack (the recorder now recovers at the next take).
- `npm test`: 94 pass, 1 skipped. `npm run check` needs the project virtualenv's `jsonschema` (SETUP.md), which wasn't installed on this laptop; CI runs it.
