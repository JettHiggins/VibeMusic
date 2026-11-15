# Recording scheduling and live-edit contract

Current scope: [MELODY-RETENTION-ROUND.md](MELODY-RETENTION-ROUND.md) and [STATUS.md](STATUS.md). Test a recorded current integration commit and restart both app/service after pulling.

The engine, input consumer and service are integrated. The following timing/reset semantics remain normative; current assignment and validation evidence lives in STATUS.md.

## Scheduling and live edits

- `SessionCommand.boundary` adds `next-beat`, supported for `record` only. During playback it arms the next integer firmware beat; from stopped it starts playback and arms after four count-in beats. `next-loop` recording preserves the legacy four-bar wait for explicit callers. `immediate` recording remains invalid.
- Clear and Undo now permit `immediate` while playing/recording. They do not stop either transport or capture. Existing `next-loop` requests remain supported. Other boundary requirements are unchanged.
- Immediate Undo discards a still-queued performance batch before touching history. For provisional worker/recorder input not yet queued, WS2 sends `{type:'undo', discardCaptureOnly:true}`. Discard-only Undo does not change session revision or consume musical undo history. Normal Undo restores the last musical edit and increments revision.
- Every command checks expectedRevision on receipt. An armed Record pins its target/deadline and survives later unrelated session changes; its application selects that explicit target against the current state. Consumers must not re-issue an already armed Record when revision changes, which could alter its count-in. Other queued musical edits still recheck revision at application; this is a documented transport-intent exception, not generic musical-edit rebasing. Capture-discard/epoch/window rejections are terminal for old events, not revision retries.

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

## Implementation invariants

Applied acknowledgments retain the existing shape; the consumer labels discard-only versus musical-history Undo using its own request/pending state. discardCaptureOnly requires a retained/current recording window. Tempo remains next-loop and rejects during capture. Explicit Clear/Undo cancels conflicting queued pattern intentions, including discard-only Undo without a revision change; do not retry them. Armed Record is never automatically reissued.

## Consumer verification

VoiceInput.prepareCommand is shared by UI and backend proposal paths. Epoch changes clear old flight/replacement/retry state; workers reset without flushing old notes, and late pre-cutoff results are terminal. Consumers project against the composition grid origin, not the take start. tests/browser/recording-consumer.js, input-pipeline.js, next-beat-melody.js and melody-pipeline.js cover real worklet/worker/recorder/WASM paths using synthetic input. Physical acceptance remains separate.
