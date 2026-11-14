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

Pending before any hands-free claim: MicrophoneInput lifecycle hook, bounded socket
backpressure, user-selected local speech mode/status, active-stream/clock coverage gate,
fromFrame bounds, unavailable/gap discard and fresh take/epoch recovery, end-to-end
browser-to-service tests, actual faster-whisper and physical-user validation. Socket
connectivity alone must never enable commits. The service currently has no recognizer;
PR #15 is separately under review for delayed capture-context handling.

Checks: PCM frame/sample counts, silence/uneven blocks, fractional latency/startup trim,
gap discard and real capture-worklet transfer behavior pass deterministic tests. Shared
schema/TypeScript checks, existing full Node suite and production build pass. No raw
microphone, live recognition or human audio-quality result is implied.
