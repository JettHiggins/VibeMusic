# WS1 voice reliability handoff — first capability

Branch: ws1/melody-reliability. Base e00ae28, current coordinated round. First capability ddaa515 source changes were confined to pitch.ts; compatible PitchOptions/PitchReading/SungNote and wire/public input methods remain. WS2 can continue presentation and WS3 can continue service/sound work independently.

## Reproduction and fix

A confident continuous two-second pitch with gentle level modulation produced four fragments before the fix, ending near 241/903/1570/2000 ms with intervening gaps. A clean 125 ms adjacent-note phrase already passed; that does not explain the human fast-note misses under real conditions.

The segmenter used the same amplitude gate for acquiring and retaining a note, then treated any sufficient amplitude dip/rise as re-articulation. The focused fix retains the strict acquisition gate, allows a held periodic note six dB of level hysteresis, and requires a recent break in periodic voicing before envelope-based re-articulation. Mere voiced amplitude swells no longer split a sustained hum. The existing clarity requirement and silence release stay in place. Live pitch gate feedback follows the held-note threshold; interface and raw capture timing are unchanged. Scale mapping is unchanged.

## Vochlea comparison

Official Vochlea Using Pitch documents different input-level needs for humming/noisy input, pitch stability versus note-change tradeoffs and detected/output pitch feedback (see VOCHLEA-REFERENCE.md). Our engineering inference is to separate note acquisition from retention and require evidence for re-articulation. This is our independently tested implementation, not extracted proprietary DSP or a claim of Dubler parity. Key restriction was not the reported pitch-choice problem and was not changed.

## Evidence

- 13 focused pitch tests pass: YIN fundamentals, noise rejection, wide vibrato, repeated articulation, octave errors, block/timestamp invariance, clean 125 ms phrase, modulated full-bar holds, real synthesized waveform extraction/end at silence and quiet periodic input refusing to acquire a new note.
- Full Node 250 passed / one optional skip, shared checks and production build pass.
- Actual Chromium capture worklet -> YIN worker -> recorder -> real SLOOP browser engine passed tests/browser/sustained-hum.js. One softening two-second hum committed exactly one MIDI 60 note, step 20 / duration 16 at 120 BPM; playback continued. Analysis p95 9 ms in this run. This is a synthetic sung signal, not a physical microphone or human performer.

## Remaining work / next step

Quiet acquisition/high or contaminated calibration, background conversation, real-device fast-note misses, every synth, loop-crossing holds and audible envelope-versus-note-gate tracing remain to investigate; this first capability does not close those reports. A naturally decaying instrument may sound short with a correct long MIDI note; compare a known sustained patch and the same committed note before changing envelopes. Provider/speech classification can also hold or exclude notes and remains WS3-owned. Human singing/fun acceptance remains open.

WS1 next investigates quiet/fast capture conditions and rendered duration while continuing integration. WS3's top product priority is actual spoken instrument retrieval; previous typed/real-model research checks do not close Jett's spoken failure. Small review/merge of this capability must preserve the current round's independent work and old immutable test tags.


## Second capability — clear quiet acquisition and rendered duration

Source commit: **5b44528698dadf806c79c8dd4542d0e4ba456963** on the same feature branch. This extends the first capability; it explicitly changes clear-signal acquisition by three dB rather than claiming all acquisition thresholds are unchanged.

A four-note 125 ms phrase with a -60 dBFS room floor had 69 confidently periodic analysis frames, peak level -46.3 dBFS and maximum clarity .962, yet acquired zero notes because all frames missed the original -45 dBFS gate. The fix gives high-confidence periodic frames (clarity >= .9) a three-dB acquisition allowance; uncertain voiced input retains the original 15 dB margin and held notes retain the previous six-dB hysteresis. Diagnostics derive their reported threshold from the same helper. Quiet periodic input below the clear gate still cannot acquire a note, and uncertain input does not receive the allowance. This is a narrow measured default improvement, not automatic foreground/background speaker identification.

