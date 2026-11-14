# Integration handoff

## Verified foundation

Milestone 0 is available on `engine-integration` (foundation a19badd). Build instructions and exact subsystem seams are in SETUP.md and CONTRACTS.md. Main is still the documentation baseline; implementation is on feature branches.

## Current integration

- Real pinned SLOOP audio, four-bar demo, transport and boundary-scheduled tempo/clear/undo work in the browser harness.
- Workstream 3's deterministic transcript service (3a62724) is merged into this branch. No provider credentials or live AI calls are configured.
- The production WebSocket adapter and coordinator connect that service to the real engine. Browser selection via transcript and live Python/WASM revision feedback have been exercised.
- Validation: upstream native/WASM parity for all 12 engines; engine contracts/clock tests including a ten-minute offline render; 62 backend tests; dedicated live-service integration test; TypeScript and production web build. Offline clock tests do not establish ten-minute glitch-free browser audio or cross-platform hardware latency.

## Workstream 2 next integration

Use BrowserEngine via EngineAdapter and the existing coordinator. Own UI/input/persistence directories as documented. The engine now supports performance-batch submission, shared capture clock access via BrowserEngine.getAudioContext(), and recording/count-in state. See the additive v1 recording contract and fixtures. Editing and load commands are now available; see EDITING.md for edit-pattern, volume, load-session, and real note/drum auditions. Save/export uses the authoritative session snapshot; storage/UI remains Workstream 2. The harness's transcript field is not a microphone implementation. Server command-span events must reach the provisional-event buffer before commit.

## Workstream 3 next integration

Rebase/merge the updated engine-integration contracts before further backend changes. Keep implementing in services/agent. Continue research renderer integration and provider-independent work while API access is deferred. Deep Agents and speech-provider work still require a credential decision. Engine recording windows now work, but microphone input is not attached and research orchestration is merged, with a real engine renderer available but CLAP not yet configured; do not mark these user flows complete.

## Remaining product gates

Full editable/persistent groovebox UI, microphone timing/calibration and recognition, actual microphone-to-engine recording, speech-span buffering and verification, Deep Agents, patch retrieval/optimization/audition, cross-platform validation, and the complete hands-free acceptance session. The active goal remains the full product integration, not just the pieces verified above.

Recording engine validation now includes WASM count-in/downbeat activation, canceling armed takes, quantized selected-lane commits, stop-recording preserving playback, and pure timing/phrase-replacement tests. Actual microphone latency, recognition, and count-in audibility on each teammate laptop still need verification.

## Offline renderer for Workstream 3

The research framework from agent-sound-research (c319487) is merged. Use `tools.sloop_renderer.SloopRenderer` as the implementation of research.audio.Renderer; see RENDERER.md. It accepts the existing RenderRecipe and complete Patch, returns mono float32 at 44100 Hz, and launches the actual pinned WASM in a separate Node process. The renderer name includes a SHA256 of WASM plus metadata for reproducibility. Browser snapshot validation now accepts complete patch arrays while preserving session-controlled timing and mix. No CLAP embedder is configured and mock ranking is not enabled automatically. Workstream 3 can now wire its real embedder into ResearchBackend without building another synth.

## Reconciled research backend

Research update 6c6ab89 is integrated. Its service/cache configuration and tests are retained; research.sloop delegates to the canonical engine renderer instead of maintaining a second WASM parameter mapper. The optional sloop/mock-embedder configuration produces actual SLOOP previews with clearly labeled nonsemantic ranking. Default remains unconfigured; CLAP and blind listening are not done. Disk-cache retrieval now restores real preview audio, with a regression test. Full backend testing includes real renders; see services/agent/README.md for the longer live-service research test.

The live research integration test passed after reconciliation: real corpus rendering, retrieval progress, WAV downloads, candidate acceptance on an existing melody, and undo. The cold test took approximately 73 seconds on this Linux machine (factory corpus plus bounded refinement); it uses the explicitly MOCK embedder and does not establish semantic ranking or CLAP latency. Run `npm run test:research-integration` with the virtualenv active.

Connection race fixes: record requests are tracked before armed transport feedback, so immediate disconnect can cancel them. Replaced socket callbacks cannot disconnect or inject messages into a new connection. Tests cover both races and cancellation before any audio callback. Vite hot reload now disposes audio/socket resources.
