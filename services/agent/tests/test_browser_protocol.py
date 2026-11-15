"""Voice reliability round, WS3 P0: published browser-status / browser-action-ack handling.

Against MUSICAL-CONTROL-CONTRACT.md "Browser-local input actions". The playtest UI reported
"unsupported message type" for these valid ClientMessages; they must be accepted by the real
WebSocket service, tracked against the browser's clock/inputRevision, and only our own requests'
acknowledgments may finish them. Malformed or unknown messages are still refused.
"""
import json

import pytest
from fastapi.testclient import TestClient

from groove_agent.app import app
from groove_agent.connection import BROWSER_ACTION_START_TIMEOUT_S, Connection
from groove_agent.contracts import load_fixture, validate
from groove_agent.intents import Command, interpret

CLOCK = "clock-1"


def status(revision=2, active=None, microphone="on", available=True, clock=CLOCK):
    message = {"type": "browser-status", "clockId": clock, "inputRevision": revision, "available": available,
               "microphone": microphone, "profile": "noisy-room",
               "calibration": {"noiseMeasured": True, "noiseFloorDb": -48, "latencySource": "tap-along",
                               "latencyMs": 120, "offsetAdjustMs": 0},
               "activeAction": active}
    validate("ClientMessage", message)
    return message


def transport(playing=False, recording_state="idle", clock=CLOCK):
    t = {"clockId": clock, "sampleRate": 44100, "currentFrame": 1000, "loopStartFrame": 0, "playing": playing,
         "recording": recording_state == "recording", "pendingCommandIds": [], "recordingState": recording_state}
    return {"type": "transport", "transport": t}


def ack(action_id, state, revision=2, reason=None, clock=CLOCK):
    message = {"type": "browser-action-ack", "id": action_id, "clockId": clock, "inputRevision": revision, "status": state}
    if reason:
        message["reason"] = reason
    validate("ClientMessage", message)
    return message


def say(text, uid):
    return {"type": "utterance", "id": uid, "text": text, "clockId": CLOCK, "startFrame": 0, "endFrame": 10,
            "duringRecording": False}


def ready(**status_args):
    connection = Connection()
    connection.handle({"type": "session", "session": load_fixture("SessionState")}, 0)
    connection.handle(transport(), 0)
    assert connection.handle(status(**status_args), 0) == []
    return connection


def test_published_fixtures_are_accepted_without_unsupported_errors():
    connection = ready()
    for message in load_fixture("MusicalControls"):
        if message["type"] in ("browser-status", "browser-action-ack"):
            assert connection.handle(message, 0) == [], message


@pytest.mark.parametrize("text, operation", [
    ("calibrate", {"type": "calibrate-input", "mode": "full"}),
    ("measure the silence", {"type": "calibrate-input", "mode": "noise"}),
    ("calibrate timing", {"type": "calibrate-input", "mode": "timing"}),
    ("check timing", {"type": "calibrate-input", "mode": "check-timing"}),
    ("use the music profile", {"type": "set-input-profile", "profile": "music"}),
    ("set offset to minus 20 milliseconds", {"type": "set-input-offset", "milliseconds": -20}),
])
def test_exact_phrases_issue_a_bound_browser_action_not_a_session_command(text, operation):
    connection = ready()
    [action] = connection.handle(say(text, "u1"), 0)
    validate("ServerMessage", action)
    assert action["type"] == "browser-action" and action["operation"] == operation
    assert action["clockId"] == CLOCK and action["expectedInputRevision"] == 2
    assert connection.pending_command_ids == []  # never enters the engine queue


def test_acknowledgments_finish_only_our_request_and_report_real_failures():
    connection = ready()
    [action] = connection.handle(say("calibrate", "u1"), 0)
    assert connection.handle(ack("someone-else", "rejected", reason="x"), 0) == []
    assert connection.handle(ack(action["id"], "complete", clock="old-clock"), 0) == []  # wrong clock: ignored
    assert connection.handle(ack(action["id"], "running"), 1) == []
    assert connection.handle(say("calibrate noise", "u2"), 1)[0]["message"].startswith("an input action is already running")
    [error] = connection.handle(ack(action["id"], "rejected", reason="Room too loud to measure"), 2)
    assert error == {"type": "error", "requestId": "u1", "message": "calibration was rejected: Room too loud to measure"}
    assert connection.handle(ack(action["id"], "complete"), 3) == []  # terminal already handled


def test_cancel_names_the_browsers_active_action_and_cancellation_is_reported():
    connection = ready(active={"id": "manual-7", "kind": "calibrate-input", "phase": "countdown"})
    assert "already running" in connection.handle(say("calibrate", "u0"), 0)[0]["message"]
    [cancel] = connection.handle(say("cancel calibration", "u1"), 0)
    assert cancel["operation"] == {"type": "cancel-input-action", "actionId": "manual-7"}
    assert connection.handle(ack(cancel["id"], "complete"), 1) == []
    idle = ready()
    assert "no input calibration" in idle.handle(say("cancel calibration", "u2"), 0)[0]["message"]


