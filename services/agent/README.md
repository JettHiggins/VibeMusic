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

By default no research backend is configured and every request answers `failed` with the reason. The only
backend that exists is a mock, enabled explicitly:

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
- Real sound research. It needs an offline renderer for the pinned SLOOP engine (Workstream 1) implementing
  `research.audio.Renderer`, and a LAION CLAP embedder implementing `research.audio.Embedder` (model download and
  a dependency decision). Until both exist, nothing here has been evaluated for musical quality.
- Research evaluation against preset-only retrieval with blind listening.
- Integration with a real browser client. Tested only against the shared fixtures and a scripted WebSocket client.

## Layout

- `groove_agent/contracts.py` loads and applies the shared schemas.
- `groove_agent/intents.py` maps a transcript to an operation; `validate_operation` holds semantic rules.
- `groove_agent/connection.py` holds per-connection state and acknowledgment tracking, with no I/O.
- `groove_agent/app.py` is the FastAPI/WebSocket layer.
- `groove_agent/research/space.py` reads engine metadata and produces bounded variations.
- `groove_agent/research/corpus.py`, `search.py` hold retrieval and evolutionary refinement.
- `groove_agent/research/service.py` runs cancellable jobs; `mock.py` is the labeled mock backend.
