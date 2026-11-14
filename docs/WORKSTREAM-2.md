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

## Second batch (branch `ui-melody`, stacked on `ui-input`)

| Piece | File | Notes |
| --- | --- | --- |
| Pitch | `input/pitch.ts` | YIN in the analysis worker: FFT cross-correlation difference function, CMND threshold 0.15, parabolic refinement, 75–1100 Hz, 1024-sample window, 256-sample hop. |
| Notes | `input/pitch.ts` (`NoteSegmenter`) | Clarity ≥ 0.8 and level gate; 3-hop onset agreement; a pitch change must hold 4 hops at > 0.9 semitone (so vibrato never splits); octave errors folded; a 9 dB dip then 6 dB rise splits repeated pitches; minimum 70 ms; flushed when the take closes. No forced scale. |
| Recorder | `input/recorder.ts` | Note events for melodic targets, watermark waits for note ends, notes still sounding at stop are clamped to the cut-off, analysis that arrives late (for audio before the cut-off) still counts after stop. **Batches are sent 0.4 s before each loop boundary while a take is open**, so everything performed in a loop lands on the following loop. |
| Session UI | `ui/SessionPanel.tsx` | Save to this browser, list and load saves, export a file, import a file → `load-session` at the next loop (undo restores the previous session). |
| Editor | `ui/pattern-edit.ts`, `ui/PatternEditor.tsx` | Drum lane toggles, synth note placement and removal (monophonic, wraps the loop edge), pitch/octave/length, audition keyboard (note-off on release or leave) and drum audition, per-track volume. `PatternEditQueue` merges clicks within a loop into one `edit-pattern`, and after a stale rejection re-applies the edits on top of the newer session instead of overwriting a take. |
| Recording UI | `ui/InputPanel.tsx` | Targets Kick/Snare/Hats/Synth 1–3, a note grid with pitch names, and dashed provisional cells. |

Checks: `npm test` 84 pass, 1 skipped. New: `input-pitch` (accuracy within 0.2 semitone from G2 to G5, phrase boundaries within 20–30 ms, legato, vibrato, repeats, octave folding, block-size invariance, p95 < 50 ms), melodic recorder cases, `pattern-edit` (ops, coalescing, stale re-apply, real WASM), and the real-WASM reload. `input-engine` now also runs the **milestone 3 acceptance on real SLOOP WASM**: a sung four-bar melody records exactly, then re-singing bar 3 replaces only bar 3 while playback continues.

Browser (real WASM, test signal through the identical worklet → worker path): Record Synth 1 committed all 10 sung notes exactly, and the phrase landed on the loop after it was sung. A second take that sang only bar 3 replaced exactly those three notes and kept the other seven. The session panel saved, then after clearing Synth 1 loaded the save back. The editor placed E4 at steps 5 and 9 during playback with two clicks, both landing at the boundary, with other tracks untouched.

Known behaviour: if Stop is pressed after a batch has been queued for the coming boundary, that batch goes stale (stop bumps the revision) and lands one loop later. Basic Pitch phrase refinement has not been benchmarked yet (optional per PLAN). Audition sound was not checked by ear.

## Compact groovebox layout (on `ui-melody`)

`ui/Groovebox.tsx` replaces the harness page with an original, hardware-inspired layout: a status display (BPM, live bar.beat, transport, record/count-in state, transport/tempo/undo keys), a four-channel strip (select, engine · preset, note/hit count, mute, volume), and tabs for Record, Edit, Sound, Session and Agent. The agent/transcript harness is unchanged and moved into the Agent tab. `ui/SoundPanel.tsx` plus `ui/patch-edit.ts` add engine and factory preset selection, envelope/filter (ATK/DEC/REL/FLT) and the engine's named macros with firmware ranges, applied through `apply-patch` latest-wins (one in flight, stale resubmission). Drum kit sounds stay fixed until there is a drum-kit contract.

Checks: `patch-edit` tests (controls and ranges from real metadata; three rapid changes during playback resolve to the last value through real WASM, with notes preserved). Browser: playback from the display with live bar.beat, select Synth 1 → Sound → preset WURLI applied at the loop boundary with its 4 notes kept, and the layout fits at 375 px wide. `npm test` 86 pass, 1 skipped.

## Melody integration corrections

