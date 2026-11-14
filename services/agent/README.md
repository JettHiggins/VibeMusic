# Agent service (Workstream 3)

Local FastAPI service that turns utterance transcripts into `SessionCommand` proposals over
`ws://127.0.0.1:8000/ws`. The browser stays authoritative for musical state and timing; this service
only reads snapshots and requests mutations. See `docs/CONTRACTS.md` for the protocol.

No API calls are made and no credentials are read. Command interpretation is deterministic and local.

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

## Not done yet

- Speech-to-text. The service consumes `utterance` transcripts; an audio/provider protocol needs a contract
  proposal and a credential decision first.
- Deep Agents orchestration. `intents.interpret` is the seam a model-backed interpreter replaces; it needs API access.
- Meaningful text-to-sound ranking. The real SLOOP renderer is integrated, but the LAION CLAP embedder is not implemented/configured yet. Sound relevance and musical quality remain unverified.
- Research evaluation against preset-only retrieval with blind listening.
- Physical microphone and speech integration remain pending. The browser Agent workspace now includes candidate previews, provenance and exact-candidate acceptance; its controller and the real WASM core have live research integration tests. Actual speech recognition and semantic ranking/listening gates are still pending.

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
GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap python -m groove_agent.research.evaluate artifacts/evaluation
```

For the evaluation module, include `PYTHONPATH=services/agent` when launching from the repository root. Evaluation writes seeded A/B WAVs, a listening sheet, a separate answer key, and measured latencies. Keep the key separate from listeners until preferences are recorded. Embedding scores and synthetic tests do not replace the three-person listening comparison in PLAN.md.
