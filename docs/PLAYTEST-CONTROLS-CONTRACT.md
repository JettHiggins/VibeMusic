# Playtest controls contract — rhythm snap, chord mode, transcript

Published by Lenny's laptop, which holds WS1 contracts while Jett is unavailable (issue #9, 2026-11-15 plan). All fields are optional and old saved sessions stay valid. Examples: `packages/contracts/fixtures/PlaytestControls.json`. Tests: `tests/playtest-controls-contracts.test.ts` and `scripts/check_contracts.py`.

## Rhythm snap

- **Setting:** `SessionState.rhythmSnap` is `sixteenth`, `eighth` or `quarter`. Missing means `sixteenth`, today's behavior.
- **Operation:** `set-rhythm-snap {grid}` is **immediate**.
  - When it changes the setting, it adds one revision and one Undo entry.
  - Setting the same value is a no-op.
  - It never rewrites committed notes.
- **Grid size:** `RHYTHM_CELLS` maps the setting to sixteenth cells per grid unit: 1, 2 or 4.
- **Committing performance:** `commit-performance` rounds each new event's start to the nearest grid unit, measured from the loop start.
  - A note's end is rounded the same way. Its duration is at least one grid unit and at most 64 cells.
  - Erase fences (`performanceCells`) use the same rounding.
- **Which setting applies:** the grid in force when a take starts is used for that whole take. A change during capture applies from the next take, so already-heard live notes never jump.
- **Effect:** at quarter, quick sixteenth notes merge onto the same beat. That is the chosen trade-off: simpler timing, less detail.

## Chord mode

- **Setting:** `SessionState.chordMode` is `off` or `triad`. Missing means `off`.
- **Operation:** `set-chord-mode {mode}` is **immediate**, with the same revision, Undo and no-op rules as rhythm snap.
- **At commit:** applied when performance is committed, after pitch snapping.
  - Each new melodic note gets `Note.chord = triadFor(root, pitchSnap)`.
  - With a key, that's the diatonic third and fifth. Without one, it's a major triad.
  - Existing notes are unchanged. Drums are unaffected.
- **`Note.chord`:** up to 3 extra MIDI pitches that share the note's step, duration, velocity and id. The firmware plays up to 4 notes per step.
  - Missing or empty means a single note.
  - Erase, Clear and Undo treat the chord as one note.
  - The piano roll draws the extra pitches as part of the same note.

## Speech transcript

- **Message:** the server sends `speech-transcript {utteranceId, streamId?, clockId, startFrame, endFrame, text, outcome, detail?}`.
- **When:** once for each recognized speech segment, after that segment's own `command-span` and command or error, for on-screen display.
- **Display only:** it is never a command and never speech coverage.
- **`utteranceId`** matches the `requestId` of related errors and the prefix of related command ids.
- **`outcome`:**

  | Value | Meaning |
  | --- | --- |
  | `command` | Acted on |
  | `refused` | Not applied; `detail` gives the reason |
  | `ignored` | Not addressed to Groove, or musical syllables during a take |
  | `held` | Waiting for the rest of the sentence |
  | `interpreting` | Sent to the language model |
  | `research` | A sound search started |

- **Size limits:** `text` is at most 1000 characters and `detail` at most 300. The UI should show the text, outcome and time; detail is optional.