The melody branch is integrated with the existing replacement-batch protocol, latency calibration, explicit speech watermark routing and full-window RMS onset fix. The 0.4-second submission window now allows later verified notes/hits to replace its queued batch before the same boundary. Stop remains transport-only and does not invalidate a pending batch. The earlier stop-revision limitation above describes the pre-integration branch. The record panel uses armedTarget during count-in.

Integrated validation: schema/type checks, complete Node suite, live service integration and build pass. The browser melody diagnostic committed eight exact notes and a one-note correction through the real workers/WASM by their following loops, preserving the other seven notes and playback, with analysis p95 around 6.2 ms. Synthetic singing only. Pattern and sound queues remain subscribed when switching workspace tabs so pending changes are not lost.

## Asynchronous recording acknowledgments

Integrated f1e0434: a replaced batch that already applied is counted once and excluded from retries. Starting a new take drops and reports an unacknowledged old batch that the engine no longer lists as pending. Regression tests defer audio-thread acknowledgments across replacement and take changes. The integration branch retains its optional boundary submission window plus replacement support.

## Real-microphone testing support (branch `ws2-mic-testing`)

Defects reproduced on a real Windows laptop or against real WASM, and fixed with regression tests:

| Defect | Evidence | Fix | Test |
| --- | --- | --- | --- |
| Latency calibration failed on real hardware (1/8, then 3/8 clicks matched) | The first clicks after silence reached the mic 15–20 dB quieter | `clickPlan`: 2 unscored lead-in clicks plus 10 counted clicks | `input-mic-testing`: the old 8-click run with 3 warm-up misses fails; the new plan recovers 120 ms latency |
| Uncalibrated takes land late | Browser estimate 62 ms against ~120 ms measured | `calibrationStatus`; Record shows "(uncalibrated)" with a warning until silence is measured and timing calibrated (`noiseSource` is a new optional calibration field) | readiness cases, including calibrations saved before the field existed |
| No feedback when input is too quiet or noisy | A tester's hits peaked at −46..−30 dBFS against a −39 dBFS floor; nothing was detected and nothing said why | `MicCheck` and `MicCheckPanel`: verdict (no signal, too quiet, ok, clipping), noisy-room warning, hit and note detections, and the processing settings the browser actually granted | verdict, window and detection cases |
| Record dropped by a click during count-in | Real WASM: Record queued, then a mute, so Record was rejected as stale and recording stayed idle | `ui/command-client.ts`: UI commands use the engine's live revision. Queued absolute commands (record, tempo, clear, load-session) are re-issued when the revision moves, so they still make the same boundary. Undo is never re-issued. Plain-language status replaces raw ack strings | real WASM: the take starts at the first downbeat despite the click; two queued changes are both kept; undo is reported, not repeated |

Also added: an input device picker (`input/devices.ts`); an opt-in **Copy test report** (`input/diagnostics.ts`, measurements only, no audio or device IDs or labels, with a clipboard timeout fallback); mic-check UI updates throttled to about 10 per second instead of about 43; and `docs/MIC-TESTING.md`, a 5-minute checklist for each teammate.

Verified:
- Node: full suite.
- Built-in pane, through the real UI with the test signal: Record during count-in, a strip mute click, Record re-issued, and recording started at the same downbeat ("Record Kick: done").
- Chrome with the **real microphone** on Windows: mic check showed Level OK at −10 dBFS peak, plus the noisy-room warning. The browser granted processing off at 48 kHz with **2 channels** (1 requested; the capture worklet downmixes). Record showed "(uncalibrated)". The report copied, with no device fields.

Not done: a full calibrated take by a real performer (see MIC-TESTING.md). Speech capture is documented in `docs/SPEECH-CAPTURE.md` only; no audio transport is implemented pending an approved contract.

## Guided calibration, melody diagnostics and late-hit diagnosis (branch `ws2-calibration-ux`)

These implement the WS2 items in `docs/STATUS.md` (recording-usability priorities after real-device testing) that don't depend on WS1's pending scheduling contract.

