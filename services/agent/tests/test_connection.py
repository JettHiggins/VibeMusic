import pytest

from groove_agent.connection import MAX_BACKLOG, Connection
from groove_agent.contracts import load_fixture, validate

CLOCK = "clock-a"


def session_msg(revision=0):
    session = load_fixture("SessionState")
    session["revision"] = revision
    return {"type": "session", "session": session}


def transport_msg(clock=CLOCK, recording=False):
    return {"type": "transport", "transport": {"clockId": clock, "sampleRate": 48000, "currentFrame": 0,
                                               "loopStartFrame": 0, "playing": True, "recording": recording,
                                               "pendingCommandIds": []}}


def utter(uid, text, recording=False, clock=CLOCK, start=1000, end=2000):
    return {"type": "utterance", "id": uid, "text": text, "clockId": clock, "startFrame": start,
            "endFrame": end, "duringRecording": recording}


def ack(command_id, status, revision, reason=None):
    message = {"type": "ack", "commandId": command_id, "status": status, "revision": revision}
    if reason:
        message["reason"] = reason
    return message


def send(connection, message, now=0.0):
    validate("ClientMessage", message)
    out = connection.handle(message, now)
    for reply in out:
        validate("ServerMessage", reply)
    return out


@pytest.fixture
def conn():
    connection = Connection(ack_timeout_s=30)
    assert send(connection, session_msg()) == []
    assert send(connection, transport_msg()) == []
    return connection


def commands(out):
    return [m["command"] for m in out if m["type"] == "command"]


def errors(out):
    return [m for m in out if m["type"] == "error"]


def test_first_voice_slice_record_then_groove_stop(conn):
    out = send(conn, utter("u1", "record kick"))
    assert out == [{"type": "command", "command": {
        "id": "u1:cmd", "expectedRevision": 0, "boundary": "next-beat",
        "operation": {"type": "record", "target": {"trackId": "drums", "lane": "kick"}}}}]
    assert send(conn, ack("u1:cmd", "queued", 0)) == []
    assert send(conn, ack("u1:cmd", "applied", 1)) == []

    # Beatboxing transcribed as speech must not become a command or a span.
    assert send(conn, utter("u2", "boots cats boots", recording=True)) == []

    out = send(conn, utter("u3", "Groove, stop", recording=True, start=96000, end=120000))
    assert out[0] == {"type": "command-span", "utteranceId": "u3", "clockId": CLOCK,
                      "startFrame": 96000, "endFrame": 120000}
    assert out[1]["command"] == {"id": "u3:cmd", "expectedRevision": 1, "boundary": "immediate",
                                 "operation": {"type": "stop-recording"}}
    assert send(conn, ack("u3:cmd", "applied", 2)) == []
    assert conn.pending_command_ids == []


def test_no_span_outside_recording(conn):
    out = send(conn, utter("u1", "select snare"))
    assert [m["type"] for m in out] == ["command"]


def test_duplicate_utterance_is_not_issued_twice(conn):
    assert len(send(conn, utter("u1", "undo"))) == 1
    assert send(conn, utter("u1", "undo")) == []


def test_utterance_before_session_snapshot_is_refused():
    connection = Connection()
    out = send(connection, utter("u1", "record kick"))
    assert errors(out) and not commands(out)


def test_mismatched_clock_and_reversed_span_are_refused(conn):
    assert errors(send(conn, utter("u1", "groove stop", recording=True, clock="old-clock")))
    assert errors(send(conn, utter("u2", "groove stop", recording=True, start=10, end=5)))
    assert conn.pending_command_ids == []


def test_unrecognized_speech_reports_error_without_command(conn):
    out = send(conn, utter("u1", "make me a sandwich"))
    assert errors(out)[0]["requestId"] == "u1" and not commands(out)
    out = send(conn, utter("u2", "groove banana", recording=True))
    assert [m["type"] for m in out] == ["error"]  # unrecognized wake phrase: no span, no command


def test_next_loop_commands_are_serialized_against_fresh_revisions(conn):
    assert commands(send(conn, utter("u1", "tempo 140")))[0]["expectedRevision"] == 0
    assert send(conn, utter("u2", "tempo 90")) == []  # waits: issuing now would go stale
    assert send(conn, ack("u1:cmd", "queued", 0)) == []
    out = send(conn, ack("u1:cmd", "applied", 1))
    assert commands(out) == [{"id": "u2:cmd", "expectedRevision": 1, "boundary": "next-loop",
                              "operation": {"type": "tempo", "bpm": 90}}]


def test_immediate_commands_are_not_held_behind_a_queued_one(conn):
    send(conn, utter("u1", "record kick"))
    send(conn, ack("u1:cmd", "queued", 0))
    out = send(conn, utter("u2", "mute drums"))
    assert commands(out)[0]["boundary"] == "immediate"


def test_rejection_is_reported_and_unblocks_the_next_command(conn):
    send(conn, utter("u1", "tempo 140"))
    send(conn, utter("u2", "tempo 90"))
    out = send(conn, ack("u1:cmd", "rejected", 3, "stale revision"))
    assert errors(out)[0] == {"type": "error", "requestId": "u1", "message": "tempo was rejected: stale revision"}
    assert commands(out)[0]["id"] == "u2:cmd"
    assert commands(out)[0]["expectedRevision"] == 3  # rejection carried the browser's current revision


