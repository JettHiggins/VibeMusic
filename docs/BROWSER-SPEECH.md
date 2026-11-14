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

Pending before hands-free completion: peer review/merge of this browser branch, physical
microphone and human latency/recognition validation, and actual Deep Agents integration.
Positive SCRIPTED and real-model synthetic checks are detailed below. Reviewed #15/#21
backend fixes are adopted from engine-integration, including declared SciPy and preserved
capture-time context. OpenRouter free-model access is now selected; WS3 owns its unfinished
backend adapter/Deep Agents work. No live provider request or key setup was performed here.

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

## Real-model synthetic first drum slice

`tests/browser/local-stt-loop.js` uses the reviewed FastAPI service on localhost:8767,
with `GROOVE_STT=faster-whisper`, base.en CPU/int8 and four threads. The branch now adopts
engine-integration 6377130, including #15/#21 capture-context fixes and declared SciPy.
Use a Python 3.13 environment with requirements-dev.txt and requirements-speech.txt,
then run the service from this checkout (the model downloads into local cache, outside Git):

```sh
GROOVE_STT=faster-whisper GROOVE_STT_MODEL=base.en GROOVE_STT_THREADS=4 \
  .venv-speech-check/bin/python -m uvicorn groove_agent.app:app \
  --app-dir services/agent --host 127.0.0.1 --port 8767
```

The environment name above is local to WS1; substitute your installed speech environment.
No manual dependency workaround is needed with the reviewed requirements.

For a reproducible synthetic fixture, generate these ignored WAVs from the browser repo:

```sh
espeak-ng -v en-us -s 140 -w apps/web/public/engine/synthetic-record-kick.wav 'Record kick.'
espeak-ng -v en-us -s 140 -w apps/web/public/engine/synthetic-groove-stop.wav 'Groove, stop.'
```

With Vite running, open the app in playwright-cli, click Enable audio once for activation,
then run local-stt-loop.js. It uses an isolated engine and explicitly connects to port 8767.
The test decodes/resamples the generated speech on the browser context, streams it through
actual capture/PCM workers and WebSocket at 44.1 kHz, and invokes real faster-whisper. No
transcripts, spans, coverage or musical commands are scripted in this test. Synthetic
Record kick must produce next-beat recording of the kick lane; three generated hits must
commit at expected composition positions; recognized Groove stop must emit exclusion,
stop-recording and covering watermark in order. The test waits for audio-thread transport
confirmation, and checks exclusion against audible speech rather than espeak's appended
sentence silence. It requires recording false, playback true and no pipeline error.

Observed pass: base.en recognized both commands, three hits at expected/actual steps
[30,34,38], recording stopped and playback continued. Positions depend on clock origin.
This is real browser/model integration with synthetic speech and generated kicks, not a
physical microphone, human voice, p95 command-latency measurement, or full hands-free
acceptance. Delayed-result/new-take semantics are separately covered by the reviewed #15
backend regressions; this browser scenario alone does not prove those transitions. Stop the isolated
provider service and close the browser after running; do not commit generated audio/models.

## Verification backlog and stale-connection recovery

The client measures pending coverage from transmitted context-clock frames, not socket
connectivity or wall-clock arrival times. After two seconds it shows verification pending;
after eight seconds without sufficient progress the stream terminally fails. No newer
unverified chunk is sent. The take stops, pending capture is discarded and playback and
composition remain. Four-second normal classification segments still pass; receiving
coverage reduces the displayed backlog. The thresholds are explicit client grace limits,
not measured recognizer performance or a shared wire change.

Failure closes the old WebSocket without discarding adapter subscriptions. Late callbacks
from it cannot deliver commands into the next connection. This follows existing connection
reset semantics: connection-owned research jobs are cancelled; accepted patches/composition
are preserved. It does not abort a model inference already executing on the service.
Hands-free enable/Retry explicitly reconnects to the local service and starts a new stream;
it never resumes the old take or replays audio. Manual opt-out while reconnecting remains
manual even if the connection later succeeds. A fresh recording requires a new user/voice
Record command. Calibration/device/clock changes use the same reset path.

Tests: deterministic deadline/catch-up and stale-socket command tests, plus actual browser
speech-stall.js with a guarded SCRIPTED producer that never verifies. The browser showed
backlog, closed the failed connection, committed zero hits, stopped capture with playback
continuing, and reconnected on explicit Retry with a different stream and no old take.
The real unavailable-service UI test also passes with auto-connection from the hands-free
checkbox (no separate Agent-panel connect action). Positive scripted verification still
passes. These are software/synthetic recovery checks, not real recognition/latency acceptance.

## Combined reviewed backend revalidation — 2026-11-14

The speech branch now adopts reviewed engine-integration 6377130. The actual browser/model
scenario passed again using a fresh declared dev+speech environment, with no manual SciPy
addition: actual and expected steps [21,25,29], three committed hits, recognized next-beat
Record kick, exclusion -> stop-recording -> verification in that order, recording false,
playback true and no pipeline error. This run includes the bounded-backlog/reconnect client
code from 75ad0ba and the capture-time context fixes from #15/#21. Only synthetic espeak
speech and generated kicks were used; no human microphone or live OpenRouter request.

Combined shared/schema checks, Node suite (162 passed, one optional integration skip),
explicit live-service/WebSocket/WASM integration (one passed) and production build passed.
The first check invocation used system Python without jsonschema; rerunning with the
installed speech environment on PATH passed. The isolated test service and browser were
stopped afterward. Peer review/merge and human acceptance remain required.

## Real-model synthetic melody / joined Stop diagnostic

Generate an additional ignored fixture:

```sh
espeak-ng -v en-us -s 140 -w apps/web/public/engine/synthetic-record-melody.wav 'Record melody.'
```

With the same local faster-whisper service on 8767, run
`tests/browser/local-stt-melody.js` after browser audio activation. It recognizes Record
melody, captures synthetic C4/E4/G4 through the real YIN worker plus speech gate, recognizes
Groove stop, checks exact note starts/durations/pitches and continuing playback. No commands,
transcripts, spans or coverage are scripted. The default stop phrase begins at 10 s, 2.5 s
after the last note ends. This passed with notes [28,3,60], [32,3,64], [36,4,67] matching
expected positions (positions vary with clock origin), three committed notes and no errors.

**Known failing transition, not accepted:** run from `/?testStopAt=8` instead. The identical
phrase ends at 7.5 s, leaving 0.5 s before Groove stop. In the first run Record/Stop were
recognized and playback continued, but zero notes committed (14 dropped). A longer-pause
pass does not close this failure. The 0.6 s energy-segment hangover can join singing to the
command; the service then excludes the whole candidate segment. WS3 must refine measured
wake/command exclusion so preceding musical input survives, while never verifying actual
command speech as music. Preserve capture-time context and watermark ordering. This is
synthetic integration evidence, separate from the user's unresolved physical melody error.

The synthetic phrase 'Record synth one' also failed recognition on this base.en fixture;
'Record melody' was recognized. Do not equate either synthetic result with human word error
rate, and do not weaken the parser to accept hallucinations. The model/segmentation decision
needs the fixed command corpus and real voice measurements.

The short-pause failure reproduced a second time with no pipeline error: zero committed,
16 dropped, and command-span [286932,428933] at 44.1 kHz (3.22 seconds), spanning the pitched
phrase as well as Stop. This confirms overly broad exclusion, rather than absent YIN input
or a stopped transport, in this synthetic scenario. Do not simply remove wake exclusion or
shorten all segments: those changes can leak commands or break paused Groove commands.