- **Guided timing calibration** (`input/calibration.ts`, `ui/CalibrationPanel.tsx`): instructions, a visible 3-second countdown, 4 practice clicks (lower pitch, never scored) then 8 measured clicks, progress, and **Cancel**. A failed or cancelled run keeps the previous valid calibration. The result shows offset, consistency (±) and matched taps.
- **Recording-offset trim**: a per-device manual adjustment (`offsetAdjustMs`, −150..+150 ms, persisted) added to the measured latency everywhere capture is compensated (`effectiveLatencyFrames`).
- **Check timing**: a repeatable tap test against the *current* settings (`timingCheck`). It reports how many ms taps are still recorded late or early and offers "Apply trim"; it never overwrites the calibration.
- **Late-hit cause, reproduced in a test** (`tests/input-latency-diagnosis.test.ts`): compensating a ~120 ms real round trip with the 62 ms browser estimate moves natural (±15 ms) hits a full step late. Calibration, or the trim suggested by Check timing, puts every hit back on its step.
- **Melody diagnostics**: the worker now posts a live pitch reading per block (`readPitch`: silent / too quiet for the gate / unclear / a usable pitch with its note name, and whether a note is being held). The mic check explains why singing does or doesn't become notes, e.g. "Voice heard at −30 dBFS but notes need −24 dBFS" in a −39 dBFS room, or "Pitch unclear (clarity 0.60, needs 0.80): sing a steady vowel". Thresholds are unchanged pending real-device evidence.
- **Take states**: heard (waiting for verification), queued for the next loop, committed, ignored.
- **Actionable errors**: a command with no engine answer within 3 s reports a likely stale or crashed worklet and says to restart `npm run dev`; worker load failures say what to do; "Overlapping monophonic notes", "Nothing to undo" and stop-recording rejections read as sentences; engine/asset errors replace older command results in the display.

Verified in the browser (diagnostic test signal through the real worklet → worker path):
- Calibration showed countdown 3-2-1 → practice 1–4 → measured 1–8 → analysing, and measured exactly the injected 120 ms with 8/8 taps matched.
- Check timing with taps 150 ms late reported "30 ms late"; Apply trim +30 then re-check gave "within 0 ms".
- Cancel during practice kept 120 ms and +30.

Not yet: reproduction on Lenny's device itself, and next-beat recording / immediate Clear and Undo, which wait for WS1's published contract.

### WS1 review fixes (#7 / #10)

- **Diagnostic clock**: the worker now reports `processedThrough` (real processed capture), separately from `analysedThrough` (verification coverage, which is held at the start of an open sung note). MicCheck expires peaks and pitch readings by processed time, so a sustained note no longer freezes the window. Sustained-note regression added.
- **Calibration lifecycle** (`input/timed-run.ts`): one cancellable run that always settles, on completion, Cancel, `stopMicrophone()`, device disconnect, device change, `dispose()`, or the AudioContext closing (its clock stops). Scheduled click nodes are stopped and disconnected on every exit. Cancelled or failed runs leave the calibration untouched instead of restoring a snapshot, so a trim made mid-run survives and one device's timing is never applied to another. `VoiceInput` loads the microphone lazily through an injectable factory, so `tests/input-lifecycle.test.ts` drives the real class with fake audio objects for each interruption.
- **Report**: `MicTestReport.calibration` adds `offsetAdjustMs` and `effectiveLatencyMs` (numbers only).
- **Guided silence**: Measure silence shows a 3-second "stay quiet" countdown, then the measurement, with Cancel. No clicks. Cancel or failure keeps the previous noise floor.
- **Armed Record (integration note)**: when WS1's recording-usability contract is adopted, Record leaves the command client's automatic re-issue list (WS1 pins an armed Record to its target and deadline). Until then Record still uses next-loop, and re-issue prevents the stale drop reproduced earlier.

Verified in the browser (test signal): silence countdown 3-2-1 → measuring → −44.6 dBFS for injected noise of about −44.8 dBFS; stopping the mic during timing calibration settled immediately and kept the timing. `npm test` 125 pass, 1 skipped; build ok.
## Dark monochrome workspace and synth piano roll (branch `ws2-workspace`)

This implements STATUS.md item 4. `ui/Groovebox.tsx` (same export, so `main.tsx` is unchanged) is now a DAW workspace with **no tabs**:

- **Transport bar** (`TransportBar.tsx`, persistent at the top):
  - Play/Stop, Rec for the selected target (disabled until the mic is on, with the calibration hint when uncalibrated), Stop rec, the REC/COUNT-IN state, Undo, Clear target, tempo −/+, bar.beat;
  - a fixed-height status line with the pending-change count (it never re-wraps and shifts the editor under the pointer);
  - a compact **Session** menu (save/load/import/export; closes on Escape or an outside click).
