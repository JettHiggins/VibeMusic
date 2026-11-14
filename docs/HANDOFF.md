# Integration handoff

## Verified foundation

Milestone 0 is available on `engine-integration` (foundation a19badd). Build instructions and exact subsystem seams are in SETUP.md and CONTRACTS.md. Main is still the documentation baseline; implementation is on feature branches.

## Current integration

- Real pinned SLOOP audio, four-bar demo, transport and boundary-scheduled tempo/clear/undo work in the browser harness.
- Workstream 3's deterministic transcript service (3a62724) is merged into this branch. No provider credentials or live AI calls are configured.
- The production WebSocket adapter and coordinator connect that service to the real engine. Browser selection via transcript and live Python/WASM revision feedback have been exercised.
- Validation: upstream native/WASM parity for all 12 engines; engine contracts/clock tests including a ten-minute offline render; backend suites and live-service integration; TypeScript and production web build. Offline clock tests do not establish ten-minute glitch-free browser audio or cross-platform hardware latency.

## Workstream 2 next integration

Use BrowserEngine via EngineAdapter and the existing coordinator. Own UI/input/persistence directories as documented. The engine now supports performance-batch submission, shared capture clock access via BrowserEngine.getAudioContext(), and recording/count-in state. See the additive v1 recording contract and fixtures. Editing and load commands are now available; see EDITING.md for edit-pattern, volume, load-session, and real note/drum auditions. Save/export uses the authoritative session snapshot; storage/UI remains Workstream 2. The harness's transcript field is not a microphone implementation. Server command-span events must reach the provisional-event buffer before commit.

## Workstream 3 next integration

Rebase/merge the updated engine-integration contracts before further backend changes. Keep implementing in services/agent. Continue research renderer integration and provider-independent work while API access is deferred. Deep Agents and speech-provider work still require a credential decision. Engine recording windows now work, but microphone input is not attached and research orchestration is merged, with a real engine renderer available but CLAP not yet configured; do not mark these user flows complete.

## Remaining product gates

Full editable/persistent groovebox UI, microphone timing/calibration and recognition, physical microphone validation, real speech classification and its verification watermark, Deep Agents, patch retrieval/optimization/audition, cross-platform validation, and the complete hands-free acceptance session. The active goal remains the full product integration, not just the pieces verified above.

Recording engine validation now includes WASM count-in/downbeat activation, canceling armed takes, quantized selected-lane commits, stop-recording preserving playback, and pure timing/phrase-replacement tests. Actual microphone latency, recognition, and count-in audibility on each teammate laptop still need verification.

## Offline renderer for Workstream 3

The research framework from agent-sound-research (c319487) is merged. Use `tools.sloop_renderer.SloopRenderer` as the implementation of research.audio.Renderer; see RENDERER.md. It accepts the existing RenderRecipe and complete Patch, returns mono float32 at 44100 Hz, and launches the actual pinned WASM in a separate Node process. The renderer name includes a SHA256 of WASM plus metadata for reproducibility. Browser snapshot validation now accepts complete patch arrays while preserving session-controlled timing and mix. No CLAP embedder is configured and mock ranking is not enabled automatically. Workstream 3 can now wire its real embedder into ResearchBackend without building another synth.

## Reconciled research backend

Research update 6c6ab89 is integrated. Its service/cache configuration and tests are retained; research.sloop delegates to the canonical engine renderer instead of maintaining a second WASM parameter mapper. The optional sloop/mock-embedder configuration produces actual SLOOP previews with clearly labeled nonsemantic ranking. Default remains unconfigured; CLAP and blind listening are not done. Disk-cache retrieval now restores real preview audio, with a regression test. Full backend testing includes real renders; see services/agent/README.md for the longer live-service research test.

The live research integration test passed after reconciliation: real corpus rendering, retrieval progress, WAV downloads, candidate acceptance on an existing melody, and undo. The cold test took approximately 73 seconds on this Linux machine (factory corpus plus bounded refinement); it uses the explicitly MOCK embedder and does not establish semantic ranking or CLAP latency. Run `npm run test:research-integration` with the virtualenv active.

Connection race fixes: record requests are tracked before armed transport feedback, so immediate disconnect can cancel them. Replaced socket callbacks cannot disconnect or inject messages into a new connection. Tests cover both races and cancellation before any audio callback. Vite hot reload now disposes audio/socket resources.

## Microphone/input integration

