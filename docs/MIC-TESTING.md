# Real-microphone test (each teammate, on their own laptop)

Current priority: [PLAYTEST-REPAIR.md](PLAYTEST-REPAIR.md) and [STATUS.md](STATUS.md). New repair behavior is planned, not yet implemented; historical demo/count-in/editing/noise guidance below may be superseded. Use a frozen integrated commit for human acceptance.

Use Chrome with wired headphones. This is a manual-input/device check, not the final hands-free speech acceptance. Microphone audio is analysed live and is not saved or uploaded by this workflow; the copied report contains measurements only. Use a normal browser with microphone permission if an embedded browser does not expose the device.

1. Read docs/STATUS.md for the tested branch/review state, preserve local work, and use the current reviewed `engine-integration` baseline. Record `git rev-parse --short HEAD`. Build/stage the WASM assets as described in SETUP.md if missing; restart `npm run dev` after pulling engine changes, then open the URL printed by Vite (usually http://localhost:5173). Do not overwrite another person's branch. The recording-consumer capability from PR #20 is already integrated; test the current integrated controls.
2. Enable audio, then Enable microphone in the Input inspector and grant permission. Pick the intended input. Note browser/OS version, laptop, microphone and headphones.
3. Read the microphone diagnostics. Note whether the browser granted echo cancellation/noise suppression/auto gain off. Make several beatbox hits: check level advice and detected-hit count. For melody, sing/hum a steady vowel rather than speak note names; note the live pitch advice (no signal, too quiet, unclear or a note).
4. Click Measure silence. Remain quiet through the visible three-second preparation and 1.5-second measurement. Cancel should preserve the previous valid floor.
5. Stop playback, open Calibrate timing…, then Start calibration. After three seconds, tap sharply or say “t” with four practice clicks and eight measured clicks. Note measured offset and consistency. Cancel should stop clicks and keep the previous calibration. Use Check timing… to measure residual timing; if hits are still late increase recording-offset trim, if early decrease it. Keep the same device/headphones throughout.
6. Select Kick, start playback and record a simple pattern. Record should start on the next beat; from stopped it provides four count-in beats. Stop recording should preserve looping. Repeat for Snare and Hats. Note intended/actual steps and early/late/missed/extra hits.
7. Press Clear while recording. Keep playback/capture running and make a new hit: old hits must stay gone, fresh hits must work. For Undo, first create pending input: Undo should discard it; once no input is pending, Undo should restore the last applied musical edit. Keep recording; verify erased input does not return on the following loop.
8. Select Synth 1, audition a key/preset and record a short sung phrase. Note live pitch, provisional and committed counts. Record again, sing only one bar and check that the other notes survive. If nothing lands, copy the exact visible error and browser console message with its failed URL, and note whether audition and pitch detection worked. Worker-load errors include the module URL and source location when the browser provides them. The recalled chord/loading error is not presumed fixed.
9. Scroll the inspector and check transport/session-menu access. Copy test report and post it with the table below in coordination issue #9 (or the team's microphone-results issue), without raw audio or secrets.

| Field | Result |
| --- | --- |
| Commit / branch, OS / Chrome version | |
| Laptop / mic / wired headphones | |
| Browser processing granted / input sample rate | |
| Noise floor / measured offset / trim / effective offset | |
| Calibration preparation / Cancel / timing check | |
| Kick / Snare / Hats intended vs actual steps | |
| Next-beat / stopped count-in | |
| Live Clear / Undo / old input stays gone | |
| Synth audition / live pitch / committed notes | |
| Phrase correction preserves other bars | |
| Exact error and failed URL, if any | |
| Ten-minute audible playback glitches, if tested | |

Earlier Windows evidence: ~120 ms round trip versus a ~62 ms browser estimate, with ~−39 dBFS room floor. That suggests a plausible late-placement cause. It is not a calibrated performer pass on Lenny's device. Synthetic browser tests and CI do not fill in this table on a human's behalf.

Final hands-free acceptance remains separate: after real STT/Deep Agents integration, complete PLAN.md's voice-only drum/melody/correction/sound-refinement/clear/undo/stop workflow, and measure command latency and ten-minute audible playback on each development platform.
