# PR 40 input-action review

Reviewed exact WS2 head 255c4dd4d16771bcc6c95c619a8004f1062a7ee4, stacked on combined WS1 dcc0370. The visible key controls and the shared-helper preview retain raw MIDI correctly. Existing-track snap is explicit, scheduled and undoable. Coordinator owns the single action dispatch. No approval of the parent WS1 branch is inferred from this stacked PR.

## Validation

Published tests: Node 237 passed / one optional skip; 15 focused key/executor tests passed; shared checks and production build passed with the existing development Python environment. Chromium actual key controls: selecting C major leaves music unchanged; Snap maps seeded G-sharp to G; Undo restores it; Off disables Snap. This is real UI/WASM with seeded music and synthetic silence, not a physical microphone or acoustic speech test. Root browser regression is on ws1/review-ws2-musical-controls, tests/browser/ws2-key-controls.js.

## Changes requested before integration

1. **Keep agent and screen calibration ownership separate through reconnection.** Start hands-free with a ready stream, send set-input-offset, and wait for activeAction.phase=reconnecting. VoiceInput.calibrateNoise() can now start from the screen (the UI enables Measure silence because state.calibrating is null). cancelBrowserActions then cancels that unrelated manual TimedRun via this.run?.cancel(). This violates scoped disconnect/cancel. Refuse manual starts throughout active agent orchestration, or retain the exact agent-owned run and never cancel a newer manual one. Cover both click-accessible path and adapter lifecycle.
2. **Revalidate an active calibration when transport changes.** Start agent noise calibration, advance to measuring, then receive a transport with playing=true / recordingState=armed. Resolving noise at -43 still applies it and reports complete, replacing the prior -60 floor during the armed take. The initial guard is insufficient because Record/Play remain usable while the async measurement runs. Cancel/reject pending calibration before its result applies when playback/capture makes it invalid; stop scheduled calibration clicks, preserve prior valid settings, and do not silently stop/restart transport. Check timing/full as well as noise and late measurement callbacks.

Both failures were reproduced independently of the published tests. Apply PR40-lifecycle-reproduction.patch at repository root on the reviewed head, then run:

```sh
node --import tsx --test --test-name-pattern='review:' tests/browser-action-executor.test.ts
```

Observed: two failures, zero passes. First assertion: manual measurement starts then gets cancelled by agent disconnect. Second assertion: calibration object changes noiseFloorDb -60 → -43 / noiseSource measured after the take is armed. The patch only appends tests using the existing harness; it is supplied as a review artifact rather than adding known failing tests to the ordinary suite.

Leo owns the executor correction and regression coverage. Keep this PR unmerged pending the updated exact head and WS1 re-review. Parent WS1 review is still needed; WS3 endpointing, spoken stop and new browser/key/timeline producers remain separate unfinished requirements. Physical calibration and hands-free/fun acceptance remain open.
