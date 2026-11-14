# Agent service (Workstream 3)

Local FastAPI service that turns utterance transcripts into `SessionCommand` proposals over
`ws://127.0.0.1:8000/ws`. The browser stays authoritative for musical state and timing; this service
only reads snapshots and requests mutations. See `docs/CONTRACTS.md` for the protocol.

By default command interpretation is deterministic and local. Optional OpenRouter Deep Agents loads backend-only credentials and makes bounded free-model requests when explicitly configured; see the setup section below.

## Commands

Run from the repository root with the virtualenv from `docs/SETUP.md` active.

```sh
python -m pip install -r services/agent/requirements-dev.txt
python -m pytest services/agent
python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

These were run on Windows 11 with native Python 3.13. They have not yet been run under WSL2, macOS, or
Python 3.11; the code avoids syntax newer than 3.10. `GET /healthz` reports service status.

## What works

- Every inbound frame is validated as `ClientMessage` and every outbound frame as `ServerMessage`, using the
  committed JSON Schemas in `packages/contracts`. Invalid frames get an `error` reply; the socket stays open.
- Spoken commands: record, stop recording, play, stop playback, select, clear, mute/unmute, undo, tempo
  (digits, spoken numbers such as "one forty", faster/slower). Boundaries follow the contract guide.
- Wake phrase: outside recording, plain speech is a command. During recording only utterances starting with
  "Groove" are commands; everything else is treated as performance and produces nothing. "Groove, stop" stops
  recording; "Groove, stop playback" stops the transport.
- A recognized command during recording produces a `command-span` (same clock and frames as the utterance)
  followed by the `command`.
- Command IDs are `<utteranceId>:cmd`, so a repeated utterance cannot be applied twice.
- Next-loop commands are issued one at a time, each against the revision reported by the previous
  acknowledgment. Immediate commands are never held back.
- Rejections and commands that never get a final acknowledgment (60 s) are reported as `error` with the
  utterance ID as `requestId`.
- Each connection starts clean. Nothing issued before a disconnect is replayed after a reconnect.
- Only pages served from localhost may open the socket.

## Speech audio

`speech-audio` chunks (docs/CONTRACTS.md) are checked by `speech.py`: seq starts at 0, one payload rate per
stream, at most one second per chunk, contiguous frames. `speech_pipeline.py` segments each stream and hands
closed segments to a `SpeechWorker`; `ThreadedSpeechWorker` transcribes them on a background thread, never on
the event loop. Results come back through `Connection.speech_result`: the transcript follows the utterance path
(recognized "Groove ..." speech during recording gets its measured `command-span`, then a command or an error,
with no mutation on error), and only then can `speech-verified` advance. Coverage is per stream
(`streamId`, `fromFrame`, `throughFrame`), never crosses a gap, and stays behind any segment still being
transcribed. A recognition failure stops that stream's coverage and sends `speech-status available:false`.

### Local recognition (faster-whisper)

Team decision (docs/STATUS.md): local faster-whisper, no API or key. Install the optional requirements and enable it:

```sh
python -m pip install -r services/agent/requirements-speech.txt
GROOVE_STT=faster-whisper python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

The model downloads into the Hugging Face cache on first use (`GROOVE_STT_MODEL`, default `base.en`, about 140 MB;
also `GROOVE_STT_DEVICE`, `GROOVE_STT_COMPUTE`, `GROOVE_STT_THREADS`). `/healthz` reports the speech provider.
Measured on this Windows CPU (int8, 4 threads) with Windows text-to-speech commands, not real users. Each model
recognized all seven test phrases and the interpreter mapped them to the right operations:

| model | load | decode per command | note |
|---|---|---|---|
| tiny.en | 6.5 s | 0.21 s | fastest |
| base.en (default) | 6.7 s | 0.38 s | default: margin for real voices at under 0.5 s |
| small.en | 19.9 s | 1.2 s | slower than the two-second acknowledgment budget allows with hangover |

