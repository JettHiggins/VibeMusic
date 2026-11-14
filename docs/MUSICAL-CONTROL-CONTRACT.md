# Musical control contract — immediate patch application

WS1 publication for HANDSFREE-COMPLETION.md. This section is normative; key snapping and browser-action messages are still pending separate publication. No new payload shape is needed for immediate patches: SessionCommand already permits the `immediate` boundary.

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

The same operation with `boundary:"next-loop"` remains valid. Publish matching engine support and consumer PRs before calling the preset-delay report fixed in the shared app. Engine regressions must verify acknowledgment/state before a loop boundary during playback/capture, unchanged timing/music, output continuity, Undo, stale rejection and legacy scheduling.
