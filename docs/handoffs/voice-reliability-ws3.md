# Voice reliability round — WS3 handoff (speech resilience)

Branch `ws3/speech-resilience`, based on engine-integration `4b9cbdc`. Commits:
- `366f07e` browser-status/acks and exact input/key actions
- `4132702` shared provider cooldown
- `6d639b3` whole-sentence endpointing
- a final commit with this handoff and the synthesized-speech check script

Only `services/agent/**` and this file changed. There are no contract, frontend, engine or CI changes.

## Behavior

**1. browser-status / browser-action-ack (P0).**
- `Connection` previously answered both published ClientMessages with `unsupported message type`. It now accepts them.
- It tracks the executor's status: clock, `inputRevision`, availability, microphone and active action.
- It ignores snapshots for another clock, or with an older revision on the same clock.
- A real input change (new clock or `inputRevision`) does two things:
  - It retires speech streams that began on the old input path. Their pending or held segments never act or verify.
  - It invalidates pending Deep Agents decisions (the input key is part of the language token).
- Only acknowledgments for our own request IDs on the same clock count:
  - `running` marks the request started.
  - `rejected` or `cancelled` is reported with the browser's reason.
  - `complete` is silent; the browser shows the real result.
- Requests time out: 15 s without `running`, 180 s once running.
- IDs are `<utterance>:input-<per-connection nonce>`, so they stay fresh across reconnects.
- Truly unknown or malformed frames are still refused by schema validation.

**2. Exact provider-free phrases.** Parsed by `groove_agent/control_phrases.py`. Unrecognized wording still goes to the language model as before.
- **Browser actions** (sent as `browser-action`, never as a SessionCommand):

  | Phrase | Action |
  | --- | --- |
  | calibrate | `calibrate-input` full |
  | calibrate noise, measure the silence | `calibrate-input` noise |
  | calibrate timing | `calibrate-input` timing |
  | check timing | `calibrate-input` check-timing |
  | cancel calibration | `cancel-input-action` for the browser's own active action ID |
  | noisy room profile, music profile | `set-input-profile` |
  | set offset to minus 20 milliseconds | `set-input-offset`, −150..150 ms |

- **Refused before sending:**
  - when there is no status, or `available:false`;
  - while armed or recording;
  - calibration while playing, or while the mic is off;
  - a second action while one is active.

  The browser executor still validates everything itself.
- **Key commands:**
  - `key D minor`, `key F sharp major` or `key B flat minor` → `set-pitch-snap` (immediate).
  - `turn key snapping off` → `set-pitch-snap null`.
  - `snap the existing notes [on synth N]` → `snap-notes` (next-loop). It needs a key and a synth; otherwise it refuses.
  - An ambiguous root or scale refuses.

**3. Provider rate limits (P0).**
- A 402 or 429 starts one process-wide cooldown (`ProviderGate`). It uses the provider's Retry-After when given (capped at 300 s); otherwise the wait starts at 15 s and doubles up to 300 s. Two consecutive timeouts pause it for 10 s.
- **During the cooldown:**
  - Unknown requests are refused immediately with a safe message naming working exact commands.
  - Queued jobs fail fast without calling the provider.
  - Nothing is retried, and no mutation is replayed.
  - An identical request that is already pending is not resubmitted.
- `/healthz` reports `...; cooling down N s, exact commands only`.
- All deterministic commands keep working, because they never touch the provider: stop, select, tempo, clear, undo, metronome, erase, key and calibration.

**4. Whole-sentence endpointing and stop.**
- **What's held:** an addressed transcript that doesn't yet parse as a command, or a segment the energy segmenter cut at its 4 s cap (new `Segment.cut`). It waits for its continuation in the existing 2 s join window, instead of executing or reaching the language model as a fragment. A joined sentence gives one command and one command-span over the whole sentence, and coverage stays held meanwhile.
- **What's not held:**
  - Complete commands (`Groove stop`) run at once.
  - A new addressed command is never merged into a held fragment.
- **During a take:** a refused fragment joins the next segment only when the result is a real command, so singing that follows stays in the take. A held sentence is capped at 12 s.
- **Stop:** `stops` and `stopped` now parse as stop. `Groove stop` during a take remains `stop-recording`, so playback continues. Capture-clock window classification is unchanged.

## Checks (Windows, Python 3.13)

- **Backend suite:** `pytest -q --deselect tests/test_sloop.py` → **421 passed, 6 skipped**. The 4 `test_sloop` errors were already present: this laptop has no native SLOOP module built.
- **New test files:**
  - `test_browser_protocol.py` (15 tests, including a real FastAPI WebSocket session)
  - `test_provider_resilience.py` (13 tests: scripted 402/429/Retry-After/timeouts, a worker storm test, and a real WebSocket degrade test)
  - `test_whole_sentence.py` (8 tests: real segmenter and Connection with a scripted transcriber)
- **Updated tests:**
  - Two speech tests now stream 1.5 s longer, because refused sentences wait for the join window.
  - One language-backlog test now uses distinct sentences, because identical pending requests are deduplicated.
- **Synthesized-speech check** (`scripts/synth_speech_check.py`): Windows SAPI phrases with room noise go through the real segmenter, Connection and local faster-whisper `base.en`. Synthesized speech is not microphone or human evidence.

  | Phrase | Before (playtest-musical-controls-1) | After (this branch) |
  | --- | --- | --- |
  | Groove, stop (take) | stop-recording | stop-recording |
  | Groove, set the tempo to ⟨0.9 s⟩ one forty | 2 errors ("say a tempo", "not recognized") | tempo 140 |
  | Groove, erase the kick on bar two, beat three (take) | erase step 24 | erase step 24 |
  | Groove, key D minor | not recognized | set-pitch-snap D minor |
  | 5.5 s sentence, cut at 4 s ("soft." / "After…") | 2 fragment requests | 1 whole request (parser-only run: one truthful refusal) |

- No live OpenRouter quota was used.

## Limits and next steps

- **Singing merged with stop:** singing or humming that resumes within the 0.6 s hangover after `Groove stop` merges into the same energy segment. The stop then waits for a vocal pause or the 4 s cap. Beatboxing bursts don't cause this. A real VAD or an early partial transcription is the next step; this needs human microphone reproduction.
- **Prefix commands still run at once:** a valid prefix such as `Groove record` executes immediately (recording the selected track) even if `synth two` follows after a pause.
- **Delayed refusals:** a refused or unknown sentence now reports up to 2 s later, while it waits for a continuation.
- **Speech that ends the stream:** a sentence held when a stream ends (mic off) is dropped with that stream, as bare wake words already were.
- **Model-side tools not added:** Deep Agents has no browser-action or key tools yet. Exact phrases cover the bounded set, and the model can already propose `set-pitch-snap` or `snap-notes`, because it reads the operations from the SessionCommand schema.
- **Physical microphone checks still needed:** Groove stop with playback continuing, pauses, calibration via voice against the real executor, and a 429 seen in the UI. Before testing, confirm the laptop service runs this commit: `/healthz` and the process working directory. A stale service is the likely source of the earlier "unsupported browser-status" report.