def test_actions_refuse_without_capability_or_in_unsafe_transport_states():
    assert "not available" in ready(available=False).handle(say("calibrate", "u"), 0)[0]["message"]
    no_status = Connection()
    no_status.handle({"type": "session", "session": load_fixture("SessionState")}, 0)
    assert "not available" in no_status.handle(say("calibrate", "u"), 0)[0]["message"]
    connection = ready(microphone="off")
    assert "microphone on" in connection.handle(say("calibrate", "u"), 0)[0]["message"]
    connection = ready()
    connection.handle(transport(playing=True), 0)
    assert "stop playback first" in connection.handle(say("calibrate", "u1"), 0)[0]["message"]
    assert connection.handle(say("music profile", "u2"), 0)[0]["type"] == "browser-action"  # allowed while playing
    connection = ready()
    connection.handle(transport(playing=True, recording_state="armed"), 0)
    assert "stop recording" in connection.handle(say("music profile", "u3"), 0)[0]["message"]


def test_unacknowledged_requests_time_out_instead_of_blocking_later_actions():
    connection = ready()
    [action] = connection.handle(say("calibrate", "u1"), 0)
    [error] = connection.tick(BROWSER_ACTION_START_TIMEOUT_S + 0.1)
    assert error["requestId"] == "u1" and "did not finish" in error["message"]
    assert connection.handle(say("calibrate", "u2"), 20)[0]["type"] == "browser-action"


def test_stale_and_other_clock_status_snapshots_never_replace_the_current_input():
    connection = ready(revision=5)
    connection.handle(status(revision=4), 0)
    connection.handle(status(revision=9, clock="other-clock"), 0)
    assert connection.browser_status["inputRevision"] == 5 and connection.browser_status["clockId"] == CLOCK


def test_input_change_invalidates_a_pending_model_decision():
    class Pending:
        jobs = []
        def submit(self, job):
            self.jobs.append(job)
            return True
    connection = ready()
    connection._language = language = Pending()
    connection.handle(say("Groove transform this into glassy bells", "u1"), 0)
    connection.handle(status(revision=3), 1)  # e.g. calibration applied a new offset
    [reply] = connection.language_result(language.jobs[0], Command({"type": "tempo", "bpm": 130}, "next-loop"), None, 2)
    assert reply["type"] == "error" and "changed" in reply["message"]


def test_actual_websocket_service_accepts_status_and_acks_and_still_rejects_malformed():
    with TestClient(app).websocket_connect("/ws") as ws:
        ws.send_json({"type": "session", "session": load_fixture("SessionState")})
        ws.send_json(transport())
        ws.send_json(status())
        ws.send_json(ack("calibration-1", "running"))  # unknown to this connection: silently ignored
        ws.send_json(say("calibrate timing", "u1"))
        action = ws.receive_json()  # the first reply proves the status/ack frames produced no errors
        validate("ServerMessage", action)
        assert action["type"] == "browser-action" and action["operation"] == {"type": "calibrate-input", "mode": "timing"}
        ws.send_json(ack(action["id"], "running"))
        ws.send_json(ack(action["id"], "rejected", revision=2, reason="No taps were heard"))
        assert ws.receive_json() == {"type": "error", "requestId": "u1",
                                     "message": "calibration was rejected: No taps were heard"}
        bad = status()
        bad["inputRevision"] = -1
        ws.send_text(json.dumps(bad))
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "browser-telemetry", "clockId": CLOCK})
        reply = ws.receive_json()
        assert reply["type"] == "error" and "unsupported message type" not in reply["message"]  # schema refusal


def test_key_phrases_are_exact_immediate_commands_and_snap_needs_a_key():
    session = load_fixture("SessionState")
    session["selected"] = {"trackId": "synth-2"}
    assert interpret("Groove, key F sharp minor", session, False) == Command(
        {"type": "set-pitch-snap", "settings": {"root": 6, "scale": "minor"}}, "immediate")
    assert interpret("turn key snapping off", session, False) == Command({"type": "set-pitch-snap", "settings": None}, "immediate")
    assert interpret("key D", session, False).reason.startswith("say a key")
    assert interpret("key C and D minor", session, False).reason == "say one key root at a time"
    assert interpret("snap the existing notes", session, False).reason.startswith("choose a key first")
    session["pitchSnap"] = {"root": 2, "scale": "minor"}
    assert interpret("snap the existing notes", session, False) == Command({"type": "snap-notes", "trackId": "synth-2"}, "next-loop")
    assert interpret("snap the notes on synth three", session, False).operation["trackId"] == "synth-3"
    assert "which synth" in interpret("snap the notes on the kick", session, False).reason
    for text in ("key D minor", "turn key snapping off", "snap the existing notes on synth one"):
        result = interpret(text, session, False)
        validate("SessionCommand", {"id": "x", "expectedRevision": 0, "boundary": result.boundary, "operation": result.operation})
