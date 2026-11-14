# WS1 transport repair handoff

Branch ws1/transport-playtest-repair, based on published repair contracts 5560129. Review/integration is pending; this is not a frozen human-accepted milestone. Shared contract/examples and the three updated goals are already on engine-integration.

## Reproduction and fix

With real pinned WASM: Play for 40 seconds at 120 BPM, Stop and render the stop, then Record next-beat without pressing Play. Old engine remains armed after four beats (firmware beat now 4, previously 80). preview_play only queues a request; the next render resets the firmware clock, so arming against the old beat count can wait many extra beats. The new test fails against the prior implementation. Fresh stopped initial count-in already passed, so the exact laptop first-press history remains unconfirmed.

Record now pins an absolute AudioContext-frame deadline from firmware tempo/phase: stopped next-beat = four beats; playing = next beat; explicit next-loop preserves the four-bar boundary. Rendering splits at that deadline. Worklet initialization supplies its actual currentFrame, avoiding a zero-origin deadline if a command arrives before its first render. New Record/Play restart attempts while armed/active reject; duplicate IDs replay their prior ack. Tempo commands and tempo-changing Undo during count-in reject, while unrelated edits keep the target/deadline. Count-in feedback derives from elapsed sample-clock beats, including fractional BPM boundaries; it disappears on activation/cancel.

The firmware's existing click is enabled by default throughout playback/count-in/capture, with bar accents. Immediate metronome commands toggle its private transport state without musical revision or Undo history. A muted metronome also mutes count-in audio; countdown still works. Stopped empty playback remains silent. Snapshot rendering used by sound research still defaults its metronome off; this transport preference is not saved as pattern data.

App startup now creates an empty session, retaining the previous default first-synth patch and other default instruments, with no seeded notes/hits and no automatic restore. Explicit session save/load behavior is unchanged.

## Validation

- Old restart reproduction: armed after four beats. New count-in tests: fresh/nonzero clock origins, 60/120/137/180 BPM, repeat Record/Play/tempo/mute/selection interactions, cancellation and legacy next-loop behavior pass.
- Metronome test uses actual PCM from empty WASM: stopped silence, playing click, independent mute, continued click after stopping capture, stopped silence, no musical events/history/revision from toggle.
- Shared TypeScript/Python/schema checks, Node **175 passed / one optional skip**, explicit live-service/WebSocket/WASM integration and production build passed. The prior core assertion expecting clicks to stop after recording starts was updated for Jett's new always-playing metronome preference; no timing assertion was relaxed.
- Actual Chromium UI + WASM test passed: startup empty, fresh Record without Play, transition at displayed armedStartFrame, stopped restart, no remaining countdown metadata during active recording, silent synthetic capture creates no pattern, and direct engine metronome mute leaves revision unchanged. First/restart frames [93960,194696] vary with actual context origin. tests/browser/playtest-count-in.js reproduces it with a synthetic silence source. Test browser closed afterward. This is not human microphone/fun acceptance.

## Integration and remaining work

WS2: consume published armedStartFrame/countInBeatsRemaining/metronomeEnabled; add visible mute and distinguish continuous click from COUNT-IN/REC. Noise/input and per-event editing remain your repair scope. WS3: parser/semantic support for metronome/erase per the contract; no LLM latency for those commands. Please open/review this branch against engine-integration with exact source head; WS1 cannot create PRs using current authentication.

Targeted erase-event still explicitly rejects on this engine until its separate implementation lands. Do not enable it or use a global input reset as a substitute. WS1 will next implement targeted erasure fences and preservation of unrelated queued/provisional input, then integrate all reviewed repairs and publish a frozen laptop test commit. Restart backend/Vite and reload browser together after schema/worklet changes. Preserve the complete roadmap and defer sound-search expansion.
