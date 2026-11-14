"""Interactive patch defaults are immediate; explicit legacy scheduled proposals remain valid."""
import pytest

from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture
from groove_agent.intents import BOUNDARY, Command


@pytest.mark.parametrize("boundary", ["immediate", "next-loop", "next-beat"])
def test_explicit_patch_boundaries(boundary):
    session = load_fixture("SessionState")
    operation = {"type": "apply-patch", "trackId": "synth-1", "patch": session["tracks"][0]["patch"]}
    connection = Connection(interpreter=lambda *args, **kwargs: Command(operation, boundary))
    connection.handle({"type": "session", "session": session}, 0)
    out = connection.handle({"type": "utterance", "id": "patch", "text": "fixture patch", "clockId": "clock",
                             "startFrame": 0, "endFrame": 0, "duringRecording": False}, 0)
    if boundary == "next-beat":
        assert [message["type"] for message in out] == ["error"]
    else:
        assert out[0]["command"]["boundary"] == boundary
    assert BOUNDARY["apply-patch"] == "immediate"


def test_rapid_patches_wait_for_ack_but_stop_does_not():
    session = load_fixture("SessionState")
    patch = {"type": "apply-patch", "trackId": "synth-1", "patch": session["tracks"][0]["patch"]}
    connection = Connection(interpreter=lambda text, *args, **kwargs:
                            Command({"type": "stop-recording"}, "immediate") if text == "stop"
                            else Command(patch, "immediate"))
    connection.handle({"type": "session", "session": session}, 0)

    def say(identifier, text="patch"):
        return connection.handle({"type": "utterance", "id": identifier, "text": text, "clockId": "clock",
                                  "startFrame": 0, "endFrame": 0, "duringRecording": False}, 0)

    assert say("first")[0]["command"]["boundary"] == "immediate"
    assert say("second") == []
    assert say("third") == []
    assert say("stop", "stop")[0]["command"]["operation"] == {"type": "stop-recording"}
    for previous, following, revision in [("first", "second", 1), ("second", "third", 2)]:
        # Receipt of queued is not permission to issue a competing patch.
        assert connection.handle({"type": "ack", "commandId": previous + ":cmd", "status": "queued",
                                  "revision": revision - 1}, 0) == []
        out = connection.handle({"type": "ack", "commandId": previous + ":cmd", "status": "applied",
                                 "revision": revision}, 0)
        assert out[0]["command"]["id"] == following + ":cmd"
        assert out[0]["command"]["expectedRevision"] == revision
        assert out[0]["command"]["boundary"] == "immediate"
