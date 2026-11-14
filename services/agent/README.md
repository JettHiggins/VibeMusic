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

## Not done yet

- Speech-to-text. The service consumes `utterance` transcripts; an audio/provider protocol needs a contract
  proposal and a credential decision first.
- Deep Agents orchestration. `intents.interpret` is the seam a model-backed interpreter replaces; it needs API access.
- Sound research. `sound-request` currently answers `failed` rather than returning invented candidates.
- Integration with a real browser client. Tested only against the shared fixtures and a scripted WebSocket client.

## Layout

- `groove_agent/contracts.py` loads and applies the shared schemas.
- `groove_agent/intents.py` maps a transcript to an operation; `validate_operation` holds semantic rules.
- `groove_agent/connection.py` holds per-connection state and acknowledgment tracking, with no I/O.
- `groove_agent/app.py` is the FastAPI/WebSocket layer.
