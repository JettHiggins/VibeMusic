"""Playtest repair: deterministic voice metronome and bar/beat/subdivision erasure.

Against WS1's published contract (docs/PLAYTEST-REPAIR-CONTRACT.md): both operations are
immediate; step = (bar-1)*16 + (beat-1)*4 + (subdivision-1) with one-based 1..4 values and
subdivision defaulting to 1; erase targets the active take before the ordinary selection; drum
erasure needs a lane; ambiguous text never mutates and never reaches the language model.
"""
import pytest

from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture, validate
from groove_agent.intents import BOUNDARY, Command, NotUnderstood, interpret, validate_operation
from groove_agent.language import decode_decision


def session(selected="synth-1"):
    state = load_fixture("SessionState")
    state["selected"] = {"trackId": selected}
    return state


def op(text, recording=False, recording_target=None, selected="synth-1"):
    result = interpret(text, session(selected), recording, recording_target=recording_target)
    return result.operation if isinstance(result, Command) else result


@pytest.mark.parametrize("text, step", [
    ("erase bar 1 beat 1", 0), ("erase bar 1 beat 2", 4), ("erase bar 2 beat 1", 16), ("erase bar 2 beat 3", 24),
    ("erase bar 4 beat 4", 60), ("erase bar 4 beat 4 subdivision 4", 63), ("erase bar 1 beat 1 sixteenth 2", 1),
    ("delete bar three beat two subdivision three", 38), ("remove bar two beat four", 28),
    ("erase the third beat of the second bar", 24), ("erase the first beat of the fourth bar", 48),
    ("erase beat 2 bar 3", 36), ("clear bar four beat four sixteenth four", 63), ("erase bar to beat for", 28),
])
def test_one_based_positions_map_to_the_contract_step(text, step):
    result = op(text)
    assert result == {"type": "erase-event", "target": {"trackId": "synth-1"}, "step": step}
    assert BOUNDARY["erase-event"] == "immediate" and validate_operation(result) is None


def test_target_precedence_is_explicit_then_active_take_then_selection():
    assert op("erase bar 2 beat 3 on synth three", recording_target={"trackId": "synth-2"})["target"] == {"trackId": "synth-3"}
    assert op("erase bar 2 beat 3", recording_target={"trackId": "synth-2"}, selected="synth-1")["target"] == {"trackId": "synth-2"}
    assert op("erase bar 2 beat 3", selected="synth-3")["target"] == {"trackId": "synth-3"}
    assert op("delete the snare on bar 1 beat 2")["target"] == {"trackId": "drums", "lane": "snare"}
    assert op("erase bar 1 beat 1", recording_target={"trackId": "drums", "lane": "kick"}) == {
        "type": "erase-event", "target": {"trackId": "drums", "lane": "kick"}, "step": 0}


@pytest.mark.parametrize("text", [
    "erase bar 2", "erase beat 3", "erase bar 5 beat 1", "erase bar 2 beat 0", "erase bar 2 beat 3 beat 4",
    "erase bar 2 beat 3 subdivision 5", "erase drums bar 1 beat 1", "erase bar 2 beat 3 on sent", "clear bar two",
    "erase bar beat",
])
def test_ambiguous_erase_never_mutates(text):
    result = op(text)
    assert isinstance(result, NotUnderstood) and result.reason != "command not recognized", text


@pytest.mark.parametrize("text, enabled", [
    ("metronome off", False), ("metronome on", True), ("turn the click off", False), ("turn the click on", True),
    ("mute the metronome", False), ("unmute the metronome", True), ("stop the metronome", False),
    ("disable the click", False), ("enable metronome", True),
])
def test_metronome_phrases_are_deterministic_and_immediate(text, enabled):
    assert op(text) == {"type": "metronome", "enabled": enabled}
    assert BOUNDARY["metronome"] == "immediate"


def test_metronome_without_on_or_off_is_refused_and_other_commands_are_unchanged():
    assert isinstance(op("metronome"), NotUnderstood) and isinstance(op("metronome on off"), NotUnderstood)
    assert op("mute drums") == {"type": "mute", "trackId": "drums", "muted": True}
    assert op("stop") == {"type": "play", "playing": False}
    assert op("clear") == {"type": "clear", "target": {"trackId": "synth-1"}}


def test_validation_rejects_malformed_erasure_from_any_interpreter():
    assert validate_operation({"type": "erase-event", "target": {"trackId": "drums"}, "step": 3}) == "drum erasure requires a lane"
    assert validate_operation({"type": "erase-event", "target": {"trackId": "synth-1", "lane": "kick"}, "step": 3})
    assert validate_operation({"type": "erase-event", "target": {"trackId": "synth-1"}, "step": 64})
    # A model-proposed erase passes the same validation and the server's boundary.
    command = decode_decision({"kind": "command", "operation": {"type": "erase-event", "target": {"trackId": "synth-2"},
                                                                 "step": 24}})
    assert isinstance(command, Command) and command.boundary == "immediate"


class NoLanguage:
    def __init__(self):
        self.jobs = []

    def submit(self, job):
        self.jobs.append(job)
        return True


def connection(recording=True, target=None):
    from test_speech_harness import connect
    conn = connect(None, recording=recording)
    conn._language = NoLanguage()
    if target is not None:
        transport = dict(conn.transport, recordingTarget=target)
        conn.handle({"type": "transport", "transport": transport}, 0.0)
    return conn


