# Integration handoff

## Verified foundation

Milestone 0 is available on `engine-integration` (foundation a19badd). Build instructions and exact subsystem seams are in SETUP.md and CONTRACTS.md. Main is still the documentation baseline; implementation is on feature branches.

## Current integration

- Real pinned SLOOP audio, four-bar demo, transport and boundary-scheduled tempo/clear/undo work in the browser harness.
- Workstream 3's deterministic transcript service (3a62724) is merged into this branch. No provider credentials or live AI calls are configured.
- The production WebSocket adapter and coordinator connect that service to the real engine. Browser selection via transcript and live Python/WASM revision feedback have been exercised.
- Validation: upstream native/WASM parity for all 12 engines; engine contracts/clock tests including a ten-minute offline render; 62 backend tests; dedicated live-service integration test; TypeScript and production web build. Offline clock tests do not establish ten-minute glitch-free browser audio or cross-platform hardware latency.

## Workstream 2 next integration

Use BrowserEngine via EngineAdapter and the existing coordinator. Own UI/input/persistence directories as documented. The engine still needs performance-batch submission, capture clock access, recording/count-in state, and editing/import/export command seams; propose these contracts with Workstream 1 before depending on them. The harness's transcript field is not a microphone implementation. Server command-span events must reach the provisional-event buffer before commit.

## Workstream 3 next integration

Rebase/merge the updated engine-integration contracts before further backend changes. Keep implementing in services/agent. Continue research renderer integration and provider-independent work while API access is deferred. Deep Agents and speech-provider work still require a credential decision. Actual engine recording commands currently reject, and sound research is unavailable; do not mark these user flows complete.

## Remaining product gates

Full editable/persistent groovebox UI, microphone timing/calibration and recognition, real recording/count-in, quantized performance commits and phrase correction, speech-span exclusion, Deep Agents, patch retrieval/optimization/audition, cross-platform validation, and the complete hands-free acceptance session. The active goal remains the full product integration, not just the pieces verified above.
