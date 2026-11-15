"""FastAPI entry point: ws://127.0.0.1:8000/ws with JSON text frames (docs/CONTRACTS.md).

Every inbound frame is validated as ClientMessage and every outbound frame as
ServerMessage. The socket loop is deliberately thin; behavior lives in
`connection.Connection`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Optional
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect

from . import __version__
from .connection import Connection
from .contracts import ContractError, contracts_dir, validate
from .research.service import ResearchService, backend_from_env
from .speech_pipeline import ThreadedSpeechWorker
from .stt import transcriber_from_env
from .language import LanguageWorker, language_from_env, load_backend_env, voice_research_enabled

log = logging.getLogger("groove_agent")
# Session events go to the service console (local only): what was heard, what was done, research job
# lifecycle and provider errors, so a failed playtest can be diagnosed afterwards. Never keys or audio.
if not log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s groove %(levelname)s %(message)s", "%H:%M:%S"))
    log.addHandler(_handler)
log.setLevel(logging.INFO)
log.propagate = False


def describe_event(message: dict) -> Optional[str]:
    """One console line for an outbound message worth recording, or None (watermarks, progress)."""
    kind = message.get("type")
    if kind == "speech-transcript":
        detail = f" ({message['detail']})" if message.get("detail") else ""
        return f"heard {message['text']!r} -> {message['outcome']}{detail}"
    if kind == "command":
        operation = message["command"]["operation"]
        return f"command {message['command']['id']}: {operation['type']}"
    if kind == "browser-action":
        return f"input action {message['id']}: {message['operation']['type']}"
    if kind == "error":
        return f"refused {message['requestId']}: {message['message']}"
    if kind == "research-context":
        return f"research {message['jobId']} announced for {message['trackId']}: {message['description']!r}"
    if kind == "research" and message.get("status") != "running":
        extra = f" error={message['error']!r}" if message.get("error") else ""
        return f"research {message['jobId']} {message['status']} with {len(message['candidates'])} candidates{extra}"
    if kind == "candidate-preview":
        return f"preview {message['candidateId']} requested"
    return None
TICK_SECONDS = 1.0
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

app = FastAPI(title="VoiceSynthesizer agent service", version=__version__)
load_backend_env()
# No research backend unless GROOVE_RESEARCH is set; a misconfigured one fails at startup, not mid-session.
research_service = ResearchService(backend_from_env(contracts_dir().parents[1]),
                                     os.environ.get("GROOVE_PUBLIC_URL", "http://127.0.0.1:8000"))
# No speech recognition unless GROOVE_STT is set (local faster-whisper); loaded once and shared.
transcriber = transcriber_from_env()
language = language_from_env()
voice_research = voice_research_enabled()


def language_label() -> str:
    if language is None:
        return "parser"
    gate = getattr(language, "gate", None)
    remaining = gate.blocked() if gate is not None else None
    config = getattr(language, "config", None)
    label = config.label if config is not None else "openrouter/deepagents (free-only)"
    return label if remaining is None else f"{label}; cooling down {max(1, round(remaining))} s, exact commands only"


@app.get("/healthz")
def healthz() -> dict:
    backend = research_service.backend
    return {"status": "ok", "version": __version__, "contract": 1,
            "research": backend.label if backend else "not configured",
            "speech": transcriber.name if transcriber else "not configured",
            "language": language_label(),
            "voiceResearch": voice_research}


@app.get("/previews/{token}.wav")
def preview(token: str, request: Request) -> Response:
    """Audio of one research candidate, rendered by the configured renderer."""
    audio = research_service.preview(token)
    if audio is None:
        return Response(status_code=404)
    headers = {"Cache-Control": "no-store"}
    origin = request.headers.get("origin")
    if origin and origin_allowed(origin):
        headers["Access-Control-Allow-Origin"] = origin  # lets the local page decode previews with Web Audio
    return Response(audio, media_type="audio/wav", headers=headers)


def origin_allowed(origin: Optional[str]) -> bool:
    """Only local pages may drive this service; other sites could otherwise reach a localhost socket."""
    if origin is None:
        return True  # non-browser clients such as tests and scripts send no Origin
    host = urlsplit(origin).hostname
    return host is not None and (host in LOCAL_HOSTS or host.endswith(".localhost"))


def decode(text: str) -> tuple[Optional[dict], Optional[dict]]:
    """Return (message, None) for a valid ClientMessage, else (None, error ServerMessage)."""
    try:
        payload: Any = json.loads(text)
    except ValueError:
        return None, {"type": "error", "requestId": "invalid-message", "message": "frame is not valid JSON"}
    try:
        validate("ClientMessage", payload)
    except ContractError as error:
        request_id = "invalid-message"
        if isinstance(payload, dict):
            for key in ("id", "commandId", "jobId"):
                if isinstance(payload.get(key), str) and payload[key]:
                    request_id = payload[key]
                    break
        return None, {"type": "error", "requestId": request_id, "message": str(error)[:500]}
    return payload, None


def checked(message: dict) -> dict:
    """Never put a frame on the wire that breaks the shared contract."""
    try:
        validate("ServerMessage", message)
        return message
    except ContractError as error:
        log.error("dropped invalid outbound message: %s", error)
        return {"type": "error", "requestId": "server", "message": "internal error: invalid outbound message"}


@app.websocket("/ws")
async def session_socket(websocket: WebSocket) -> None:
    if not origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    loop = asyncio.get_running_loop()
    outbox: "asyncio.Queue[dict]" = asyncio.Queue()

    def from_worker(message: dict) -> None:
        """Called on research worker threads; hands the message to the event loop."""
        def deliver() -> None:
            try:
                validate("ServerMessage", message)
            except ContractError:
                outbox.put_nowait(checked(message))
                return
            if message["type"] != "research":
                outbox.put_nowait(message)
                return
            replies = connection.observe_research(message)
            if replies is None:
                return
            outbox.put_nowait(message)
            for reply in replies:
                outbox.put_nowait(reply)
        try:
            loop.call_soon_threadsafe(deliver)
        except RuntimeError:
            pass  # loop already closed during shutdown

    def from_speech(job, text, error) -> None:
        """Called on the speech worker thread; results are applied on the event loop, in order."""
        def deliver() -> None:
            for reply in connection.speech_result(job, text, error, time.monotonic()):
                outbox.put_nowait(reply)
        try:
            loop.call_soon_threadsafe(deliver)
        except RuntimeError:
            pass

    port = research_service.port(from_worker)
    speech = ThreadedSpeechWorker(transcriber, from_speech) if transcriber is not None else None

    def from_language(job, result, error) -> None:
        for reply in connection.language_result(job, result, error, time.monotonic()):
            outbox.put_nowait(reply)

    language_worker = LanguageWorker(language, from_language) if language is not None else None
    connection = Connection(research=port, speech=speech, language=language_worker, voice_research=voice_research)

    async def tick() -> None:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            for reply in connection.tick(time.monotonic()):
                outbox.put_nowait(reply)

    async def write() -> None:
        while True:
            message = checked(await outbox.get())
            event = describe_event(message)
            if event:
                log.info(event)
            await websocket.send_text(json.dumps(message))

    def finished(task: "asyncio.Task[None]") -> None:
        if not task.cancelled() and task.exception() is not None:
            log.warning("connection task ended: %r", task.exception())

    tasks = [asyncio.ensure_future(job()) for job in (tick, write)]
    for task in tasks:
        task.add_done_callback(finished)
    try:
        while True:
            message, error = decode(await websocket.receive_text())
            if message is not None and message["type"] in ("cancel-job", "utterance", "browser-action-ack", "preview-ack"):
                if message["type"] == "cancel-job":
                    log.info("browser cancelled research %s", message["jobId"])
                elif message["type"] == "utterance":
                    log.info("typed %r", message["text"])
                elif message["status"] in ("rejected", "cancelled"):
                    log.info("browser %s %s: %s%s", message["type"], message["id"], message["status"],
                             f" ({message['reason']})" if message.get("reason") else "")
            replies = [error] if message is None else connection.handle(message, time.monotonic())
            for reply in replies:
                outbox.put_nowait(reply)
    except WebSocketDisconnect:
        pass
    finally:
        # Pending proposals and research jobs die with the connection; nothing is replayed after a reconnect.
        connection.close()
        port.close()
        if speech is not None:
            speech.close()
        if language_worker is not None:
            await language_worker.close()
        for task in tasks:
            task.cancel()