def say(conn, text, recording=True, uid="u1"):
    message = {"type": "utterance", "id": uid, "text": text, "clockId": "ctx", "startFrame": 352900,
               "endFrame": 353900, "duringRecording": recording}
    validate("ClientMessage", message)
    out = conn.handle(message, 0.0)
    for reply in out:
        validate("ServerMessage", reply)
    return out


def test_spoken_erase_during_a_take_excludes_its_span_then_erases_on_the_takes_track():
    conn = connection(target={"trackId": "synth-2"})
    out = say(conn, "Groove, erase bar 2 beat 3")
    assert [m["type"] for m in out] == ["command-span", "command"]
    command = out[1]["command"]
    assert command["boundary"] == "immediate"
    assert command["operation"] == {"type": "erase-event", "target": {"trackId": "synth-2"}, "step": 24}
    assert conn._language.jobs == []  # no model latency


def test_ambiguous_spoken_erase_is_excluded_and_reported_without_the_model():
    conn = connection(target={"trackId": "synth-2"})
    out = say(conn, "Groove, erase bar two")
    assert [m["type"] for m in out] == ["command-span", "error"] and conn._language.jobs == []


def test_spoken_metronome_never_waits_for_the_model():
    conn = connection(recording=False)
    out = say(conn, "metronome off", recording=False)
    assert [m["type"] for m in out] == ["command"] and out[0]["command"]["operation"] == {"type": "metronome",
                                                                                        "enabled": False}
    assert out[0]["command"]["boundary"] == "immediate" and conn._language.jobs == []


def test_a_capture_erasure_fence_invalidates_older_language_context():
    conn = connection(target={"trackId": "synth-1"})
    before = conn._language_epoch
    fence = {"commandId": "erase-1", "recordingEpoch": 0, "throughFrame": 353000, "target": {"trackId": "synth-1"},
             "step": 24}
    message = {"type": "transport", "transport": dict(conn.transport, captureErasure=fence)}
    validate("ClientMessage", message)
    conn.handle(message, 0.0)
    assert conn._language_epoch == before + 1
    conn.handle(message, 0.0)  # the same retained fence again: no further invalidation
    assert conn._language_epoch == before + 1



# -- WS1 review of #37: conflicting/invalid targets and leftover positions never erase -------

UNSAFE_ERASES = [
    "erase synth four bar one beat two",            # WS1 repro: erased synth-1 step 4
    "erase kick and snare bar one beat two",        # WS1 repro: picked kick
    "erase kick bar one beat two and three",        # WS1 repro: picked beat two
    "erase synth two and synth three bar one beat two",  # WS1 repro: picked synth-2
    "erase synth 9 bar 1 beat 1", "erase bar 1 beat 2 3", "erase bar 1 beat 2 subdivision 3 4",
    "erase kick bar 1 beat 2 on the snare", "erase bar one beat two on synth one and synth two",
]


@pytest.mark.parametrize("text", UNSAFE_ERASES)
def test_unsafe_erase_specifications_never_mutate_for_any_context(text):
    for selected in ("synth-1", "synth-2", "synth-3", "drums"):
        for take in (None, {"trackId": "synth-2"}, {"trackId": "drums", "lane": "kick"}):
            result = op(text, recording_target=take, selected=selected)
            assert isinstance(result, NotUnderstood), (text, selected, take, result)
            assert result.reason != "command not recognized"  # no language-model fallback either


@pytest.mark.parametrize("text", UNSAFE_ERASES[:4])
def test_unsafe_spoken_erase_through_the_connection_issues_no_command(text):
    conn = connection(target={"trackId": "synth-1"})
    out = say(conn, f"Groove, {text}")
    assert [m["type"] for m in out] == ["command-span", "error"], out
    assert conn._language.jobs == [] and conn.pending_command_ids == []


def test_single_clear_targets_still_erase():
    assert op("erase the kick bar one beat two")["target"] == {"trackId": "drums", "lane": "kick"}
    assert op("erase bar one beat two on synth three")["target"] == {"trackId": "synth-3"}
    assert op("erase the snare on the drums bar 2 beat 1")["target"] == {"trackId": "drums", "lane": "snare"}



MIXED_ERASES = ["erase snare and synth two bar one beat two",  # WS1 re-review repro: erased snare
                "erase kick and synth three bar 2 beat 1", "erase synth one and the hats bar 1 beat 1",
                "erase kick and synth bar 1 beat 2", "erase the snare and melody bar 3 beat 3"]


@pytest.mark.parametrize("text", MIXED_ERASES)
def test_mixed_drum_and_synth_erases_never_mutate(text):
    for selected in ("synth-1", "synth-2", "synth-3", "drums"):
        for take in (None, {"trackId": "synth-2"}, {"trackId": "drums", "lane": "kick"}):
            result = op(text, recording_target=take, selected=selected)
            assert isinstance(result, NotUnderstood) and "one track" in result.reason, (text, selected, take, result)


def test_mixed_spoken_erase_through_the_connection_issues_no_command():
    conn = connection(target={"trackId": "synth-1"})
    out = say(conn, "Groove, erase snare and synth two bar one beat two")
    assert [m["type"] for m in out] == ["command-span", "error"]
    assert conn._language.jobs == [] and conn.pending_command_ids == []
