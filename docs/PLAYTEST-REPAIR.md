# Playtest repair milestone

Approved by Jett after the real-device playtest on Lenny's microphone. This supersedes earlier feature priorities. Preserve the complete voice-groovebox roadmap in PLAN.md; passing this repair does not finish the whole project.

## Reported failures and selected behavior

- Record before Play appeared stuck in an infinite count-in. Reproduce exact transport state as well as audible clicks: four count-in beats must become recording, while the newly requested continuous metronome continues as a separate state.
- Drums were hard to place on beat, and individual hits/notes could not be erased conveniently without clearing a track. Support mouse AND precise voice erasure, including provisional input.
- Background conversation interfered with synth takes; synth 3 eventually recorded no notes even with louder singing. Do not assume this is only insufficient gain: inspect pitch, target, provisional events, speech classification and commit coverage.
- Fresh launches start EMPTY: four tracks/default patches/120 BPM, no notes or hits, stopped transport. Explicit save/load remains; no automatic previous-project restore and no automatic demo song.
- Metronome is ON by default during playback and recording, accented by bar, with mouse/voice mute. Opening the app does not start sound. Metronome is not a pattern event and does not enter Undo history.
- Aggressive Noisy room cleanup is the default, even with some softened attacks/vocal artifacts. Music profile retains unprocessed capture. Keep automatic gain and echo cancellation off for headphone use, report actual browser settings and calibrate per device/profile. Do not promise removal of equally loud competing speakers with one mic.

## Ownership and order

1. WS1 publishes this plan/assignments, then shared metronome/erasure/countdown interfaces and examples BEFORE dependent implementation. WS1 owns engine/audio deadlines/metronome/targeted erasure, startup session, integration and final frozen playtest commit.
2. WS2 owns capture cleanup, profile-aware calibration, normal-volume reference measurement, performance extraction, timing feedback and visible committed/provisional event editing. Independent noisy-room reproduction can start before the new contracts; do not invent wire shapes.
3. WS3 owns noisy-room recognition/classified coverage/target transitions, diagnostics and deterministic spoken metronome/erasure commands. Independent reproduction and offline-test review can start before contracts.

Save existing work and use fresh owner-specific repair branches from reviewed origin/engine-integration. Do not stack repairs on unmerged feature heads. WS1 merges small reviewed PRs. Preserve/defer sound-search PRs #29/#31; do not expand that capability. PR #30 test isolation is independent and useful; #32 timing diagnostics may be reviewed for this repair. WS4 may continue offline evaluation without production overlap. GitHub issue #9 and STATUS.md carry coordination; laptop agents must read them themselves.

## Required transport/edit behavior

Record from stopped starts one four-beat count-in with a pinned audio-frame deadline; during playback use the next beat. A new Record while armed/recording rejects without changing the existing deadline; same-ID replay remains idempotent. Stop-recording cancels count-in or capture and preserves playback. Tempo changes reject while armed or recording. Countdown derives from the same audio clock, never UI timers/retries. Preserve explicit legacy next-loop recording for existing callers.

WS1 publishes immediate metronome(enabled) and erase-event(target, step 0..63) operations, plus transport feedback for metronome/countdown and targeted capture-erasure cutoff. Erase removes the selected lane's hit or the whole melodic note occupying that step, including loop wrap. Mouse and voice use the same operation. Affected pre-edit input cannot return; unrelated committed/provisional events and fresh later input survive. Do not implement this as full-track replacement or a global capture discard. Committed removal is one musical Undo entry; provisional-only removal has no musical Undo entry and must not resurrect unverified input. Keep existing pending-input-first Undo semantics. No automatic stale erasure replay.

Voice grammar: “Groove, erase kick, bar two, beat three”; “Groove, erase synth three, bar one, beat two, sixteenth four”; “Groove, metronome off/on”. Bars/beats/sixteenths are one-based 1..4; omitted subdivision means 1. Omitted target uses active recording target, otherwise selection. Ambiguous requests have no mutation. Familiar musical actions bypass the LLM.

## Noise and capture behavior

Default capture requests browser noise suppression; report unsupported/not-granted processing honestly. Use one sample-clock timeline with separate speech/performance conditioning, continuous silence frames and exactly-once latency correction. Profile changes invalidate incompatible calibration and restart the speech/capture stream explicitly. Preserve old raw calibration for Music profile rather than deleting it.

Measure the actual room and the user's normal-volume reference with guidance. Do not adapt the floor upward using an accepted sustained foreground voice. Distinguish no signal, insufficient foreground-to-background level, unstable pitch, pending speech verification and failed/stalled capture. No endless “sing louder” state or silent loss on the third track. Any DSP delay is included once in measured per-profile calibration. Raw audio is never persisted by default.

## Repair acceptance

- Fresh/repeated Record before Play at 60/120/180 BPM: four count-in beats -> recording; no infinite armed state, duplicated take or retry-based extension. Stop/restart/cancel and continuous metronome labels are tested separately.
- Metronome stays synchronized through playback/capture, can be muted by mouse/voice, stops with transport and is absent from musical patterns/exported research audio.
- Erase one committed and one provisional event on each drum lane/synth while playing/recording. Others survive, delayed analysis/queued batches cannot restore erased input on subsequent loops, committed deletion is undoable, and stale/ambiguous commands do nothing.
- Fresh launch is empty; explicit save/load still restores music. No automatic demo/restore.
- Normal-volume takes on all synths in orders 1-2-3 and 3-1-2, quiet then with conversation, same mic/gain. No progressive loss of detection or unexplained coverage stall. If foreground is genuinely insufficient, feedback explains placement/room action.
- Retain exact commit/browser/OS/device/profile/calibration plus timing/coverage counters, not raw recordings by default. Existing synthetic timing successes do not override the failed human test.
- WS1 publishes one frozen integrated commit. On Lenny's laptop: ten minutes building a groove, no code changes during the session; assess timing, corrections, frustration and fun. Synthetic checks/CI support, not replace, this human repair gate. Larger sound-design/listening/full-project gates remain open.