A spoken command is proposed about hangover (0.6 s) plus decode after it ends. People pause after the wake word, so
segmentation keeps a 0.6 s speech hangover. A segment that is only "Groove" waits up to 2 s for the command that
follows, then gets one span covering both, or is excluded and reported as not understood. Short bursts
(beatboxed hits, under 150 ms of continuous sound) close after 0.1 s of quiet and never reach the recognizer.

`GROOVE_TEST_STT=1 GROOVE_TEST_STT_WAV=<16 kHz mono WAV of "Groove, stop"> python -m pytest services/agent/tests/test_stt.py`
streams that phrase between beatboxed hits through the real Connection, worker and model. Do not commit the WAV.
Physical microphones, real voices, accents and room noise are not yet measured.

Without a configured worker the service answers `available:false` and never sends `speech-verified`.
EXPERIMENTAL: energy segmentation stands in for a real VAD and treats sustained singing as a candidate segment.
`tests/test_speech_harness.py` streams a synthetic WAV through the real `Connection` with a SCRIPTED worker; it
tests timing, coverage and ordering only, not recognition.

## Sound research

`sound-request`, or a spoken description on a synth track ("make it sound like an 80s electric piano"), starts
a job in a worker thread. It streams `research` messages: an immediate `running` at progress 0, then the top
five corpus matches, then refinement progress, then `complete`. `cancel-job` or saying "cancel" ends it with
`cancelled` and the last candidates. "Make it brighter" refines the current candidates; "accept" or "use
number two" proposes `apply-patch` (next-loop) for that candidate on the track the search started from.
Commands are answered while a search runs.

- Parameter space comes from the engine's exported `metadata.json` (`apps/web/public/engine/`, built by
  `scripts/build-engine.py`). Variations are bounded by the firmware descriptors and only touch the engine's
  eight edit parameters plus envelope, filter and effect amounts. Level, pitch, arp, sequencer, scale, pan and
  mute are never varied, so notes are preserved.
- Corpus: every factory preset, plus optional seeded variations, rendered with one fixed phrase. Entries keep
  the full patch, recipe, engine revision, audio and embedding. `Corpus.save` writes under a directory you
  choose (use the git-ignored `artifacts/`).
- Retrieval: top five by cosine similarity. Refinement: seeded evolutionary search, at most 128 renders per
  request; silent, clipping or non-finite renders are rejected.
- Candidate previews are WAV files at `GET /previews/<token>.wav`.

By default no research backend is configured and every request answers `failed` with the reason. Mock rendering/ranking is available only when enabled explicitly:

```sh
GROOVE_RESEARCH=mock python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

Mock mode needs the built `metadata.json` (or `GROOVE_ENGINE_METADATA=<path>`). Its candidates are valid,
bounded patches for the real engine, but the audio comes from a toy synth and the ranking from a hash-based
embedder, so the scores and previews mean nothing musically. Every mock candidate says "MOCK" in `provenance`.
Mock mode was exercised here only with synthetic metadata from the test fixtures, not the real export.

## Remaining acceptance

- Local faster-whisper and optional OpenRouter Deep Agents are implemented. Human recognition/timing, a fixed command-corpus evaluation and full hands-free acceptance remain unfinished.
- Voice-started research visibility and non-mutating voice audition still need the shared proposal in [the WS3 proposal](https://github.com/JettHiggins/VoiceSynthesizer/blob/ws3/voice-research-proposal/services/agent/VOICE-RESEARCH-PROPOSAL.md) approved/implemented. The existing UI preview is usable manually; applying a patch and Undo is not an audition substitute.
- Listening-verified sound quality and comparison against preset-only retrieval need the shared blind kit and human listeners.
- The original physical melody module/chord-loading failure, calibrated performance and ten-minute audible playback still require real-device evidence. Read docs/STATUS.md for current assignments and limitations.

## Layout

- `groove_agent/contracts.py` loads and applies the shared schemas.
- `groove_agent/intents.py` maps a transcript to an operation; `validate_operation` holds semantic rules.
- `groove_agent/connection.py` holds per-connection state and acknowledgment tracking, with no I/O.
- `groove_agent/app.py` is the FastAPI/WebSocket layer.
- `groove_agent/research/space.py` reads engine metadata and produces bounded variations.
- `groove_agent/research/corpus.py`, `search.py` hold retrieval and evolutionary refinement.
- `groove_agent/research/service.py` runs cancellable jobs; `mock.py` is the labeled mock backend.

## Real engine integration

Run from the repository root after `npm ci`, engine build, and installing Python dependencies. `research.sloop.SloopRenderer.from_directory` delegates to Workstream 1's canonical `tools.sloop_renderer`, sharing the browser's TypeScript patch validator and exact note/velocity recipe handling. No wasmtime dependency or duplicate parameter mapper is used. See `docs/RENDERER.md`.

For protocol tests with actual engine audio but deliberately meaningless ranking:

```sh
GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=mock python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

