# Next milestone: musical control and hands-free completion

Jett completed the `playtest-repair-1` test and reported that the actual creation process went much better. This is positive qualitative evidence, not a filled pass for every previous test. Keep the immutable tag and preserve any saved projects/local work. The following requests now supersede the freeze and the earlier research deferral.

## Product changes

- Optional project root/key + Major/Minor pitch snapping, with Off preserving existing behavior. Apply to new sung notes; offer an explicit undoable existing-track snap rather than silently rewriting music. MIDI inputs are already rounded to semitones; this request constrains neighboring detected notes to a chosen scale. Default Off and show the active key. Pending Jett's optional clarification, design for new notes plus an explicit existing-track action.
- Preset/instrument/parameter changes should be heard immediately with the existing audio-thread smoothing, not after the four-bar loop. Preserve explicit next-loop scheduling for callers that request it. Keep Undo, notes and unrelated tracks intact.
- Complete hands-free sound request → real research candidates → audible audition → accept/refine/cancel, adopting reviewed #29/#31 rather than recreating them. Make configured/unavailable/loading states truthful. No mock-only completion or preset-only substitution for the research pipeline.
- Voice timeline editing must use bounded validated operations: existing precise erase/clear/undo plus explicit note/hit edits where requested, not unrestricted whole-session replacement. Clarify targets/positions when ambiguous. Local calibration/timing/profile actions are browser orchestration, not audio-thread SessionCommands.
- Fix premature end-of-utterance processing. Do not execute intermediate/forced-split fragments as completed user intentions. Preserve true classification coverage, wake-word exclusions and audio-clock timing. Measure latency after the user finishes, not after an arbitrary segment cap. Add pause/long-sentence and command-followed-by-performance regressions.
- Treat stop-recording as a reported real-microphone failure. Existing `Groove, stop` / `Groove, stop recording` parser support is not acoustic acceptance. Capture the exact phrase/transcript and trace endpointing, wake phrase, target/take context and acknowledgments. Stop capture must preserve playback. Do not silently weaken the wake-word rule pending clarification.

## Ownership / order

1. **WS1 / Jett:** publish this plan and new contracts/examples first; engine key snapping, immediate patch application, integration, root tests and reviews. Review/unblock #29/#31, then publish the next combined test build. Do not duplicate speech endpointing or UI capture implementation.
2. **WS2 / Leo:** key/scale controls and explicit existing-track snap; immediate patch consumer/UI feedback after contract publication; provisional note preview aligned with authoritative snapping; browser calibration/timing/profile action executor and honest progress/cancel/rejection acknowledgments after WS1 publishes that interface. Preserve speech stream/capture-clock correctness when calibration changes. No hidden transport changes or calibration during an active take.
3. **WS3 / Lenny:** highest priority is premature endpointing and reliable stop-recording through actual speech; then deterministic scale/timeline/calibration commands and Deep Agents tools against published contracts. Complete/adapt #29 with actual configured research, cooperate with WS1's #31 consumer integration and retain candidate provenance/validation. Do not expand corpus/model training while user controls are missing.

Fresh owner-specific branches from current reviewed engine-integration. Preserve prior work and `.env`. Submit small PRs; WS1 merges. GitHub issue #9 and STATUS.md are the shared ledger, not live messages to laptop agents. Read at startup/capability/PR checkpoints. If a new shared interface is pending, do independent reproduction and report the exact dependency; do not invent a competing wire shape.

## Acceptance

- Off/old saves behave unchanged; enabled key snap maps new sung pitches deterministically into the selected scale, including octave/MIDI edges. Existing music changes only through the explicit undoable action. Pitch/timing/velocity, unaffected notes and drum lanes remain correct.
- While playing/recording, change presets before a loop boundary and hear/acknowledge the new patch promptly with no discontinuity or lost capture. Rapid changes settle on the final choice without a queue of obsolete presets. Explicit next-loop calls still work.
- With headphones and the configured real mic/service, complete whole spoken sentences (including a mid-sentence pause and a >4-second sound request) without premature musical edits. Verify the actual heard transcript and final action; no model job controls sample timing.
- Build a groove, stop recording by voice while playback continues, describe/audition/refine/accept a sound, edit the timeline by voice, request/cancel calibration and change the key. Reject unclear requests without mutation; report missing research/model capability before promising a result.
- Compare the next frozen build with `playtest-repair-1` on Lenny's microphone. Record exact commit, commands, timing and failures without raw audio by default. Human hands-free and fun acceptance remain required; don't infer success from typed transcripts.