def test_session_snapshot_is_authoritative_for_revision(conn):
    send(conn, session_msg(revision=7))
    assert commands(send(conn, utter("u1", "undo")))[0]["expectedRevision"] == 7
    assert conn.session["revision"] == 7


def test_unacknowledged_command_expires_and_releases_backlog(conn):
    send(conn, utter("u1", "tempo 140"), now=0)
    send(conn, utter("u2", "tempo 90"), now=1)
    assert conn.tick(29.0) == []
    out = conn.tick(30.0)
    assert errors(out)[0]["requestId"] == "u1"
    assert commands(out)[0]["id"] == "u2:cmd"
    assert send(conn, ack("u1:cmd", "applied", 1), now=31) == []  # late ack is harmless


def test_backlog_is_bounded(conn):
    send(conn, utter("u0", "tempo 140"))
    for index in range(MAX_BACKLOG):
        assert send(conn, utter(f"b{index}", "faster")) == []
    assert errors(send(conn, utter("overflow", "faster")))


def test_new_connection_replays_nothing(conn):
    send(conn, utter("u1", "record kick"))
    send(conn, utter("u2", "tempo 90"))
    fresh = Connection()  # what the service creates after a reconnect
    assert send(fresh, session_msg(revision=4)) == []
    assert send(fresh, transport_msg(clock="clock-b")) == []
    assert fresh.pending_command_ids == []
    assert send(fresh, ack("u1:cmd", "applied", 5)) == []


def test_research_requests_fail_honestly_until_implemented(conn):
    out = send(conn, {"type": "sound-request", "id": "job1", "trackId": "synth-1", "description": "80s electric piano"})
    assert out[0]["status"] == "failed" and out[0]["candidates"] == []
    assert errors(send(conn, {"type": "cancel-job", "jobId": "job1"}))


# -- recording usability (PR #12, RECORDING-USABILITY.md WS3 checklist) -------------------


def usability_transport(**extra):
    message = transport_msg(recording=True)
    message["transport"].update(recordingState="recording", recordingStartFrame=88200,
                                recordingTarget={"trackId": "drums", "lane": "kick"}, recordingEpoch=3,
                                captureStartFrame=90000, recordingLoopStartFrame=88200.0, **extra)
    return message


def test_new_transport_fields_are_accepted_and_never_produce_speech_verification(conn):
    assert send(conn, usability_transport()) == []
    assert conn.transport["recordingEpoch"] == 3 and conn.transport["captureStartFrame"] == 90000
    out = send(conn, utter("u1", "Groove, stop", recording=True, start=96000, end=120000))
    assert [m["type"] for m in out] == ["command-span", "command"]  # never speech-verified from transport


def test_record_is_next_beat_and_not_held_behind_a_queued_tempo(conn):
    send(conn, utter("u1", "tempo 140"))
    send(conn, ack("u1:cmd", "queued", 0))
    out = commands(send(conn, utter("u2", "record snare")))
    assert out == [{"id": "u2:cmd", "expectedRevision": 0, "boundary": "next-beat",
                    "operation": {"type": "record", "target": {"trackId": "drums", "lane": "snare"}}}]


def test_next_loop_command_waits_for_an_armed_record_to_resolve(conn):
    send(conn, utter("u1", "record kick"))
    send(conn, ack("u1:cmd", "queued", 0))
    assert send(conn, utter("u2", "tempo 100")) == []  # record's application may change the revision
    out = send(conn, ack("u1:cmd", "applied", 1))
    assert commands(out)[0]["operation"] == {"type": "tempo", "bpm": 100}
    assert commands(out)[0]["expectedRevision"] == 1


def test_clear_and_undo_are_immediate_during_a_take_and_not_held_back(conn):
    send(conn, usability_transport())
    send(conn, utter("u1", "tempo 100"))
    send(conn, ack("u1:cmd", "queued", 0))
    clear = commands(send(conn, utter("u2", "Groove, clear", recording=True)))
    undo = commands(send(conn, utter("u3", "Groove, undo", recording=True)))
    assert [c["boundary"] for c in clear + undo] == ["immediate", "immediate"]
    assert undo[0]["operation"] == {"type": "undo"}  # backend Undo is a normal Undo, never discardCaptureOnly


def test_issue_3c_a_queued_edit_made_stale_by_an_immediate_edit_is_reported_not_rebased(conn):
    # RECORDING-USABILITY.md: queued musical edits recheck revision at application; no rebasing.
    send(conn, utter("u1", "tempo 100"))
    send(conn, ack("u1:cmd", "queued", 0))
    send(conn, utter("u2", "undo"))
    send(conn, ack("u2:cmd", "applied", 1))
    out = send(conn, ack("u1:cmd", "rejected", 1, "stale revision"))
    assert errors(out)[0]["message"] == "tempo was rejected: stale revision"
    assert commands(out) == []  # nothing re-issued automatically


def test_issue_3e_groove_stop_during_count_in_is_issued_immediately(conn):
    send(conn, utter("u1", "record kick"))
    send(conn, ack("u1:cmd", "queued", 0))
    armed = transport_msg(recording=False)
    armed["transport"].update(recordingState="armed", armedTarget={"trackId": "drums", "lane": "kick"})
    send(conn, armed)
    out = commands(send(conn, utter("u2", "stop recording")))
    assert out[0]["boundary"] == "immediate" and out[0]["operation"] == {"type": "stop-recording"}
