# WS2 handoff: low/high live-note range visibility

Branch `ws2/live-note-range` from `origin/engine-integration` at `447541f`. Pull request: JettHiggins/VoiceSynthesizer#44. Implementation commit: `4715bf7`. Presentation only: `apps/web/src/ui/PianoRoll.tsx`, `piano-roll-geometry.ts` and one prop in `Groovebox.tsx`. It does not change capture, YIN, the recorder, key mapping, contracts or what gets saved.

## Before

The piano roll shows a fixed 25-row window (C3–C5 by default) that moves only with ▲/▼ Oct. A live or queued note outside that window was dropped from the render. Singing G2 or C6 while recording captured the note, but nothing appeared. Saved notes outside the window showed only as a count in the help text. Live, released and sent notes all looked identical (dashed).

## After

- **Follows sung notes.** When the note being sung (or else the latest queued one) is outside the view, the roll moves by whole octaves until the note is at least two rows from the edge. Octave steps keep the C labels where the performer expects them.
- **Manual navigation wins.** Pressing ▲ Oct, ▼ Oct, Center or an edge marker while a take is on screen pauses following until the live and queued notes are gone. The roll never pulls the view back while the user is looking elsewhere.
- **Edge markers.** Notes above or below the view get a marker on the top or bottom edge, at the step of the nearest note: `↑ C6`, `↓ G2 +1`. Unsaved notes are prioritised and drawn brighter; saved ones are dashed and muted. Click it, or press Enter on it, to show that note. The accessible name is "Show G2 (2 notes below view)".
- **Visible range.** A `C2–C4` label sits next to the Oct buttons. The help line says "N notes outside view (1 above, 2 below)" as a status.
- **Provisional styling** (monochrome tokens):
  - still singing: solid bright outline, light fill, note name, "(still singing)" in its accessible name;
  - heard and waiting for the loop: dashed (as before), now labelled with the note name;
  - sent to the engine: dotted and fainter.
  - Every one keeps the `Erase provisional <note> step N` accessible name that the WS1 browser scripts use.

## Checks

- `npm test`: 275 run, 274 pass, 1 optional skip. New: `tests/ws2-piano-roll-range.test.ts` covers the side and nearest-first ordering, octave-step following with margin, clamping at MIDI 0 and 127, and that every pitch from MIDI 36 to 96 becomes visible from the default view.
- `npm run check` passes. On this laptop it ran with `VOICESYNTH_PYTHON` pointing at a temporary venv, because there is no repo `.venv` here. `npm run build` passes.
- Real dev build in the Chromium pane, using the test signal through the real capture worklet, YIN worker, VoiceInput, recorder and SLOOP. No physical microphone.
  - G2 held for 1.2 s, then C6 for 1.2 s, from C3–C5:
    - view went C3–C5 → C2–C4 within the first frame of the live G2;
    - then went to C5–C7 for C6;
    - each live note stayed inside the grid for every sampled frame while held;
    - G2 then showed `Show G2 (1 note below view)`.
  - G2 held for 2 s, with ▲ Oct pressed at 0.8 s:
    - view followed to C2–C4, then stayed on C3–C5 after the press for the rest of the hold;
    - the held G2 was marked at the bottom edge throughout.
  - Clicking the marker moved the view to C2–C4.
  - No horizontal overflow at 1024 px.
- `tests/browser/ws2-live-note-range.js` repeats those checks for the integration harness. It isn't run here because Playwright isn't installed on this laptop; the same steps passed when run by hand in the pane.

## Limits and next step

- Synthetic tones only. Physical singing near the vocal extremes, and whether octave jumps feel comfortable during a fast phrase, need the human check in STATUS.
- Following targets the latest live or queued note. A phrase that alternates between very low and very high notes in one take will keep jumping. The markers keep the other notes findable, but nothing is scaled to fit.
- Drum grid is unchanged (no pitch range).
- Still open from the earlier PR: the meter aria-range clamp.
- Next: WS1 runs `tests/browser/ws2-live-note-range.js` with `live-piano-preview.js` in the integration harness, then the low/high hum check from STATUS with a real mic.
