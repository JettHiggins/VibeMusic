# Musical control contract

WS1 publication for MELODY-RETENTION-ROUND.md. The sections below are normative; producers/consumers wait for the corresponding engine/executor support before enabling actions. No new payload shape is needed for immediate patches: SessionCommand already permits the `immediate` boundary.

`apply-patch` now supports **immediate OR next-loop**. `next-beat` remains invalid. Existing explicit next-loop callers keep their behavior. New interactive preset/engine/parameter selection and accepted voice sound choices should use immediate so the user hears the choice without a four-bar wait. Backend model latency never schedules audio samples.

- Validate expectedRevision, metadata/engine revision and parameters before mutation. Invalid/stale choices leave patch, notes, capture and transport unchanged. No automatic engine-side stale rebasing.
- Immediate means the audio thread handles the request at its next processing opportunity; it does not mean zero device/network latency. Do not queue it to a musical boundary.
- Preserve notes, hits, tempo, unrelated tracks, loop phase and capture epoch. A musical patch edit advances revision and creates one Undo entry under the existing rules.
- Use the existing five-millisecond output transition for patch changes. Do not perform inference, downloads or asset decoding inside the callback.
- WS2's latest-wins PatchEditQueue switches to immediate and reports applying/applied/rejected, removing the “next loop” promise. Preserve its one-in-flight, final-choice coalescing and bounded stale retry behavior. Do not resubmit obsolete choices in order.
- WS3 applies the same boundary to deterministic/model patch operations and accepted real research candidates. Reject incomplete or unknown candidate references as before.