ui-input (3426bee) is merged: manual microphone drum takes, onset worker, calibration, provisional recorder, input panel, and session-file helpers. Review found/fixed retained lane selection, kick chirp double triggers, synthetic latency compensation, and delayed per-hit batches. The browser diagnostic now commits four synthetic kicks by the following loop through real worklets/workers/WASM, with continued playback and about 3.2 ms analysis p95. Physical microphones, real performers, speech recognition, melody/YIN, full editor/save-load UI, and hands-free acceptance still need completion. speech-verified is accepted as a schema/consumer seam; no backend emits it without real classification.

Platform CI at ff44fd5 passed Linux firmware parity, macOS and Windows integration/engine tests, and browser builds (GitHub run 43577262985). This precedes the microphone merge; its new CI run must be checked separately. General CLAP opt-in feature tests passed locally from cached real weights. The music checkpoint probe was rejected with unrelated-text cosine about 0.999; no music-checkpoint or blind-listening success is claimed.

## Melody and groovebox UI integration

ui-melody (13f67ed) is merged: worker YIN/note segmentation, melodic takes and corrections, compact four-track UI, pattern editor, sound parameters/presets, local save/load and JSON import/export. Preserve the engine replacement-batch protocol when updating the recorder: notes wait for their end-frame verification, later completed notes replace the still-queued batch, and stop-recording does not bump session revision. Edit and sound panels remain mounted across tabs so their pending queues receive authoritative acknowledgments.

Validation on Linux: shared schema/type checks, complete Node suite, live Python/WebSocket/WASM integration and production build pass. Real-WASM melody tests now require completed notes by the following loop rather than allowing two extra loops. Browser diagnostic tests/browser/melody-pipeline.js captured eight synthetic sung notes through the actual capture worklet/analysis worker/recorder/WASM path, then replaced one note while preserving the other seven. Both takes applied by the following loop, playback continued, and analysis p95 was about 6.2 ms. The test schedules its input after the diagnostic graph has time to initialize. This does not measure physical microphone latency or real singing. Basic Pitch benchmark results from Workstream 2 are in docs/benchmarks/basic-pitch.md; they cover synthetic voices on CPU, not real recordings.

Remaining gates include real microphone/performer validation on teammate machines, speech recognition and classification/watermarks, Deep Agents (API access remains deferred), compatible CLAP music-checkpoint inference, blind listening, and the complete hands-free acceptance session. Older remaining-work notes above describe earlier commits.

## Browser research controls

The Agent workspace now includes sound-description requests, job progress/cancellation, candidate provenance and scores, WAV preview players, and exact-candidate acceptance with authoritative queued/applied/rejected feedback. Requests bind to their original synth track even if selection changes. Later or disconnected jobs cannot overwrite current results. Candidate acceptance uses the existing apply-patch command at the next loop; undo remains available in the groovebox. Editing the description starts a new search; seed-based refinement is still available through the service's transcript seam, not a dedicated candidate refinement control.

Validation: controller race/track/ack tests, shared checks, full Node suite, production build, browser rendering/acceptance fixture (tests/browser/research-panel.js), and actual default-service unavailable feedback. The extended live research test passed with real SLOOP corpus/preview audio, both transcript and browser-controller acceptance, continuing melody and undo, around 76 seconds cold. The embedder is explicitly MOCK; the browser fixture uses labeled placeholder candidates. These checks do not prove semantic quality, subjective listening or hands-free operation. No API credential setup or live inference API was used.

## Original CLAP music weights now run locally

The public converted music checkpoint loaded fully but gave unrelated text similarity about 0.999. The original music checkpoint listed by LAION contains different text weights and passes real inference checks after strict tensor-name conversion. Local CLAP mode now defaults to that pinned original release; config/tokenizer, source weights and conversion version identify the corpus. See CLAP.md for source links, immutable revisions, restricted memory-mapped loading and reproduction. General-checkpoint mode remains an explicit comparison. No inference API/key was used.

Validation: 99 base backend tests passed, two real-model tests passed separately, conversion/degeneracy guards pass, and shared project checks pass. An actual corpus built all 153 presets (zero rejected), followed by a complete 128-variation “80s electric piano” search (zero rejected). Warm retrieval was 0.1 seconds and search completed in 78.21 seconds on this Linux CPU. Similarity rose from 0.4213 to 0.4606; that is not listening evidence. The top factory label was PHYS / TIMPANI, so the instrument-matching quality gate remains open. The single-prompt blind A/B pair, sheet and separate answer key are in ignored artifacts/evaluation-music-original-electric-piano. The full fixed-prompt three-person blind comparison is not done, nor is native-LAION numerical parity or physical/cross-platform model inference validation.