Every candidate still carries MOCK embedder provenance. This is not semantic sound search. Local CLAP mode is opt-in (see below); do not substitute mock rankings for it. Default research remains unconfigured.

Factory corpora cache under `artifacts/corpus/<embedder>` (override `GROOVE_CORPUS_DIR`). Cache reuse checks engine revision, renderer identity, embedder, and recipe. Renderer identity includes actual WASM, metadata, renderer source, and browser snapshot source hashes; changed sound behavior invalidates the cache. Cached retrieval candidates re-render their audio before preview publication. Rebuilding all presets is slower than retrieval from an existing compatible corpus.

Opt-in real-service research test:

```sh
VOICESYNTH_INTEGRATION=1 node --import tsx --test services/agent/tests/integration/research-engine.test.ts
```

Activate the virtualenv so the subprocess's python3 resolves dependencies, or set VOICESYNTH_PYTHON. This test builds a temporary corpus, tests WAV retrieval and candidate acceptance/undo against real WASM, then removes it. Its embedder is explicitly MOCK, so it cannot establish ranking quality.

## Optional local CLAP and listening evaluation

The local CLAP adapter and blind-listening generator are integrated. Install `requirements-research.txt` in a separate research virtualenv, together with the base requirements. They download model weights on first use and do not use an API key. Do not commit model caches.

CLAP mode now defaults to LAION's original music checkpoint, `music_audioset_epoch_15_esc_90.14.pt`, at pinned source revision `b3708341862f581175dba5c356a4ebf74a9b6651`. It uses the pinned `laion/larger_clap_music` architecture/processor, maps the original tensor names with strict coverage checks, and loads with restricted tensor deserialization plus memory mapping. First use downloads about 2.35 GB into the model cache. The public converted music weights produced nearly identical unrelated text embeddings in our probe; the original weights pass distinct-text, paraphrase, audio/text-space and deterministic-audio checks. This establishes working inference, not sound quality. The general checkpoint remains an explicit experimental comparison via `GROOVE_CLAP_MODEL=laion/clap-htsat-unfused`. Default service research remains unconfigured until enabled by the commands below.

Opt-in commands (from repository root, using the research virtualenv):

```sh
GROOVE_TEST_CLAP=1 python -m pytest services/agent/tests/test_clap.py
GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
PYTHONPATH=services/agent GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap python -m groove_agent.research.benchmark
PYTHONPATH=services/agent GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap python -m groove_agent.research.evaluate artifacts/blind-v1 --seed 20261114
```

(On Windows use `PYTHONPATH="services/agent;."`.)

### Ranking

