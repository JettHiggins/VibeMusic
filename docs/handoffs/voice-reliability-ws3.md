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
- **During a take:** a refused fragment joins the next segment only when the result is a real command, so singing that follows stays in the take. Holds are bounded by the browser's coverage limit (see the WS1 review section below).
- **Early stop:** previously, singing that resumed within the 0.6 s hangover after `Groove stop` merged into the same segment, so the stop waited for a pause or the 4 s cap.
  - Now, during a take or count-in, a 0.25 s dip inside a still-open speech segment sends the speech so far as a probe to the recognizer (`SpeechJob.probe`, `EnergySegmenter.probes`).
  - Only an exact single `stop-recording` result acts. The open segment is then split at the stop (`split_after`), so the stop isn't repeated and the singing stays in the take. Any other probe result is ignored, and the full segment decides as before.
  - At most one probe is in flight per stream. Probes only run with workers that declare `supports_probe` (the real `ThreadedSpeechWorker`), never outside a take.
- **Stop:** `stops` and `stopped` now parse as stop. `Groove stop` during a take remains `stop-recording`, so playback continues. Capture-clock window classification is unchanged.

## WS1 review follow-up (docs/reviews/PR43-SENTENCE-REVIEW.md)

Jett integrated `366f07e` (protocol) and `4132702` (cooldown). This branch merges current engine-integration and adds:

- **Valid prefixes are held (`a9ae8a8`):**
  - A segment cut at the 4 s cap is held even when its prefix already parses. Jett's reproduction ("make it sound like a warm piano" plus "with a soft attack") now starts one search for "warm piano with a soft attack", only after the whole sentence.
  - Open-ended sound descriptions wait for their continuation after an ordinary pause too.
  - Stop commands are never held, even inside a cut segment (priority stop).
  - Sung continuations ("la la") are never joined into a request.
  - A complete request starts exactly once, after the 2 s wait.
- **Browser coverage limit:** the browser's `SpeechSession` fails a stream whose speech-verified lags received audio by more than 8 s. The old 12 s sentence cap could exceed that.
  - Holds are now released once the audio received since the sentence began exceeds `HOLD_LAG_BUDGET_SECONDS = 6.5`. Releasing frees coverage immediately.
  - The worst case in the long-hold stream test is exactly 6.50 s. No browser limit was raised and no unclassified audio was verified.
  - A long sentence under that budget completes without a stall. A longer one is acted on as heard, not stalled.
  - Not yet run against the real browser `SpeechSession`; it needs the app running.
- **Valid prefixes that still run at once:** a complete command whose words could continue, such as `Groove record` before `synth two`, still executes immediately. Holding every complete command would delay stop, record and select by 2 s. Only sound descriptions, cut segments and unparsed text wait.
- **Spoken instrument requests were never visible (`bec6a8f`)** — root cause found:
  - The browser shows research only for jobs it requested itself or that a `research-context` announced (`apps/web/src/integration/research.ts`).
  - The service sends `research-context` only with `GROOVE_VOICE_RESEARCH=1`. With it off, "make it sound like ..." started a job the UI ignored.
  - With research unconfigured, the failure came back as a `research` message for that unknown job, also ignored.

  Spoken searches now either run announced, or are refused to the utterance with the exact reason and setting.