Example, using a real metadata-valid patch (replace placeholder parameters with the chosen descriptor's valid values):

```json
{"id":"choose-preset-1","expectedRevision":7,"boundary":"immediate","operation":{"type":"apply-patch","trackId":"synth-1","patch":{"engine":1,"preset":0,"parameters":{},"engineRevision":"bac9c05ea7627449405aa10e48da21d75b6c8c56"}}}
```

The same operation with `boundary:"next-loop"` remains valid. Matching engine and consumers are integrated. Engine regressions must verify acknowledgment/state before a loop boundary during playback/capture, unchanged timing/music, output continuity, Undo, stale rejection and legacy scheduling.

## Optional pitch snapping — published wire and mapping

`SessionState.pitchSnap` is optional and nullable. Missing or null means Off, including all old saved projects. Otherwise it is `{root:0..11,scale:"major"|"minor"}`: C=0, C-sharp/D-flat=1 through B=11. Minor means natural minor. There is no automatic key detection or forced default scale. New schema versions must be loaded on both browser and service; older strict clients cannot consume the new optional field/messages.

- `set-pitch-snap(settings)` is an immediate SessionCommand. It changes only the setting, with one musical revision/Undo entry when the setting changes; it does not rewrite committed notes. Equivalent setting is a no-op. It may act during playback/capture without moving the recording deadline, audio clock or epoch.
- `commit-performance` maps accepted sung `note` MIDI values with the session's current setting **at commit time**. Off preserves the input. Newly committed provisional input follows the latest setting; already committed music is unchanged. Drums, timing, duration, velocity and event IDs are untouched. GUI/explicit timeline note edits remain exact pitches rather than a master output filter.
- `snap-notes(trackId)` explicitly maps that melodic track's existing notes using the current enabled setting at application time. It requires `next-loop`, rejects drums or Off, preserves event identities/timing/velocity/other tracks, and creates one Undo entry when pitches actually change. If all notes already fit, no revision/history change. Its scheduled behavior avoids mid-note voice replacement; the UI must show that it applies next loop.
- Shared `snapMidiToScale` is exported from packages/contracts. It chooses the closest in-range MIDI pitch, with equal distances choosing the lower pitch, respecting MIDI 0..127. Major intervals: 0,2,4,5,7,9,11; natural minor: 0,2,3,5,7,8,10. UI provisional preview uses this helper, while retaining original raw MIDI in performance events so the engine remains authoritative. Do not quantize/relabel the capture timestamp or apply pitch snapping twice before submitting.
- Existing stale-revision/idempotency/capture rules remain. A key change does not grant a new engine-side revision bypass for queued performance; normal consumer retry uses the newest snapshot. An armed Record retains its existing pinned deadline/target.

Suggested deterministic phrases: “key D minor”, “turn key snapping off”, “snap the existing notes on synth two”. An ambiguous root/scale/track must not mutate; ask for clarification. Root aliases such as F-sharp/G-flat resolve to the same number.

## Browser-local input actions — published wire

These are **not SessionCommands**, not patch candidates and not Undo entries. No audio, secret, device identifier or recording is sent. The ClientMessage `browser-status` reports `clockId`, monotonic `inputRevision`, `available`, microphone state, profile, numeric calibration (or null), active action (or null) and optional bounded guidance. `available:true` means the executor is implemented, not that every action is currently permitted. No status / available:false means WS3 refuses rather than promising calibration. Emit snapshots on connection/configuration/action progress; do not stream every audio block.

ServerMessage `browser-action` is `{id,clockId,expectedInputRevision,operation}` with exactly one of:

- `{type:"calibrate-input",mode:"noise"|"timing"|"check-timing"|"full"}`. Full runs guided room measurement then guided timing, not an invented measurement. Reuse the existing preparation/practice/cancel UI and real analysis results.
- `{type:"cancel-input-action",actionId}`. Cancel only the named active action, not an unrelated/newer run.
- `{type:"set-input-profile",profile:"noisy-room"|"music"}`. Use existing profile/device-specific calibration and capture constraints, and show the granted processing honestly.
- `{type:"set-input-offset",milliseconds:-150..150 integer}`. An absolute trim in milliseconds, not frames or an unbounded gain change. Preserve the measured latency and use exactly-once compensation.

ClientMessage `browser-action-ack` is `{id,clockId,inputRevision,status:"running"|"complete"|"cancelled"|"rejected",reason?}`. A submission receipt is not completion. Send running only for actual started work, publish the new browser-status before terminal acknowledgment, and send complete only when the real operation succeeds. Failed/insufficient-quiet calibration is rejected with its actual cause and retains the previous valid calibration. Cancellation does not invent a successful calibration.

### Executor and backend invariants

1. The browser validates payload, actual AudioContext clock and expectedInputRevision before work; reject stale/unknown state without effects. Increment inputRevision on device/microphone connection, profile and applied calibration/offset changes; reset it only with a new clock. Progress alone does not change it. A different device/profile/configuration cancels old work; a late result must never overwrite the new configuration.
2. Cache each action ID with its exact payload/status for the socket lifetime. Identical duplicates replay current/terminal acknowledgment without rerunning clicks or restarting a deadline; conflicting reuse rejects. One active mutating input action at a time; only cancellation of that exact action may interrupt it. Retain at most 4096 distinct request records per socket; at capacity reject unseen IDs until a fresh socket, rather than evicting an old ID and accidentally rerunning it. Duplicate known IDs still replay their recorded outcome.
3. Reject calibration/profile/offset during armed/active recording or unsettled provisional/in-flight performance. No hidden Clear, stop, transport restart or pending-input discard. Noise/timing/full/check-timing calibration additionally requires stopped playback and an active mic; explain that the user should stop playback first. Profile/offset may act while playback continues once capture is idle/settled.
4. Calibration/profile/offset changes must preserve speech correctness: end the old stream, discard its unverified coverage under existing stream/epoch rules, restart/reconnect with current latency/profile and report readiness. Never use an old watermark to verify the new input path or silently fall into unverified manual mode. Backend utterance/model jobs bind the input clock/revision and must be discarded on configuration changes. No browser action changes the engine SessionState revision, notes, patches or Undo history.
5. Backend binds IDs to the current socket/clock/revision, checks actual advertised capability/state and validates every model result. Await browser outcome; a model cannot mark completion or invent calibration values. A result from a prior socket/clock/action cannot finish the current action. Unknown actions/status are rejected, not routed to the engine queue. Connection loss cancels local in-progress orchestration and reports it; never replay calibration automatically on reconnect.

Examples are in fixtures/MusicalControls.json and validated in TypeScript and Python. WS2 owns the executor and state/lifecycle regression tests. WS3 owns deterministic phrases/Deep Agents action tools, guarded pending requests and real acknowledgment handling. The interface publication itself does not enable either side or prove physical calibration/hands-free success. Existing stop-recording wake-word semantics are unchanged by this contract; endpointing/stop failures remain the independent highest-priority speech repair.

### TypeScript integration seam

WS2 exposes BrowserActionAdapter on VoiceInput (or a thin adapter): getBrowserStatus() returns a snapshot or null before an audio clock exists; handleBrowserAction(action) starts validated asynchronous work and emits acknowledgments through subscribeBrowserActions(listener). cancelBrowserActions(reason) cancels agent-owned work on disconnect, preserving unrelated manually started UI calibration. WS1 owns routing in coordinator/main: send the current status on connect, forward emitted status/acks, dispatch only browser-action to this executor, and cancel agent-owned work on disconnect. Existing EngineAdapter/SessionCommand dispatch is unchanged. Do not make backend availability imply executor completion.

### Routing context clarification

Browser-action IDs must be freshly generated across reconnects, not reset counters reused for new requests. The bridge retains a bounded per-page ID ledger to keep old results from binding new actions. A bridge guard rejection (for example, no executor attached) may echo the request's clock and input revision for correlation; it does not assert a measured/current input state. Backend configuration is updated only from browser-status, never inferred from an acknowledgment. Identical duplicates on the current connection still reach the executor's idempotency cache. VoiceInput.handleServerMessage must not dispatch browser actions a second time; coordinator routing owns that dispatch.
