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

log = logging.getLogger("groove_agent")
TICK_SECONDS = 1.0
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

app = FastAPI(title="VoiceSynthesizer agent service", version=__version__)
# No research backend unless GROOVE_RESEARCH is set; a misconfigured one fails at startup, not mid-session.
research_service = ResearchService(backend_from_env(contracts_dir().parents[1]),
                                     os.environ.get("GROOVE_PUBLIC_URL", "http://127.0.0.1:8000"))


@app.get("/healthz")
def healthz() -> dict:
    backend = research_service.backend
    return {"status": "ok", "version": __version__, "contract": 1,
            "research": backend.label if backend else "not configured"}


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
            connection.observe_research(message)
            outbox.put_nowait(message)
        try:
            loop.call_soon_threadsafe(deliver)
        except RuntimeError:
            pass  # loop already closed during shutdown

    port = research_service.port(from_worker)
    connection = Connection(research=port)

    async def tick() -> None:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            for reply in connection.tick(time.monotonic()):
                outbox.put_nowait(reply)

    async def write() -> None:
        while True:
            await websocket.send_text(json.dumps(checked(await outbox.get())))

    def finished(task: "asyncio.Task[None]") -> None:
        if not task.cancelled() and task.exception() is not None:
            log.warning("connection task ended: %r", task.exception())

    tasks = [asyncio.ensure_future(job()) for job in (tick, write)]
    for task in tasks:
        task.add_done_callback(finished)
    try:
        while True:
            message, error = decode(await websocket.receive_text())
            replies = [error] if message is None else connection.handle(message, time.monotonic())
            for reply in replies:
                outbox.put_nowait(reply)
    except WebSocketDisconnect:
        pass
    finally:
        # Pending proposals and research jobs die with the connection; nothing is replayed after a reconnect.
        port.close()
        for task in tasks:
            task.cancel()
