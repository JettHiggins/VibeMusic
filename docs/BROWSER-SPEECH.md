# Browser speech implementation handoff (in progress)

WS1 temporarily owns this consumer while Leo is unavailable. Branch ws1/speech-capture
starts from approved integration and includes the prepared recording-consumer/worklet
preview. It is not shared integration and must not be described as hands-free completion.

Implemented building blocks:
- An independent capture-worklet speech port copies/stamps samples, with no encoding or
  inference in the audio callback. It excludes audio buffered before speech enable and
  disconnecting speech leaves performance capture running.
- Worker-side SpeechPcmEncoder emits 100 ms PCM16 little-endian/base64 chunks on the
  approved SpeechAudio shape, silence included. Payload stays at the context rate
  (44.1 kHz); model-rate conversion belongs to the local recognizer adapter. No
  resampling drift or second device-clock mapping is introduced.
- Latency uses the same nearest-frame mapping as performance events. Negative startup
  time removes matching PCM; it never pads/clamps a header over unchanged audio.
- A discontinuity terminally fails the stream and discards its pending samples. A new
  stream begins at sequence zero; old buffered samples are never replayed.

Connected on this feature branch: MicrophoneInput creates/tears down the speech worker and
separate port; WebSocketAgent bounds speech socket buffering; explicit local hands-free
mode/status routes active-stream/clock coverage through SpeechSession. Socket connection
never proves recognition. Unavailable/error/gap clears local pending capture, stops the take
and resets retained capture without stopping playback; recovery requires explicit Retry
and a fresh take. Calibration/device/clock changes invalidate the old stream. Manual
fallback is explicit only. Unscoped/foreign coverage cannot verify the new stream; first
coverage is bounded by its actual first sent frame and last sent end. Old worker results
cannot replay after failure/restart.

Actual Chromium-to-service check: synthetic silence traversed the real capture worklet,
PCM worker, WebSocket and service schema validation. A 4410-frame chunk carried 8820 bytes
at 44.1 kHz, sequence zero. The real no-recognizer service returned stream-scoped
unavailable: recording stayed blocked in speech mode, playback continued, and only
explicit checkbox opt-out restored manual mode. Script: tests/browser/speech-unavailable.js.

Pending before hands-free completion: positive classified-flow browser integration with
an explicitly SCRIPTED test producer, actual faster-whisper, delayed capture-context fixes
in #15, measured recognition lag/backpressure behavior, physical microphone and human
latency/recognition validation. No recognizer is installed/configured by this branch and
Deep Agents/API access is still deferred. This is transport/mode wiring, not delivered STT.

Checks: PCM frame/sample counts, silence/uneven blocks, fractional latency/startup trim,
gap discard and real capture-worklet transfer behavior pass deterministic tests. Shared
schema/TypeScript checks, existing full Node suite and production build pass. No raw
microphone, live recognition or human audio-quality result is implied.

## Positive scripted browser integration

Start the TEST-ONLY server in a separate terminal from the repository root:

```sh
VOICESYNTH_SCRIPTED_SPEECH=1 PYTHONPATH=services/agent .venv/bin/python -m uvicorn \
  scripted_speech_server:app --app-dir tests/browser --host 127.0.0.1 --port 8766
```

With Vite on port 5173, open the app in playwright-cli, click Enable audio once for
browser activation, then run `tests/browser/speech-verified-loop.js`. Close the test
browser and stop the test server afterward. The fixture fails startup without its
explicit environment guard. It is not a GROOVE_STT provider and is never used by the
production service. Its `/plan` endpoint is test control, not a contract extension.

The test uses real BrowserEngine, VoiceInput, capture/PCM workers, WebSocketAgent,
SessionCoordinator, server-side contract/PCM validation and SLOOP WASM. The server
explicitly SCRIPTs availability, coverage, one exclusion interval and stop-recording;
it does not recognize audio or exercise WS3's transcriber/segmenter. Four synthetic
kick hits must commit at expected composition steps; a fifth hit in the scripted
command span must not commit. Span -> stop-recording -> covering watermark order,
recording false, playback true and no input error are required. It passed locally
with expected/actual steps [23,27,31,39], four committed hits and continued playback.
Steps are calculated from actual clock origin, so the numeric cells can vary with
browser activation time. No physical or real-STT acceptance is implied.
