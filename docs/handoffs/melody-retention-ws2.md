# Melody-retention round: WS2 handoff (downbeat preparation and truthful take feedback)

Branch `ws2/recording-phase-feedback` from `origin/engine-integration` at `81a49c4`. Pull request: JettHiggins/VoiceSynthesizer#47. Implementation commit: `5bb712f`. This change touches presentation only:
- `apps/web/src/ui/**`
- one unit test file and one browser script

It does not change `voice-input.ts`, the recorder, DSP, the engine, contracts or services. It uses only data that already exists:
- **Transport fields:** `recordingState`, `countInBeatsRemaining`, `armedStartFrame`, `loopStartFrame`, `currentFrame`, `recordingStartFrame`, `recordingEpoch`.
- **`RecorderStatus` fields:** `mode`, `live`, `provisional[].status`, `committed`, `dropped`, `lastError`.

There are no rhythm-snap or start-option controls yet. Those wait for WS1's contract (MELODY-RETENTION-ROUND.md).

## Before

- **Preparation cues:** the only cues were a small `COUNT-IN n` label in the top bar and a line under the roll ("Count-in: 3 beat(s) until recording", "Armed: starts on the next beat"). Nothing showed where the take would start, or the bar and beat while playing, apart from `3.2` in the top bar.
- **Take counters:** "N heard · N queued · N committed · N ignored" sat in the inspector.
  - The counters ran for the whole microphone session, not per take.
  - "heard" and "queued" had the same meaning in manual and speech mode.
  - "ignored" read as if the app knew a reason.
- **Undo or Clear during a take:** this discarded unsaved notes with no explanation.

## After

**Phase strip** (one 29 px row above the editor, monochrome):

| State | Headline | Detail |
| --- | --- | --- |
| Stopped | Stopped | Record plays a one-bar count-in first. |
| Playing | Bar 2, beat 3 | Record starts on the next beat. |
| Armed from stopped | **Count-in 3** | Get ready: Synth 1 records from bar 2, beat 1. |
| Armed while playing | Starts in 1 beat | …records from bar 2, beat 4. |
| Recording | ● Recording · bar 3, beat 2 | Synth 1 is recording; sing over a phrase to replace it. (For drums: "beatbox now".) |

- **Cells:** four beat cells fill one per count-in beat, then follow the beat. Four bar cells show the loop position, with the start bar outlined while armed.
- **Where the start bar comes from:** it is calculated from `armedStartFrame`. When the engine gives no start frame, the strip says "from the next beat" rather than guessing a bar.
- **Screen readers:** a visually hidden status announces only phase changes and count-in numbers, not every beat.

**Take line** (under the editor, current take only):
- It reads like "Hearing G4 · 2 notes waiting for speech check · 1 sent · 3 saved · 1 not kept".
- **Waiting wording depends on the mode:**
  - manual mode says "waiting to be sent";
  - speech mode says "waiting for speech check".
- **Sent and saved:** "sent" means the engine has not acknowledged yet. "saved" means it has.
- **"not kept":** the take line shows only the count. Its tooltip says the recorder does not report a reason for each one, so no cause is guessed from the counter.
- **Reasons shown:** only real ones:
  1. The recorder's own `lastError`, for example "Speech recognition disconnected; unverified hits were discarded", "A new take started before earlier hits were verified", or an engine rejection.
  2. Otherwise, a new `recordingEpoch` inside the same take. The engine does this only for Undo, or for Clear of the recording target, during capture. The line then says "Undo/Clear restarted capture; N unsaved entries were discarded. Counts restart here." Counts restart because Undo can remove notes that were already saved.
- **Command spans:** command-span exclusions are not reported separately, because the recorder does not expose them. They appear only as "not kept".
- **Inspector counter:** now uses the same words and is labelled "Since mic on: …".

**Accessibility:** the input meter's `aria-valuenow` is clamped to its −60–0 range. This was the follow-up from #42.

Unchanged: live range following and manual Oct, live erase, Clear and Undo, the compact inspector, keyboard access, and top-bar transport labels.

## Checks

- **Unit tests:** `npm test` ran 278: 277 pass and 1 optional test is skipped.
  - New: `tests/ws2-recording-phase.test.ts` covers bar/beat mapping and wrap; the stopped, playing, count-in, next-beat and recording text; no invented start bar; per-take counts; mode wording; the Undo epoch restart and count rebase; the recorder reason taking priority; and rebasing on a new mic session.
  - `ws2-input-summary` was updated for the new wording.
- **Check and build:** `npm run check` and `npm run build` pass. Check ran with `VOICESYNTH_PYTHON` pointing at a scratch venv, because this laptop has no repo `.venv`.
- **Real dev build** in the Chromium pane, using the test signal through the real capture worklet, YIN, VoiceInput, recorder and SLOOP:
  - **Count-in from stopped:** Count-in 4, then 3, 2, 1, about 0.5 s apart at 120 BPM. The beat cells filled 0 → 3 and bar 2 was outlined. Recording opened at "bar 2, beat 1", which matches the announced start.
  - **C4, E4, then a held G4, with Undo at 2 s:** the line went through Hearing C4, 1 note waiting to be sent, Hearing E4, 2 waiting, and Hearing G4. After Undo it said "Undo/Clear restarted capture; 3 unsaved entries were discarded. Counts restart here." Capture continued, and G4 came back as a new waiting note.
  - **Speech mode:** a released E4 showed "waiting for speech check". After the recorder's `setSpeechAvailable(false)`, the line showed "2 not kept" and the recorder's own "Speech recognition disconnected; unverified hits were discarded".
  - **Layout:** 1280×720, 1366×768 and 1440×900 had no horizontal overflow, and the strip stayed one row.
- **Browser script:** `tests/browser/ws2-recording-phase.js` repeats these checks for the integration harness. It isn't run here because Playwright isn't installed; the same steps passed when run by hand.

## Limits and next steps

- All evidence is synthetic: test tones, plus a disconnect triggered through the recorder's own method. It is not physical singing. Whether the strip actually makes bar starts easier is a human question for the next playtest.
- No per-drop reason exists for command-span, confidence or outside-window drops. If WS1's retention trace publishes bounded reason metadata, the take line can show it in place of the bare "not kept" count.
- Once WS1 merges the rhythm-snap/next-bar contract, add one compact snap selector and a start-option choice beside the phase strip. That is not started, to avoid a competing interface.
- Next: WS1 runs `ws2-recording-phase.js` in the harness. Then a human check of downbeat entry and take wording in manual and speech mode.
