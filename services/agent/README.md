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

These were run on Windows 11 with native Python 3.13, and CI runs the tests on Linux with Python 3.11.
They have not been run under WSL2 or macOS. `GET /healthz` reports service status.

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

By default no research backend is configured and every request answers `failed` with the reason. Backends are
chosen with environment variables when the service starts:

| `GROOVE_RESEARCH` | `GROOVE_EMBEDDER` | Audio | Ranking |
| --- | --- | --- | --- |
| unset | | none | none: requests fail with the reason |
| `sloop` | `clap` | real: the built `voicesynth.wasm`, run offline | LAION CLAP (general checkpoint), run locally |
| `sloop` | `mock` | real | meaningless (hash embedder); for wiring tests |
| `mock` | | toy synth, not SLOOP | meaningless |

```sh
python -m pip install -r services/agent/requirements-research.txt   # only for GROOVE_EMBEDDER=clap
GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

- `sloop` needs the engine assets in `apps/web/public/engine/` (`scripts/build-engine.py`, or the
  `sloop-browser-engine` artifact from the firmware-parity CI job). The renderer loads the same WASM as the
  browser and sets up the track the way `firmwareSnapshot` does. Notes are played through the engine's live
  note input at its fixed velocity.
- `clap` downloads the model weights (`laion/clap-htsat-unfused`, override with `GROOVE_CLAP_MODEL`) to the
  Hugging Face cache on first start. No API key is used. Torch and transformers are not in the base requirements.
- The corpus is built on the first request and cached in `artifacts/corpus/<embedder>/` (git-ignored). A cache
  made with a different engine revision, renderer, embedder or recipe is ignored and rebuilt.
- Patches never contain the parameters the browser engine owns (level, arp mode, sequence length, division,
  swing, gate, mute); the engine rejects patches that set them.
- Anything produced with a mock says "MOCK" in each candidate's `provenance`.

## Not done yet

- Speech-to-text. The service consumes `utterance` transcripts; an audio/provider protocol needs a contract
  proposal and a credential decision first.
- Deep Agents orchestration. `intents.interpret` is the seam a model-backed interpreter replaces; it needs API access.
- The CLAP *music* checkpoint named in PLAN.md. Its Hugging Face port (`laion/larger_clap_music`) loads but gives
  degenerate embeddings with transformers 5.23, so the general checkpoint is the default and the service refuses a
  degenerate model at start-up. The official `laion_clap` checkpoint route is untried.
- The blind listening itself. `python -m groove_agent.research.evaluate` (run from `services/agent` with
  `GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap`) writes an A/B kit to `artifacts/evaluation/`: preset-only retrieval
  versus retrieval plus search for eight fixed prompts, a listening sheet, a hidden answer key and latencies. All
  three teammates still need to listen and fill in the sheet. Similarity scores are not a measure of musical quality.
- Audition in the browser UI. The harness has no control that plays `previewUrl` or shows candidates.
- Drum-track sound search (the engine has no drum-kit patch contract yet).

## Layout

- `groove_agent/contracts.py` loads and applies the shared schemas.
- `groove_agent/intents.py` maps a transcript to an operation; `validate_operation` holds semantic rules.
- `groove_agent/connection.py` holds per-connection state and acknowledgment tracking, with no I/O.
- `groove_agent/app.py` is the FastAPI/WebSocket layer.
- `groove_agent/research/space.py` reads engine metadata and produces bounded variations.
- `groove_agent/research/corpus.py`, `search.py` hold retrieval and evolutionary refinement.
- `groove_agent/research/service.py` runs cancellable jobs; `mock.py` is the labeled mock backend.
- `groove_agent/research/sloop.py` renders with the real engine WASM; `clap.py` is the CLAP embedder.
- `tests/integration/research-engine.test.ts` drives the real engine core through the production adapter.
