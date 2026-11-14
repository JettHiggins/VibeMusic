"""FastAPI entry point: ws://127.0.0.1:8000/ws with JSON text frames (docs/CONTRACTS.md).

Every inbound frame is validated as ClientMessage and every outbound frame as
ServerMessage. The socket loop is deliberately thin; behavior lives in
`connection.Connection`.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Optional
from urllib.parse import urlsplit

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from . import __version__
from .connection import Connection
from .contracts import ContractError, validate

log = logging.getLogger("groove_agent")
TICK_SECONDS = 1.0
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

app = FastAPI(title="VoiceSynthesizer agent service", version=__version__)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "version": __version__, "contract": 1}


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
    connection = Connection()
    try:
        while True:
            try:
                text = await asyncio.wait_for(websocket.receive_text(), timeout=TICK_SECONDS)
            except asyncio.TimeoutError:
                replies = connection.tick(time.monotonic())
            else:
                message, error = decode(text)
                replies = [error] if message is None else connection.handle(message, time.monotonic())
            for reply in replies:
                await websocket.send_text(json.dumps(checked(reply)))
    except WebSocketDisconnect:
        # Pending proposals die with the connection; nothing is replayed after a reconnect.
        return
