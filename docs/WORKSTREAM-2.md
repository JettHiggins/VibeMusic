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