Retrieval and refinement rank with `retrieval.Ranking` (see its docstring and docs/CLAP.md): a seven-template
prompt ensemble, hub correction against a fixed instrument vocabulary, and a preset-name prior with weight
0.75 (audio stays the larger term; variations inherit their factory preset's name). Scores are z-scored ranking
values, not cosines. `benchmark` reports, for 8 tuning and 12 held-out prompts, the rank of the first preset of
the requested instrument family, judged from preset names. It catches family mismatches such as
"80s electric piano" -> PHYS / TIMPANI; it says nothing about which candidate sounds best.

The first request after a corpus rebuild embeds ~1,300 fixed index texts (about 16 s on two CPU threads) and
caches them in `text-embeddings.npz` beside the corpus; later restarts take about 0.1 s. Spoken descriptions are
never written to that file.

### Blind listening kit

`evaluate` writes the listening directory (A/B WAVs, blank `sheet.csv`, `kit.json`) and, separately,
`<dir>-answer-key/` (`answers.json`, `latency.csv`). Give listeners only the listening directory. With the same
seed (`--seed`, default 20261114), prompts (`--prompts fixed|all|"a,b"`), engine build and model revisions,
every laptop gets the same A/B order; compare `kit.json`'s `fingerprint` to confirm the audio is identical too.
If fingerprints differ, pool results only for one shared kit. Embedding scores and synthetic tests do not replace
the three-person listening comparison in PLAN.md.

`scripts/clap_native_parity.py` reproduces the comparison with LAION's native model code (see its docstring).

### Speech timing inside joined singing/command segments

Local recognition now returns internal word alignment: the existing wire command-span begins at the measured Groove/Grove onset with 120 ms pre-roll, rather than deleting all preceding singing in the same energy segment. It includes the measured end plus at most 120 ms of already-classified quiet. Invalid/missing alignment remains conservative. Paused wake joining and capture-time take checks stay enabled. See TIMED-SPEECH-HANDOFF.md for tests and the pending exact browser reproduction.

## Optional OpenRouter / Deep Agents

Install `python -m pip install -r services/agent/requirements-llm.txt` in the backend environment. Copy `.env.example` to the ignored `services/agent/.env`, configure your distinct backend OpenRouter key locally, and set `GROOVE_LLM=openrouter`. Only that backend file is loaded; existing process variables take precedence. Keys must never go into browser/VITE variables, chat, source or logs. Start the usual uvicorn command. `/healthz` reports language mode without credentials. Leave GROOVE_LLM blank for the standalone parser.

`GROOVE_LLM_MODEL` starts with the team's unranked evaluation candidate `inclusionai/ling-3.2-flash:free`. Other `owner/model:free` IDs and `openrouter/free` are allowed; paid models, auto routing and fallback lists are refused. The API base is fixed, price caps are zero, and provider fallback/retry are disabled. Timeout defaults to 8 seconds (maximum 30), output to 512 tokens (maximum 2048). Each run permits three model calls and four tool calls. References: [OpenRouter LangChain integration](https://openrouter.ai/docs/guides/community/langchain), [Deep Agents customization](https://docs.langchain.com/oss/python/deepagents/customization).

Familiar commands use the parser immediately. Unknown addressed speech can use an actual Deep Agents graph asynchronously. During recording, speech without Groove/Grove is ignored before a provider request. Wake exclusion precedes coverage without waiting on inference. The model receives text and a compact tempo/selection/mixer/research summary, never raw PCM, composition notes or patch payloads. Tools propose existing operations or search/refine/accept/cancel sound jobs; they cannot access files, delegate, invent patches or add wire operations. Exactly one action is required; multiple proposals produce no partial application. Browser validation remains authoritative. Audition remains a browser UI action until an additive voice-audition contract is agreed.

Each socket permits one running language request and four queued requests. Disconnect cancels pending inference. Late results are refused after take/clock/revision changes, newer edits (including revision-preserving Undo), or replacement candidates. Timeout/quota/auth failures produce explicit errors with no mutation; provider exception text is never forwarded. Parser commands remain available after provider errors.

Run `python services/agent/scripts/language_check.py "Groove stop" --recording` for an offline parser result. Add `--live` only after local backend configuration to explicitly measure that text against the selected free model. It reports latency and parser agreement; agreement is not correctness. No live call validated this implementation. `test_language.py` exercises the real graph using a scripted chat model when optional dependencies are installed. WS4's frozen corpus, provider comparison, browser integration and human acceptance remain open.
