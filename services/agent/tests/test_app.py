import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from groove_agent.app import app, origin_allowed
from groove_agent.contracts import SCHEMA_NAMES, load_fixture, validate

client = TestClient(app)


def exchange(ws, message):
    ws.send_text(json.dumps(message))
    reply = json.loads(ws.receive_text())
    validate("ServerMessage", reply)
    return reply


def test_health():
    assert client.get("/healthz").json()["status"] == "ok"


@pytest.mark.parametrize("name", SCHEMA_NAMES)
def test_shared_fixtures_validate(name):
    validate(name, load_fixture(name))


def test_websocket_round_trip_with_shared_fixture():
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps(load_fixture("ClientMessage")))  # session snapshot
        reply = exchange(ws, {"type": "utterance", "id": "u1", "text": "select snare", "clockId": "c",
                              "startFrame": 0, "endFrame": 10, "duringRecording": False})
        assert reply["command"]["operation"] == {"type": "select", "target": {"trackId": "drums", "lane": "snare"}}
        assert reply["command"]["expectedRevision"] == 0


def test_invalid_frames_get_errors_and_keep_the_socket_open():
    with client.websocket_connect("/ws") as ws:
        ws.send_text("not json")
        assert json.loads(ws.receive_text())["type"] == "error"
        reply = exchange(ws, {"type": "utterance", "id": "u9", "text": "", "extra": 1})
        assert reply == {**reply, "type": "error", "requestId": "u9"}
        reply = exchange(ws, {"type": "ack", "commandId": "x", "status": "applied", "revision": -1})
        assert reply["type"] == "error" and reply["requestId"] == "x"
        ws.send_text(json.dumps(load_fixture("ClientMessage")))
        assert exchange(ws, {"type": "utterance", "id": "u2", "text": "undo", "clockId": "c", "startFrame": 0,
                             "endFrame": 1, "duringRecording": False})["type"] == "command"


def test_reconnect_starts_clean():
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps(load_fixture("ClientMessage")))
        exchange(ws, {"type": "utterance", "id": "u1", "text": "record kick", "clockId": "c", "startFrame": 0,
                      "endFrame": 1, "duringRecording": False})
    with client.websocket_connect("/ws") as ws:
        reply = exchange(ws, {"type": "utterance", "id": "u2", "text": "undo", "clockId": "c", "startFrame": 0,
                              "endFrame": 1, "duringRecording": False})
        assert reply["type"] == "error" and "session" in reply["message"]


def test_origin_policy():
    assert origin_allowed(None)
    assert origin_allowed("http://localhost:5173")
    assert origin_allowed("http://127.0.0.1:5173")
    assert not origin_allowed("https://example.com")
    assert not origin_allowed("null")
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"origin": "https://example.com"}):
            pass
