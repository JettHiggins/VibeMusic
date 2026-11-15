# Voice reliability round: WS2 handoff (compact mic workspace)

Branch `ws2/mic-workspace-cleanup` from `origin/engine-integration` at `4b9cbdc`. The pull request and exact head are listed in its description. This change touches only presentation: `apps/web/src/ui/**`, plus a focused unit test and a browser script. It does not edit `voice-input.ts`, DSP, calibration, the recorder, contracts or services. It uses only existing `VoiceInputState` fields and methods.

## Before

I reproduced this in the real dev build with Chromium at 1280×720. The microphone was on, with a long device name and a long 429 provider error with a URL.

- The page was 1481 px wide in a 1265 px viewport, so it scrolled horizontally.
- Cause: the inspector's grid track had `min-width: auto`. A long `<select>` option and unbreakable error text set its minimum content width, so the 330 px column grew past the page edge.
- Turning the mic on also showed everything at once:
  - device, profile and help text;
  - the hands-free status and privacy note;
  - noise floor and compensation;
  - readiness advice;
  - the full Microphone check (verdict, hits, notes, grid timing, pitch, normal-volume reference, browser-granted processing and report);
  - timing calibration and offset trim;
  - take counters.

## After

**Layout**
- The inspector grid is `minmax(0, 1fr)`. Selects are capped at 100%, and the panes use `overflow-wrap: anywhere`.
- Nothing hides overflow globally. Long text wraps inside its pane, and long notices are clamped to two lines with a **Full message** toggle.
- At three-column widths (≥1101 px), the inspector is sticky and scrolls on its own just below the measured transport height, so the editor and transport stay on screen.

**Always visible (Input is now first in the inspector)**
- **Enable microphone / Restart mic** and **Measure silence**.
- Status: Level OK, Too quiet, No signal or Clipping, plus the current dBFS.
- A level meter that marks the room floor and the note level from the existing pitch reading (`gateDb`).
- For synths: **Heard** (raw detected note), **Output** (the note the active key would write, shown only when it differs), and **State** (Silent, Below note level, Pitch unclear, Pitch detected or Holding note), with clarity or level details.
- For drums: the last hit level, whether it was weak, and the hit count.
- **Key**, using the same label as the key controls.
- Notices in priority order:
  1. input error;
  2. speech unavailable;
  3. take error;
  4. failed calibration;
  5. not calibrated;
  6. level verdict;
  7. pitch too quiet or unclear.
- The first notice is shown and the rest sit behind **N more notices**. Calibration notices have **Open setup**, which opens and focuses the setup section.
- Any running silence or timing measurement, from the screen or an agent request, with its countdown, progress and **Cancel**. Agent actions are labelled.
- The Hands-free commands checkbox with a short state, and **Retry speech** when unavailable.
- A one-line take summary, only when there is something to count.

**Optional sections (closed `<details>`, keyboard operable)**
- **Microphone setup**: device, capture profile, floor and compensation, timing calibration and check, offset trim, and the hands-free privacy and status note.
- **Diagnostics**: analysis p95 and the existing Microphone check, including the copyable report.

Transport, Record, Stop, Undo, Clear, track selection, the piano roll and drum grid, and the key controls are unchanged.

## Checks

- `npm test`: 251 run, 250 pass, 1 optional skip. New: `tests/ws2-input-summary.test.ts` (4 tests covering raw versus snapped pitch, gate explanations, drum hits, notice priority and deduplication, the hidden stale result during a run, and the take line).
- `npm run check` and `npm run build` pass.
- Real browser (dev server, Chromium pane, fake capture stream, injected long provider, speech and take errors, all `<details>` open):

  | Viewport | Page width | Overflowing elements |
  | --- | --- | --- |
  | 1280×720 | 1265/1265 | 0 |
  | 1366×768 | 1351/1351 | 0 |
  | 1440×900 | 1425/1425 | 0 |
  | 1024×700 (two columns) | 1009/1009 | 0 |

  - Play, Undo, Restart mic, Measure silence and the running-calibration Cancel stayed in view.
  - Checked during a silence countdown, during an actual Synth 1 recording while playing, and with the drum track.
  - Keyboard:
    - Tab reaches **Full message**, **N more notices** and **Open setup**, and each works with Enter.
    - Open setup focuses the `Microphone setup` summary.
    - Tab skips the device and profile selects while recording, because they are disabled then.
- `tests/browser/ws2-mic-workspace.js` repeats the layout and keyboard checks at the three sizes for the integration harness. Playwright isn't installed on this laptop, so I haven't run this script here. The same checks passed when run manually in the pane (table above).

## Vochlea clarity comparison (behaviour reference only)

Sources: the public Vochlea pages cited in `docs/VOCHLEA-REFERENCE.md`. No assets, layout or proprietary behaviour were copied.

| Observed reference behaviour | Our choice |
| --- | --- |
| Shows the sung pitch apart from the output note. | Heard and Output cells. Output appears only when the key changes the note, so the raw MIDI is visibly preserved. |
| Input level and sensitivity are central, and recalibration starts from the meter. | The meter shows the floor and note-level markers; Measure silence sits next to it. |
| Shows key restriction and allowed notes. | One line for the active key. Allowed-note display is a possible follow-up, not a new control. |
| Advanced functions stay out of the main performance flow. | Setup and Diagnostics are closed by default, while warnings and Cancel stay visible. |

Hypothesis: the Below note level state, with its "X of Y dBFS needed" reading, may help WS1 and testers tell a too-quiet hum apart from a segmentation miss. This needs human confirmation.

## Limits and open items

- No physical microphone or human test. The fake stream and test signal only exercise layout and states.
- Clarity and gate values are existing worklet readings. Nothing new is measured.
- The input summary shows the latest live pitch reading, refreshed at the existing UI rate. It is not a note-on/note-off trace.
- Seen in passing (WS1 owns `voice-input.ts`): the failed silence-measure result text reads "…the previous floor was kept.. The previous noise floor was kept." It has a doubled period and repeats itself.
- Optional proposal for WS1 (not needed for this UI): expose the scale's allowed pitch classes from contracts, so the key line could list them.
- Next step: WS1 runs `tests/browser/ws2-mic-workspace.js` in the integration harness, then a human check at laptop sizes with a real mic during the next test build.
