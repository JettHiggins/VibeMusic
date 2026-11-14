@leoAndrade2332 @lennyyanza — updated ownership and decisions from Jett. Read docs/STATUS.md; this supersedes older blockers in issue #3.

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
