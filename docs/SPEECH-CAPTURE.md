# Speech capture: what the browser side needs (Workstream 2 notes)

Status: **requirements and open questions only.** Nothing here is a contract. CONTRACTS.md assigns the speech transport and provider protocol to Workstream 3, as a proposal that Workstream 1 approves before anyone implements it. Workstream 2 has implemented no audio transport. This document lists what microphone capture must provide, so the proposal can be written against real constraints.

## What exists today

- **Speech → recorder seam (done, merged):** `input/speech-messages.ts` routes `command-span` and `speech-verified` ServerMessages to `PerformanceRecorder`. In `speech` mode the recorder commits a take's events only through `min(speech-verified watermark, analysed audio, engine frame)`, excludes command spans, and stops accepting events when recognition disconnects. Playback continues.
- **Transcript seam (done, Workstream 3):** `utterance` ClientMessages carry text plus `startFrame`/`endFrame`. The development harness (`SessionCoordinator.submitTranscript`) sends zero-length spans. Real recognition must supply measured spans.
- **Capture graph (done):** the microphone feeds an AudioWorklet on the engine's AudioContext, which stamps 1024-frame blocks with the shared sample clock and sends them over a MessageChannel to the analysis worker. This is the **performance path**: echo cancellation, noise suppression and auto-gain are requested off so transients survive.
- **Not existing:** no speech audio leaves the browser. No message type carries audio. The backend only receives transcripts.

## Requirements capture must meet

1. **One timeline.** Every speech chunk must be placed on the AudioContext sample clock (`clockId` plus frame) that performance events use. `command-span` and `speech-verified` are defined on the *latency-corrected* performance timeline (CONTRACTS.md), but only the browser knows the calibrated latency. Recommendation: the browser stamps each chunk with the corrected frame of its first sample (`captureFrame − effectiveLatencyFrames`, including any per-device manual trim), so the backend never applies calibration. Never subtract latency twice.
2. **Contiguous coverage.** `speech-verified` may only advance over audio that was actually classified. If capture sends audio only when voice activity is detected, silent stretches are never "verified" and takes stall. Either stream continuously (silence included), or define explicit "silence through frame N" markers that the backend can verify. Gaps (device change, dropout, a new AudioContext) must be signalled, never papered over. The capture worklet already reports gaps.
3. **A separate speech path.** The performance path disables echo cancellation, noise suppression and auto-gain. Recognizers usually do better with noise suppression and gain control. Options to evaluate:
   - (a) feed the same raw track to the recognizer (simplest, one device open);
   - (b) open a second track with processing enabled (Chrome's per-track processing on one device must be verified on Windows and macOS);
   - (c) apply light software gain/high-pass only on the speech path.
   Measured on a Windows laptop: the browser grants processing off as requested, and the room floor was about −39 dBFS.
4. **Format and rate.** The context runs at 44.1 kHz; most recognizers want 16 kHz mono PCM16 (Whisper-family models resample anyway). Resampling and chunking belong in a worker, never in the audio callback. Proposed chunk length: 20–100 ms. The exact format follows the provider decision.
5. **Back-pressure and latency budget.** Command spans must arrive before the pending-loop deadline (CONTRACTS.md); otherwise the recorder holds commits and the UI must say recognition is behind. Capture must never block or delay the performance path. If the backend falls behind, the browser keeps playback and analysis running and reports the state; it doesn't silently drop audio that the watermark would later claim.
6. **Lifecycle.** Stream only while the agent is connected and the user has enabled hands-free mode. On reconnect, don't replay old audio (matching "no replay of pre-disconnect recording commands"). A new AudioContext means a new `clockId`, and spans from the old clock are rejected.
7. **Privacy and consent.** Raw microphone audio is not persisted by default (PLAN.md), and must not be committed. Audio goes to the local service at `127.0.0.1` only. If a **cloud** speech provider is chosen, audio leaves the machine: the UI then needs an explicit, visible opt-in and a status indicator, and keys stay server-side.
8. **Wake phrase.** During recording only "Groove, …" commands may produce commands and spans. Capture doesn't classify, but it must keep sending audio during takes so the backend can find the phrase and exclude it.

## Open questions for the proposal (Workstream 3 to propose, Workstream 1 to approve)

- Transport: binary WebSocket frames on the existing `/ws`, or a separate audio socket? What header (clockId, corrected start frame, sample rate, sequence number)?
- Who resamples: the browser worker, or the backend?
- Continuous streaming vs. VAD with explicit silence markers (see requirement 2)?
- Raw track (option a) vs. processed track (option b)?
- How "recognition is behind / unavailable" is signalled to the browser, beyond socket connectivity.
- Provider decision (local model vs. cloud): this is a team decision that also gates consent UI.

## What Workstream 2 will build once a contract is approved

1. A speech tap from the existing capture graph (a second port on the capture worklet, so the performance timing path is untouched).
2. A resampling and chunking worker that stamps latency-corrected frames and signals gaps.
3. A hands-free toggle with consent and status (streaming, behind, unavailable), switching the recorder to `speech` mode.
4. Tests: timestamp alignment with performance events, gap handling, no-replay on reconnect, and that performance analysis p95 is unaffected.

WS1 review: this is requirements material, not an approved transport or provider choice. When the recording-usability capability merges, coordinate capture cutoff/epoch resets with it; use only the approved shared schemas. Calibration compensation includes manual offset trim and must still be applied exactly once.
