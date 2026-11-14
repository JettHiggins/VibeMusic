# WS1 immediate patch engine handoff

Branch: `ws1/immediate-patches`, based on the new musical-control contract. The previous UI and engine required four-bar-boundary application even for an interactive preset choice. This engine accepts `apply-patch` at immediate or explicit next-loop boundaries; next-beat remains rejected. Existing schema/payloads stay valid.

Immediate requests validate revision and patch metadata, apply on the audio thread without waiting for the loop, preserve music/transport/capture, and use the existing five-millisecond output transition. Undo and explicit legacy next-loop behavior remain. This does not modify UI or backend ownership: their current callers still request next-loop until WS2/WS3 adopt MUSICAL-CONTROL-CONTRACT.md.

Validation: six focused tests passed (real WASM mid-loop capture/clock/music/Undo and legacy/stale/invalid behavior, plus deterministic output-transition coverage). Full Node suite: 196 passed/one optional skip. Shared checks, frontend build and provider-disabled local service/WebSocket/WASM integration passed. No new native export or asset rebuild is required beyond matching the current integrated WASM.

The real-WASM test proves engine state/ack timing and retained capture, while the deterministic DSP fixture proves the smoothing envelope. Neither establishes audible device latency or the final UI/voice experience. Next step: peer-create/review a focused PR to engine-integration, adopt immediate in the latest-wins UI patch queue and voice/research acceptance, then verify actual preset changes/audition while playback/capture continue.
