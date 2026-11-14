"""Playtest repair: recording targets across successive synth takes, including noisy-room
recognizer spellings. A target that cannot be resolved is refused, never guessed from the
current selection (which after a take is usually the previous take's track)."""
import pytest

from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture, validate
from groove_agent.intents import NotUnderstood, interpret


def session(selected="synth-1", revision=0):
    state = load_fixture("SessionState")
    state["selected"], state["revision"] = {"trackId": selected}, revision
    return state


@pytest.mark.parametrize("phrase, track", [
    ("record synth two", "synth-2"), ("record synth to", "synth-2"), ("record sent two", "synth-2"),
    ("record send two", "synth-2"), ("record cent two", "synth-2"), ("record syn two", "synth-2"),
    ("record synths two", "synth-2"), ("record the second synth", "synth-2"), ("record since three", "synth-3"),
    ("record sin three", "synth-3"), ("record synth tree", "synth-3"), ("record the third synth", "synth-3"),
    ("record synth one", "synth-1"), ("record synth won", "synth-1"),
])
def test_noisy_room_spellings_reach_the_named_synth(phrase, track):
    for selected in ("synth-1", "synth-2", "synth-3"):
        assert interpret(phrase, session(selected), False).operation == {"type": "record", "target": {"trackId": track}}


@pytest.mark.parametrize("phrase", ["record two", "record sent", "record since", "clear two", "clear bar two",
                                    "clear beat three", "mute sent", "groove record 2"])
def test_track_words_that_name_no_track_are_refused_not_guessed(phrase):
    result = interpret(phrase, session("synth-1"), phrase.startswith("groove"))
    assert isinstance(result, NotUnderstood) and "which track" in result.reason


def test_without_any_track_words_the_selection_is_still_used():
    assert interpret("record", session("synth-3"), False).operation == {"type": "record", "target": {"trackId": "synth-3"}}
    assert interpret("clear", session("synth-2"), False).operation == {"type": "clear", "target": {"trackId": "synth-2"}}
    assert interpret("record kick", session("synth-2"), False).operation["target"] == {"trackId": "drums", "lane": "kick"}


def test_successive_takes_on_synths_one_two_three_each_target_the_named_track():
    connection = Connection()
    utter = lambda uid, text, recording: {"type": "utterance", "id": uid, "text": text, "clockId": "c", "startFrame": 0,
                                          "endFrame": 9, "duringRecording": recording}
    revision, selected = 0, "synth-1"
    for take, (phrase, track) in enumerate((("record synth one", "synth-1"), ("record sent two", "synth-2"),
                                            ("record since three", "synth-3")), 1):
        connection.handle({"type": "session", "session": session(selected, revision)}, 0.0)
        out = connection.handle(utter(f"r{take}", phrase, False), 0.0)
        command = out[0]["command"]
        validate("ServerMessage", out[0])
        assert command["operation"] == {"type": "record", "target": {"trackId": track}}, phrase
        assert command["boundary"] == "next-beat" and command["expectedRevision"] == revision
        connection.handle({"type": "ack", "commandId": command["id"], "status": "applied", "revision": revision + 1}, 0.0)
        stop = connection.handle(utter(f"s{take}", "Groove, stop", True), 0.0)
        assert [m["type"] for m in stop] == ["command-span", "command"]
        assert stop[1]["command"]["operation"] == {"type": "stop-recording"}
        connection.handle({"type": "ack", "commandId": stop[1]["command"]["id"], "status": "applied",
                           "revision": revision + 1}, 0.0)
        revision, selected = revision + 1, track  # the engine selects the take's target
    # A misheard next request after synth three must not silently re-record synth three.
    connection.handle({"type": "session", "session": session("synth-3", revision)}, 0.0)
    refused = connection.handle(utter("r4", "record sent", False), 0.0)
    assert [m["type"] for m in refused] == ["error"] and "which track" in refused[0]["message"]



# -- WS1 review of #34: invalid or conflicting specifications never fall back -------------

SELECTIONS = ("synth-1", "synth-2", "synth-3", "drums")


@pytest.mark.parametrize("phrase, reason", [
    ("record synth four", "only synths"), ("record synth 4", "only synths"), ("record synth nine", "only synths"),
    ("clear synth 4", "only synths"), ("clear synth four", "only synths"), ("mute synth 9", "only synths"),
    ("mute synth zero", "only synths"), ("select synth five", "only synths"),
    ("record synth two and synth three", "one track"), ("clear kick and snare", "one track"),
    ("mute synth one and synth two", "one track"), ("select kick and hats", "one track"),
    ("record synth two three", "which track"), ("clear synth one 2", "which track"),
])
def test_invalid_or_conflicting_targets_refuse_for_every_selection(phrase, reason):
    for selected in SELECTIONS:
        result = interpret(phrase, session(selected), False)
        assert isinstance(result, NotUnderstood) and reason in result.reason, (phrase, selected, result)


def test_deliberate_fallbacks_are_kept():
    assert interpret("record", session("synth-3"), False).operation["target"] == {"trackId": "synth-3"}
    assert interpret("clear", session("synth-2"), False).operation["target"] == {"trackId": "synth-2"}
    assert interpret("record synth", session("synth-3"), False).operation["target"] == {"trackId": "synth-3"}
    assert interpret("record melody", session("drums"), False).operation["target"] == {"trackId": "synth-1"}
    assert interpret("switch to synth two", session("synth-1"), False).operation["target"] == {"trackId": "synth-2"}
    assert interpret("clear the snare on the drums", session("synth-1"), False).operation["target"] == {
        "trackId": "drums", "lane": "snare"}
    assert interpret("record kick drum", session("synth-1"), False).operation["target"] == {"trackId": "drums",
                                                                                          "lane": "kick"}


def test_conflicting_spoken_record_issues_no_command_through_the_connection():
    connection = Connection()
    connection.handle({"type": "session", "session": session("synth-1")}, 0.0)
    for uid, phrase in (("a", "record synth four"), ("b", "record synth two and synth three"),
                        ("c", "clear synth 4"), ("d", "mute synth 9")):
        out = connection.handle({"type": "utterance", "id": uid, "text": phrase, "clockId": "c", "startFrame": 0,
                                 "endFrame": 9, "duringRecording": False}, 0.0)
        assert [m["type"] for m in out] == ["error"], phrase
    assert connection.pending_command_ids == []