Actual browser capture/YIN/recorder/WASM with seeded room noise now commits four quiet sixteenths exactly: [20,1,60], [21,1,62], [22,1,64], [23,1,65]. Analysis p95 10.6 ms in this run. The two-second softening hum still commits one 16-step note; repeat browser p95 8.5 ms. Script: tests/browser/quiet-fast-melody.js. Synthetic signals do not prove physical microphone quality.

The duration investigation now includes actual rendered SLOOP PCM: a 16-step note with a known sustained envelope retains energy near the end of its two-second gate, unlike a two-step note with the identical patch; it releases after real note-off. tests/sung-duration-render.test.ts checks that distinction and unchanged engine note duration. This separates gate truncation from an intentionally decaying piano/pluck preset; no synth envelope or scale mapping was changed.

Validation after both capabilities: 24 focused pitch/diagnostic/render tests pass; full Node **253 passed / one optional skip**, shared checks and production build pass. Browser quiet fast phrase and full-bar hum checks pass. Physical conversation/noise, stale or contaminated calibration values, every-device/profile behavior and loop-crossing holds remain separate next work, not passed by these fixtures. WS2 and WS3 can keep using existing public interfaces.

## Integration follow-up — semitone and transition regressions

Source e06cf85 (with 561321f) extends the quiet acquisition work. Combined browser testing caught an intermittent adjacent-semitone merge; the expanded native phrase test also caught an early mixed-pitch frame permanently vetoing a settled following note. The held MIDI note now anchors the persistent-change comparison, and transition candidates keep only the latest twelve frames rather than letting the first mixed frame veto all later evidence. Eight capture/noise alignments and twelve vibrato phase/rate combinations pass, including the existing real-WASM phrase/correction regression. Scale mapping and interfaces remain unchanged.

These melody commits are integrated with WS2 PR42 / 0408009 and only independent WS3 protocol/cooldown 366f07e/4132702 in combination 6c213e4; latest shared status is authoritative. Full combination: Node 260 passed/one skip, backend 418 passed/six skips, check/build/service-WASM and actual browser quiet/held/calibration/layout/service actions pass. See reviews/RELIABILITY-COMBINATION.md. Physical microphone, calibration/background and loop-crossing follow-ups remain open. WS1 also published concrete endpointing and hidden instrument-error reproductions for WS3; neither typed research success nor these synthetic input tests close actual spoken instrument retrieval.

## Calibration and loop-crossing follow-up

Branch ws1/calibration-reliability, based on integrated fc92906. A new reproduction confirmed that a 250 ms unpitched burst in a 1.5 s sample of -60 dBFS room noise drove the former 90th-percentile estimate toward the burst's -20 dBFS level. This is a demonstrated way calibration can raise the melody gate; it does not prove what happened on the human laptop.

The estimate now requires a steady majority: short-window levels within six dB of the median must cover at least 75% of the sample; its upper percentile estimates that steady band. Brief cough/handling outliers and brief digital silence are excluded. A heavily unstable sample is refused, not silently calibrated; a genuinely steady loud room still reports its actual high floor. Worker refusals use the existing noise-floor-unavailable message so the active microphone is not misreported as dead while a waiter times out. Prior valid calibration is preserved. Noise error formatting also avoids the previously observed doubled punctuation/repeated preservation sentence. No public/wire contract, scale, capture timestamp or synth patch changes.

Validation: 20 focused onset/calibration/worker cases pass. Full Node 264 passed/one optional skip, shared checks and build pass. Actual browser MediaStream/capture/analysis/VoiceInput measured -59.835 dBFS with a brief controlled burst, then rejected a heavily unstable sample in 1598 ms while preserving the valid object and musical session. The physical source is synthetic noise; no human-room robustness is inferred.

