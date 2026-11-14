# Recording usability: WS1 contract and engine handoff

This capability is prepared on `ws1/recording-usability` for review into `engine-integration`. Consumers should integrate its approved merge commit, not invent equivalent fields. The browser UI and input reset consumer remain WS2 work; the backend parser/proposal changes remain WS3 work. Existing callers remain supported while those owners integrate.

## Scheduling and live edits

- `SessionCommand.boundary` adds `next-beat`, supported for `record` only. During playback it arms the next integer firmware beat; from stopped it starts playback and arms after four count-in beats. `next-loop` recording preserves the legacy four-bar wait for explicit callers. `immediate` recording remains invalid.
- Clear and Undo now permit `immediate` while playing/recording. They do not stop either transport or capture. Existing `next-loop` requests remain supported. Other boundary requirements are unchanged.
- Immediate Undo discards a still-queued performance batch before touching history. For provisional worker/recorder input not yet queued, WS2 sends `{type:'undo', discardCaptureOnly:true}`. Discard-only Undo does not change session revision or consume musical undo history. Normal Undo restores the last musical edit and increments revision.
- All commands still check expectedRevision; unrelated session mutations can make queued absolute commands stale. This capability does not silently rebase commands. Capture-discard/epoch/window rejections are terminal for old events, not revision retries.

## Authoritative capture reset

Transport adds optional `recordingEpoch`, `captureStartFrame`, and `recordingLoopStartFrame`, retained with the latest recording window after stop. A new take increments recordingEpoch. Clear of the active lane/track and Undo increment it again, set captureStartFrame to editFrame + 1, and cancel queued performance batches with reason `Capture discarded by live edit`. Clearing a different lane/track leaves the active capture epoch unchanged. Cutoff applies even to a retained stopped window, so delayed final audio cannot restore cleared music.

The engine emits an immediate transport snapshot containing the reset **before** cancelled-batch acknowledgments. The take's recordingStartFrame stays unchanged and recording remains true if it was active. The valid capture interval begins at captureStartFrame; events at/before the edit frame are discarded. This is the calibrated performance timeline, not raw mic receipt time.

`commit-performance` adds optional `recordingEpoch`. New consumers send it; mismatches reject. Legacy callers without it are still constrained by captureStartFrame, the recording window and existing clock/verification checks. Clients must never resubmit discarded old events with a new epoch.

recordingLoopStartFrame is the recording window's musical grid origin. Use it for provisional step/duration placement, **not recordingStartFrame**, because a new take can start at beat 2 or bar 2 of the four-bar composition. It normally equals a real loop start. Undoing a prior tempo edit can require a signed/fractional virtual origin preserving firmware beat/phase; it is a grid anchor, not a captured event timestamp. Session tempo and the updated origin then describe fresh events after the cutoff. Event timestamps remain nonnegative integer frames.

## WS2 integration checklist

1. Send Record at next-beat; send Clear/Undo at immediate. Keep the four-bar pattern and next-loop performance commits.
2. On a new recordingEpoch, clear provisional/submitted capture, replaced-command bookkeeping, and retry state for the old epoch. Ignore its later terminal acks; do not label intentional cancellation as lost input. Initialize the latest window/cutoff from transport even if recordingStartFrame did not change.
3. Reset pitch/open-note and onset state at the cutoff, dropping pre-cutoff analysis. Convert the calibrated cutoff to raw capture frames by adding the current latency once; outgoing musical events still subtract latency once. If a worker result arrives late, filter it against the current epoch/cutoff. Do not flush a pre-edit held note back into the track.
4. Attach recordingEpoch to new batches and project live feedback from recordingLoopStartFrame. If provisional input exists when Undo is pressed, use discardCaptureOnly; otherwise normal Undo.
5. Keep Clear/Undo available during capture. Cancel conflicting unsent UI edits locally when the user explicitly clears/undoes them; do not blindly retry pre-edit intentions as stale commands.

## WS3 integration checklist

- Record proposals use next-beat; Clear/Undo use immediate. Stop-recording still cancels count-in and preserves playback/revision.
- Accept/store the added transport fields through the generated schema. Do not infer speech verification from them.
- Normal backend Undo remains a normal proposal. WS2 must account for its local provisional capture before dispatching that proposal, preserving the command ID and acknowledging the actual operation. No speech audio contract or provider decision is implied here.

## Validation and review

Wire examples: `packages/contracts/fixtures/RecordingUsability.json`, validated by TypeScript and Python. Real-WASM tests cover 120/137 BPM, next-beat starts, stopped one-bar count-in, correct mid-loop placement, immediate Clear, cutoff-before-ack ordering, epoch/legacy rejection of late audio, fresh capture after edits, discard-only versus musical Undo, unrelated-lane isolation, tempo Undo and count-in cancellation. Existing loop/renderer/input tests remain required.

Patch-output smoothing is a separate preceding commit (`735f122`), blending the prior stereo output sample into the new output over five milliseconds without delaying the firmware clock. Human listening has not validated that change.

Review does not establish calibrated microphone performance on Lenny's laptop or the complete hands-free acceptance scenario. Those remain explicit human/device gates in STATUS.md.
