@leoAndrade2332 @lennyyanza — updated ownership and decisions from Jett. Read docs/STATUS.md; this supersedes older blockers in issue #3.

**Speech streaming unblocked:** WS1 reviewed/integrated #14 at 49ca90b and #13 at 0465dd7. Use the approved committed speech-audio/status/coverage contract. WS1 temporarily owns the browser speech-streaming consumer while Leo is unavailable; do not duplicate that browser work. @lennyyanza: continue #15 pipeline fixes/review and selected local faster-whisper, with no LLM key dependency. #15's c8f4ed4 revision is received but not yet approved. Deep Agents remains required after the provider decision; no API calls/key setup are authorized. Read the latest STATUS.md; the old #13/#14 review-blocker paragraphs below are history.


**Current WS1 review target: [ws1/integration-preview at 0b95ca1](https://github.com/JettHiggins/VoiceSynthesizer/compare/engine-integration...ws1/integration-preview?expand=1).** Jett resumed WS1 and combined both ready WS1 branches with current integration in an isolated preview. @lennyyanza: open/review this single PR to engine-integration; retain recording-consumer/dev-worklet-sync as parent history. Shared checks, full Node suite, service/WASM integration/build and actual browser next-beat/live-edit/held-note reset checks pass locally with the current-source dev worklet active. Shared engine-integration is unchanged by this preview; real voice/device and full hands-free acceptance remain open. WS3 can continue transport/retrieval fixes and local faster-whisper without waiting for an LLM decision or this PR; Leo's last known usage limit has no reported resolution.


## Decisions and immediate ownership

- Jett selected **local faster-whisper** for speech recognition. Start with the small model as a configurable baseline; measure CPU latency on development laptops. Model downloads stay outside Git. No cloud credentials/API calls are authorized.
- The language-model provider remains deferred while Jett researches possible existing access. Keep the parser as the interim command path; Deep Agents is still a product requirement, not complete. Provider research must not block STT, speech-transport review fixes, or retrieval fixes.
- Leo is out of usage. **WS1 now owns the recording-consumer UI/input wiring** on ws1/recording-consumer. Leo: do not independently implement that capability when resuming; review the landed handoff first. WS1 is implementing next-beat Record, immediate Clear/Undo, epoch/cutoff worker resets, provisional Undo and loop-origin placement, sticky transport and monochrome recording state.
- Lenny: PR #16 is integrated. Next address the exact review comments on #14/#15 (stream-scoped coverage, duration/rate bounds, gap recovery, unavailable behavior, wake-span exclusion on failed interpretation), and #13 (answer keys must not be inside the blind kit). Then implement the local faster-whisper adapter off the event loop. Provider selection is no longer an STT blocker. Return precise runtime limitations, not the old issue #3 dependency table.

## Issue #3 contract answers (WS1)

(a) Research trackId/description: current messages remain unchanged for now. ResearchController tracks browser-initiated requests; if voice-started concurrent jobs need explicit metadata, propose additive fields and fixtures in a focused contract PR. Do not invent an incompatible message shape or block the other work on this extension.

(b) Audition is non-mutating previewUrl playback through the integrated candidate UI. Accept uses apply-patch; Undo restores accepted musical state. Do not use apply-patch+undo just to preview.

(c) Armed Record survives unrelated edits with its original target/deadline (merged #12). Other queued musical mutations retain strict revision checks; report rejection or deliberately re-propose a still-valid absolute intent. Never retry discarded performance/clear intentions after a live edit.

(d) Yes: recognized Groove wake speech during capture must emit its measured command-span even if interpretation fails, followed by error/no mutation and only then appropriate classified coverage. See #15 review.

(e) Yes: stop-recording cancels count-in/armed Record, keeps playback running and does not consume a musical revision. Implemented/tested, including backend #16.

## Evidence and remaining gates

Engine and backend timing support, guided calibration, dark workspace/piano roll and candidate UI are integrated. UI recording adoption is underway, not done. Real local recognition, human calibrated takes (especially Lenny's late drums and melody-loading failure), blind listening and full hands-free acceptance remain open. Synthetic tests are not real-device signoff. Main remains the documentation baseline; start capabilities from reviewed origin/engine-integration.

## Recording consumer ready for review

WS1 pushed [ws1/recording-consumer at f3987e3](https://github.com/JettHiggins/VoiceSynthesizer/compare/engine-integration...ws1/recording-consumer). The full consumer wiring is implemented and software/browser checks pass; docs/RECORDING-USABILITY.md on that branch gives behavior and evidence. Leo must not duplicate it. @lennyyanza: since Leo is out of usage, please use the combined integration-preview review target above with your authenticated account and review the backend-proposal seam/ID preservation. Repository settings prohibit Actions PR creation; WS1 cannot create it with the available authentication. This review dependency does not block your local STT or #13/#14/#15 fixes. The demo on Jett's laptop runs the capability branch, but it is not yet part of shared engine-integration. Human timing/voice acceptance remains open.

## Setup/status clarification

WS1 consolidated docs/STATUS.md so current decisions/owners come first and corrected stale docs/SETUP.md instructions that pointed teammates at the foundation/main. Start capabilities from reviewed engine-integration and open PRs to engine-integration. @lennyyanza: the combined integration-preview target above includes ws1/dev-worklet-sync at 248585a; its existing tests/handoff are ready. It fixes stale dev worklets, not missing WASM assets.

Additional consumer-branch evidence: synthetic C4/E4/G4 passed through the actual browser capture/YIN worker/recorder/WASM into steps 20/24/28, durations 3/3/4, with playback continuing (~8.1 ms p95 analysis here). This does not close Lenny's physical-device loading error or real-performer gates.

## Consumer review head and CI correction

Review ws1/recording-consumer at **4d6c90c** (browser regression/docs only since the green edd6044 implementation) (same functional wiring plus current steering and additional browser evidence). The original full-phrase browser correction test is preserved and passed; a separate next-beat-melody.js checks mid-loop placement. CI on f3987e3 found a stale research test still waiting for queued Undo after #16 changed it to immediate. WS1 reproduced the failure, required immediate application/preserved notes/continuing nonzero output, and the full real-renderer/MOCK-embedder scenario passed locally (~78 s). The fix is on the consumer branch; [CI run 43609794188](https://github.com/JettHiggins/VoiceSynthesizer/actions/runs/43609794188) completed successfully for edd6044: contracts/web, Linux firmware/research and macOS/Windows software integration all passed. This result is for the review branch; merge is still pending. Latest MIC-TESTING.md on integration has the actual three-second/four-practice/eight-measured calibration and a device-results table. The branch still needs a collaborator-created PR/review before integration; no human voice/timing signoff is claimed.

## Old service PR cleanup

WS1 verified with git ancestry that #1 at 3a62724 and #2 at 8fae6aa are already included in engine-integration. Their original main/stack bases make them misleading. The coordination workflow will retarget/close them with exact integration evidence; this does not merge the product into main or close the still-unmerged #13/#14/#15 work. Review/open the ready WS1 consumer and dev-worklet PRs instead.

Additional browser race coverage is committed as tests/browser/live-capture-edits.js on the consumer branch: continuous synthetic tones traverse the real worklet/worker; Undo discards an internally held note without consuming history, then Clear removes completed and held pre-edit input. Only fresh post-cutoff/new-epoch notes reach the engine, with capture/playback continuing and no input rejection error. This passed locally (~8.6 ms p95); no human timing/voice signoff is implied.

## Fourth teammate: WS4 evaluation support

Three concrete WS4 issues are published from docs/WS4-TICKETS.json, with priority, owned paths and acceptance criteria. Start with the command acceptance corpus. WS4 owns only evals/, tools/evaluation/ and docs/WS4-HANDOFF.md; no production UI/service/engine/contract edits and no provider access needed. Startup prompt: docs/WS4-START.md. WS3 should consume the resulting cases/summaries rather than duplicate them; core speech/Deep Agents ownership stays with WS3.