- **Tracks** (`TrackList.tsx`, left): select, engine · preset, note/hit count, mute, and volume that follows the slider while dragging (throttled to ~10 commands per second).
- **Editor** (center):
  - Drums use **step lanes** (`DrumGrid.tsx`): click to toggle; click a lane name to select it as the recording lane and audition it; playhead; dashed pending hits.
  - Synths use a **piano roll** (`PianoRoll.tsx`): keyboard/pitch axis (25 rows, octave up/down, Center), a four-bar 1/16 grid with beat and bar lines, playhead, create by click with a chosen length, move by drag (time and pitch), resize by dragging the right edge, delete with Delete/Backspace or double-click. Notes that wrap the loop edge render as two segments, recorded-but-unconfirmed notes show dashed, and new/moved notes are auditioned. Empty rolls center on C4; existing rolls center on the median note.
- **Inspector** (right, collapsible): Sound (`SoundPanel`), Input (`InputInspector`: mic, device, meter, silence, mic check, guided calibration, readiness, take status) and Agent (the WS1/WS3 harness, unchanged).
- Synth tracks are monophonic, as in the engine: `moveNote`/`resizeNote` replace notes they land on. One shared `PatternEditQueue` and one sound queue stay mounted, so pending edits always receive acknowledgments.
- The status line ignores `main.tsx`'s raw ack echoes ("applied"), keeping the command client's plain-language text, while still showing engine/asset errors.
- **FM6** voices use packed factory data, so their generic sliders (which read 0 and would overwrite the real voice) are hidden with an explanation.

Bugs found by browser testing and fixed with tests:
- Unapplied notes shared one placeholder ID, so React left duplicate notes in the roll after the engine applied the edit. Placeholders are now unique (`pending:N`).
- The pending indicator wrapped the header, shifting the editor by ~28 px mid-edit. The status is now one fixed line.

Verified:
- Node: `npm test` 120 pass, 1 skipped; build ok. New `tests/piano-roll.test.ts`: move/resize/delete keep tracks monophonic, centering and pointer mapping, unique placeholders, and real-WASM edits through the queue.
- Browser, with the mouse: on Synth 1 during playback, added C5 at step 41, dragged C4 to D4 at step 5, lengthened E4 to 10 steps, and deleted G4. After two loop boundaries the engine's notes exactly matched the roll, with no duplicates, a 44 px header throughout, and the status cleared.
- The 1440 px layout shows transport / tracks / roll / inspector; at narrower widths the inspector moves below. The session menu opens and closes.

Not yet wired: next-beat Record and immediate Clear/Undo. Those buttons still use next-loop until WS1's recording-usability contract is merged.

## Near-grid timing diagnostic (branch `ws2-grid-timing-diagnostics`)

This answers WS1's request in `docs/reviews/PITCH-BOUNDARY-DIAGNOSTIC.md` to capture raw note timing and the distance from the nearest rounding threshold, so a missed grid cell on a real device can be diagnosed. Placement is unchanged: no snapping, and no hidden compensation.

- `input/grid-timing.ts`: for each accepted onset or note (latency-compensated, on the engine's `recordingLoopStartFrame` grid origin), it records the rounded step, the signed offset from that step (ms, negative = early) and the distance to the nearest rounding threshold (half a sixteenth). Boundaries within 10 ms are flagged; the start and, for notes, the end are both measured.
- The recorder keeps the last 32 placements (`RecorderStatus.timing`). The mic check shows "Grid timing: last N events, mean start ±X ms from the grid · K within 10 ms of a rounding threshold". **Copy test report** adds `gridTiming` (summary plus the last 16 entries, numbers only).
- Tests (`tests/input-grid-timing.test.ts`):
  - the boundary math;
  - WS1's exact synthetic fixture through the real YIN pitch tracker and note segmenter, where **every boundary that landed in a neighbouring cell is flagged** (margin under 10 ms);
  - the recorder records timing on the engine grid origin without changing placement.
- Browser, with the test signal through the real worklet → worker → recorder path: an E4 that started 61 ms after step 12 was detected at +56.2 ms (6.3 ms from the threshold) and flagged; on-grid notes (−0.3, −3.4 ms) were not.

Next, on real devices: have performers run `docs/MIC-TESTING.md` and post the report. `gridTiming` together with `calibration.effectiveLatencyMs` separates late compensation (a consistent positive mean offset) from boundary rounding (individual events near a threshold).
