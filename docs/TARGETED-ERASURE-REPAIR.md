# WS1 targeted erasure handoff

Branch: `ws1/targeted-erasure`. Review against `engine-integration`; transport/count-in/empty-startup repair is a separate feature branch. Follow PLAYTEST-REPAIR-CONTRACT.md and the current STATUS.md ledger.

## Behavior

`erase-event` applies immediately. A drum target requires its lane and removes that lane's exact grid hit. A melodic target removes the whole note occupying the requested cell, including wrapped notes. Committed removal creates one revision/history entry; provisional-only erasure creates neither. Stale commands reject. Other tracks, lanes, playback and the recording epoch continue.

The engine fences matching captured input through the application frame, inclusively. A previously valid queued performance batch keeps its command ID and unchanged surviving events, advancing its expected revision across this erase only. Already stale batches are not rescued; fully removed batches reject. Matching queued whole-pattern edits reject to prevent resurrection. Transport publishes the fence before queued acknowledgments and the new session. Later fresh input can refill the cell. A new epoch clears fences.

Deleting a currently sounding melodic note releases only that sequenced pitch; manual holds and other tracks survive. Rebuild engine assets with `python scripts/build-engine.py --docker`: the new `vs_erase_note` export is required for committed melodic erasure. Old assets reject that operation explicitly rather than using a global panic.

## Validation

- Seven focused real-WASM tests cover committed/provisional/wrapped erasure, queue preservation and stale rejection, Undo, fresh recapture, selective note release and old assets.
- Full Node suite: 177 passed, one optional skip. Shared TypeScript/Python schema checks and frontend build passed.
- Live local Python WebSocket-to-WASM integration passed with speech and LLM providers explicitly disabled.
- Chromium AudioWorklet/WASM test `tests/browser/engine-targeted-erasure.js` passed: directly submitted synthetic input kept its surviving command ID, erased input stayed absent, a whole melody note disappeared, and unrelated music/playback/recording survived.

This is engine evidence, not microphone, speech-classifier, UI eraser or human acceptance. The browser fixture uses port 5174. WS2 must consume fences without dropping unrelated local in-flight input; WS3 must invalidate stale intent jobs even when provisional-only erasure leaves the musical revision unchanged. Merge reviewed engine and consumer changes, rebuild matching WASM, then run the frozen real-device playtest.