The actual browser capture/YIN/recorder/WASM loop-crossing check passed separately for synth-1, synth-2 and synth-3: one note starting at step60 with duration16 on each target, with playback continuing. p95 analysis was approximately 7.6/7.6/8.7 ms in this run. Real rendered SLOOP PCM also retains the note after the four-bar wrap and releases after actual note-off. Scripts: tests/browser/noise-calibration-transients.js and tests/browser/loop-crossing-hum.js; render coverage is in tests/sung-duration-render.test.ts.

This supersedes the earlier pending synthetic every-track/loop checks, but not physical microphone, real conversation/noise, browser processing/gain/device changes, human hearing/fun or actual spoken instrument retrieval acceptance. WS1 continues service/speech integration independently while awaiting those real-world results.

## Live piano-roll preview first

Branch: ws1/live-piano-preview; source **6a119b0**, integrated into engine-integration. Jett selected the live visual preview before live synth monitoring. The actual YIN/segmenter already analyzed continuously; the UI used only completed notes. NoteSegmenter now exports a view-only open-note estimate. The worker forwards it independently of completed notes and the recorder maps it to the current take/grid with latency subtracted once. Groovebox composes this optional live view with pending finalized events. No SessionState/wire changes, no open estimate enters the event queue or a SessionCommand, no verification watermark advances for the preview. Raw pitch stays raw; the existing scale helper maps it only for display/commit as before.

The preview appears after a stable pitch onset and grows on the sixteenth grid. Release/pitch transitions replace it with finalized provisional notes through the existing path. Command spans and erase fences suppress it; stop, reset, new take/epoch/clock and speech disconnect clear it. Stable preview IDs do not consume musical-event IDs. Existing older/mocked analysis frames without liveNote produce no preview.

Validation: five focused segmenter/recorder tests cover growing raw estimates, zero unfinished dispatch even near a boundary, calibrated positions/stable IDs, actual speech exclusion, erasure/reset/stop/clock/drum/disconnect and loop-crossing geometry. A worker regression verifies immediate streaming, no final output while held, unchanged coverage and gap/flush clearing. Checks/build pass. Provider-disabled actual Python WebSocket -> real WASM integration passes. Existing browser quiet-fast phrase still records four adjacent sixteenths.

`tests/browser/live-piano-preview.js` drives the actual app, real capture worklet/YIN worker/VoiceInput/recorder/SLOOP with a synthetic two-second C4 signal. First visible DOM preview: **63 ms** after signal start; around 0.20 s width 9.77 px / one grid step, around 1.51 s width117.19 px /12 steps. No queued/finalized/committed note during the hold; release leaves exactly one pending note, then stop commits [step20,duration16,midi60]. Analysis p95 7.4 ms. This is synthetic source/Chromium evidence, not real microphone/singer latency or a guarantee across devices. No live synth monitoring was added. WS2 retains low/high range visibility and provisional styling; test those with the merged preview before claiming whole vocal-range UX complete. Physical microphone/fun, speech and spoken real research acceptance remain open.

Final preview suite: Node270 passed / one optional skip; no live provider requests.

### Live-preview interaction integration checks — 8ac2fdf

`tests/browser/live-preview-erase-key.js` passed against the actual app with a C#4 synthetic source: raw analysis remains MIDI61, C-major display is C4 through the existing helper, and clicking the visible live note erases it while held. It neither returns while the tone continues nor enters pending input/the composition after release. No DSP/key semantics changed for this check.

`tests/browser/live-preview-clear-undo.js` passed with the actual Undo and Clear Synth1 buttons during a held synthetic C4. Both advance the capture epoch and clear the old held preview; ongoing post-edit input creates a new preview at/after the new cutoff, then one fresh pending note survives release. The old capture never returns, and playback continues after stop-recording. Observed Undo oldStart123572/cutoff129153/freshStart129717; Clear oldStart123572/cutoff131457/freshStart132021. These validate interaction/reset wiring through the real capture/worker/recorder/engine, not physical singing or final human fun acceptance.