- **SLOOP research could not start from the documented command:** `uvicorn --app-dir services/agent` doesn't put the repo root on `sys.path`, so `GROOVE_RESEARCH=sloop` could not import `tools/sloop_renderer`. The adapter now adds the root itself. `tests/test_sloop.py` passes without `PYTHONPATH`.
- **Spoken search on the real stack** (`scripts/spoken_search_check.py`, synthesized speech, no browser), with `GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap`, local faster-whisper `base.en` and voice research on:
  - Heard "Groove, make it sound like a warm electric piano." and sent `research-context` "warm electric piano".
  - Real SLOOP/CLAP research finished after **143.0 s** (cold: the saved corpus didn't match this engine build and was rebuilt), with 11 progress updates and 5 evolved candidates, each with a rendered preview WAV (264,644 bytes).
  - Spoken "use number two" became `apply-patch`, and spoken "undo" became `undo`.
  - The rebuilt corpus is saved under `artifacts/corpus/clap` (ignored), so later starts with this engine build are warm.
  - Audible preview, applying the patch in the engine and Undo in the browser are not covered by this script.
- **"Stale service" claim corrected:** the base before `366f07e` had no `browser-status` handler at all, so the earlier "unsupported browser-status" report is explained by the missing handler. A stale service is not established. Check `/healthz` and the process working directory when testing.

## Real browser checks (headless Chromium)

Run on head `c27cfd5`, with the app on 5173 (`--strictPort`) and this service on 8000.
- **Service:** faster-whisper `base.en`, SLOOP/CLAP research and voice research on.
- **Browser:** headless Chromium through the real page, coordinator, `BrowserActionRouter`, `VoiceInput` executor, `SpeechSession`, engine and WebSocket.
- **Microphone:** replaced by quiet synthetic room tone plus injected synthesized speech, the same boundary as `tests/browser/input-action-lifecycle.js`.
- **Scripts:** `services/agent/scripts/browser/`.

**`executor_research_e2e.js`** (typed transcripts over the real socket):
- **Calibration:** "calibrate noise" made the service send a `browser-action`.
  - The executor ran countdown then measuring and measured −86.5 dBFS.
  - It acknowledged `running`, then `complete` ("Noise floor -86.5 dBFS"), after 6 `browser-status` snapshots.
  - The input revision went from 0 to 1.
- **Key:** "key D minor" applied `set-pitch-snap` and changed the session's key.
- **Sound search:** "make it sound like a warm electric piano" on synth two:
  - One `research-context` and 11 research updates.
  - The research panel finished in 63.9 s (warm corpus) with 5 candidates, all with previews. Candidate 2's preview decoded in the page as 3.0 s of audio, peak 0.55.
- **Accept and undo:** "use number two" applied the patch (the engine patch changed), and "undo" restored it exactly.
- **Errors:** no "unsupported message" errors from the service, and no page errors.

**`spoken_stream_e2e.js`** (synthesized speech through the browser's own speech stream):
- **Paused sentence:** "Groove, set the tempo to" ⟨0.9 s⟩ "one forty" gave one `tempo 140` command and no errors.
- **Stop during a take:** "Groove, stop" with a sung tone starting 0.35 s after it:
  - `command-span`, then `stop-recording` 0.36 s after the clip ended, while the singing continued.
  - Applied with playback continuing (`playing: true`, recording idle).
- **Coverage:** 319 speech-verified updates, with no coverage stall, discontinuity or page errors.
- **Harness note:** decoding clip audio on the page's main thread during capture caused a "Microphone capture discontinuity" in headless Chromium, so the script pre-decodes its clips. That is a harness constraint, not a service result.

This is synthesized speech, not a human microphone or hearing check.

## Checks (Windows, Python 3.13)

- **Backend suite:** `pytest -q` → **437 passed, 6 skipped**, now including the 5 real SLOOP engine tests (they previously errored only because the repo root was not on the import path).
- **New test files:**
  - `test_browser_protocol.py` (15 tests, including a real FastAPI WebSocket session)
  - `test_provider_resilience.py` (13 tests: scripted 402/429/Retry-After/timeouts, a worker storm test, and a real WebSocket degrade test)
  - `test_whole_sentence.py` (12 tests: real segmenter and Connection with a scripted transcriber, including early-stop probes)
- **Updated tests:**
  - Two speech tests now stream 1.5 s longer, because refused sentences wait for the join window.
  - One language-backlog test now uses distinct sentences, because identical pending requests are deduplicated.
- **Synthesized-speech check** (`scripts/synth_speech_check.py`): Windows SAPI phrases with room noise go through the real segmenter, Connection and local faster-whisper `base.en`. Synthesized speech is not microphone or human evidence.

  | Phrase | Before (playtest-musical-controls-1) | After (this branch) |
  | --- | --- | --- |
  | Groove, stop (take) | stop-recording | stop-recording |
  | Groove, stop ⟨0.35 s⟩ then a sung tone (take) | stop waits until the singing pauses | stop-recording at the dip; span ends 2.34 s, before the singing (~2.7 s) |
  | Groove, set the tempo to ⟨0.9 s⟩ one forty | 2 errors ("say a tempo", "not recognized") | tempo 140 |
  | Groove, erase the kick on bar two, beat three (take) | erase step 24 | erase step 24 |
  | Groove, key D minor | not recognized | set-pitch-snap D minor |
  | 5.5 s sentence, cut at 4 s ("soft." / "After…") | 2 fragment requests | 1 whole request (parser-only run: one truthful refusal) |

- No live OpenRouter quota was used.

## Limits and next steps

- **Early stop needs a dip:** it relies on a 0.25 s dip after "stop". Singing that starts with no dip at all still waits for a pause or the 4 s cap. Each probe costs an extra local Whisper call during takes (at most one in flight). This still needs human microphone confirmation.
- **Prefix commands still run at once:** a valid prefix such as `Groove record` executes immediately (recording the selected track) even if `synth two` follows after a pause.
- **Delayed refusals:** a refused or unknown sentence now reports up to 2 s later, while it waits for a continuation.
- **Speech that ends the stream:** a sentence held when a stream ends (mic off) is dropped with that stream, as bare wake words already were.
- **Model-side tools not added:** Deep Agents has no browser-action or key tools yet. Exact phrases cover the bounded set, and the model can already propose `set-pitch-snap` or `snap-notes`, because it reads the operations from the SessionCommand schema.
- **Physical microphone checks still needed:** Groove stop with playback continuing, pauses, calibration via voice against the real executor, and a 429 seen in the UI. Before testing, confirm the laptop service runs this commit: `/healthz` and the process working directory. (The earlier "unsupported browser-status" report is explained by the missing handler before `366f07e`; a stale service was not established.)
