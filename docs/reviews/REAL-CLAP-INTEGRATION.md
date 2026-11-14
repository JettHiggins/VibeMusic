# Voice research integration with actual CLAP and SLOOP

WS1 combined #29 (`5278e62d`) and peer-inspected #31 (`7ec9b9d1`) with the current repaired baseline. Merge resolutions retain capture-time recordingTarget for erasure, research-obsolescence guards, metronome/erase language guidance and provider/key/test isolation. Ordinary service/research regression subprocesses explicitly keep GROOVE_VOICE_RESEARCH=0, even if the developer shell enables it.

## Checks

- Combined Node: **207 passed / one optional skip**; shared TypeScript/Python schema checks and frontend build passed.
- Combined backend: **386 passed / six optional skips**, including the repaired noisy-room, target/erase and new voice-research lifecycle tests.
- Provider-disabled Python-WebSocket-WASM regression passed with a parent voice-research flag intentionally enabled, proving child isolation.
- Real SLOOP renderer / MOCK embedder acceptance/Undo regression passed (~78.6 s). Ranking in that regression is deliberately meaningless; it is not sound research quality evidence.

## Actual model and browser run

A separate localhost:8001 service used GROOVE_VOICE_RESEARCH=1, GROOVE_RESEARCH=sloop, GROOVE_EMBEDDER=clap, the cached pinned original CLAP music weights, actual current SLOOP WASM and a fresh ignored corpus directory. HF_HUB_OFFLINE=1 ensured no model download/API call. LLM and STT were explicitly disabled for this run; requests were complete typed transcripts.

The existing corpus belonged to an older WASM artifact, so it was not silently reused. Building a matching 153-preset corpus produced the first five candidates at **143.546 s**; all 128 optimization variations completed at **235.649 s**. A real generated preview fetched successfully (264,644 bytes, RIFF/WAV). The final top patch was an evolved SAMPLE / GRAND PNO family patch. This identifies the selected family, not a listening judgment.

`tests/browser/live-clap-research.js` then drove the actual React app, AudioWorklet/WASM, Python WebSocket service, real CLAP retrieval/refinement and actual HTMLAudioElement previews. It redirected only the test browser's socket destination from :8000 to :8001; it supplied no fake response/audio/candidate/model output. The repeated warm in-process prompt returned five candidates in **120 ms**; that is not a cold-start or general p95 benchmark.

The test described an 80s electric piano, auditioned candidate two, requested a warmer refinement, waited for real optimization progress, stopped optimization while retaining real candidates, auditioned candidate one, accepted its exact patch and undid it. Two started/ended preview acknowledgment pairs were observed. Playback continued and original musical tracks were restored after Undo. Preview alone left the musical session unchanged.

## Deployment and remaining gates

Both producer and consumer must be deployed/reloaded together. Explicitly set GROOVE_VOICE_RESEARCH=1 and configure the real research backend/model/corpus; the flag alone does not configure CLAP. Health must show voiceResearch:true and a real SLOOP/CLAP research backend. The ordinary no-model service must remain usable and report unavailable research honestly. Prebuild/warm the matching corpus before a fun test; its first rebuild took minutes here. Keep generated corpus/model/audio files out of Git.

This run did **not** test real speech endpointing, a live LLM, physical microphone/latency, human hearing, semantic sound quality or the full requested hands-free session. It also used the legacy explicit next-loop patch acceptance; immediate-patch adoption remains a separate tracked change. WS2 key/calibration consumers and WS3 whole-sentence/stop/browser-action tools remain outstanding. The next combined frozen test must include them, not substitute these typed-transcript results for acoustic acceptance.
