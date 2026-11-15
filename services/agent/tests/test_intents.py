import pytest

from groove_agent.contracts import load_fixture, validate
from groove_agent.intents import BOUNDARY, Command, Ignored, NotUnderstood, interpret, validate_operation
from groove_agent.spoken_numbers import find_number


@pytest.fixture
def session():
    return load_fixture("SessionState")  # selected: drums/kick, tempo 120, revision 0


def op(text, session, recording=False):
    result = interpret(text, session, recording)
    assert isinstance(result, Command), f"{text!r} -> {result!r}"
    command = {"id": "t", "expectedRevision": 0, "boundary": result.boundary, "operation": result.operation}
    validate("SessionCommand", command)
    assert validate_operation(result.operation) is None
    assert result.boundary == BOUNDARY[result.operation["type"]]
    return result.operation


@pytest.mark.parametrize("text,lane", [
    ("record kick", "kick"), ("Record the snare.", "snare"), ("record hats", "closed-hat"),
    ("record hi-hat", "closed-hat"), ("please record the high hats", "closed-hat"),
    ("start recording kick drum", "kick"),
])
def test_record_drum_lanes(session, text, lane):
    assert op(text, session) == {"type": "record", "target": {"trackId": "drums", "lane": lane}}


def test_record_defaults_to_selection_and_melodic_targets_have_no_lane(session):
    assert op("record", session)["target"] == {"trackId": "drums", "lane": "kick"}
    assert op("record synth two", session)["target"] == {"trackId": "synth-2"}
    assert op("record melody", session)["target"] == {"trackId": "synth-1"}
    session["selected"] = {"trackId": "synth-3"}
    assert op("record melody", session)["target"] == {"trackId": "synth-3"}


def test_record_drums_without_lane_is_refused(session):
    assert isinstance(interpret("record drums", session, False), NotUnderstood)


def test_stop_follows_plan_wake_phrase_rules(session):
    assert op("Groove, stop", session, recording=True) == {"type": "stop-recording"}
    assert op("Groove stop recording", session, recording=True) == {"type": "stop-recording"}
    assert op("Groove, stop playback", session, recording=True) == {"type": "play", "playing": False}
    assert op("grove stop.", session, recording=True) == {"type": "stop-recording"}
    assert op("stop", session) == {"type": "play", "playing": False}
    assert op("stop playback", session) == {"type": "play", "playing": False}
    assert isinstance(interpret("stop recording", session, False), NotUnderstood)


@pytest.mark.parametrize("text", ["stop", "record snare", "undo", "boots and cats", "la la la", ""])
def test_speech_without_wake_word_is_ignored_while_recording(session, text):
    assert isinstance(interpret(text, session, True), Ignored)


def test_wake_word_alone_or_with_noise_is_not_a_command(session):
    assert isinstance(interpret("Groove", session, True), NotUnderstood)
    assert isinstance(interpret("Groove banana", session, True), NotUnderstood)
    assert isinstance(interpret("what a nice day to stop by", session, False), NotUnderstood)


@pytest.mark.parametrize("text,bpm", [
    ("tempo 140", 140), ("set tempo to 96", 96), ("set the tempo to one forty", 140),
    ("tempo one hundred and twenty eight", 128), ("90 bpm", 90), ("faster", 130), ("slow down", 110),
    ("make it faster", 130), ("tempo 92.5", 92.5),
])
def test_tempo(session, text, bpm):
    assert op(text, session) == {"type": "tempo", "bpm": bpm}


def test_tempo_bounds_and_missing_value(session):
    for text in ("tempo 300", "tempo 12", "tempo", "tempo 120"):
        assert isinstance(interpret(text, session, False), NotUnderstood), text
    session["tempo"] = 236
    assert op("faster", session) == {"type": "tempo", "bpm": 240}


def test_clear_mute_select_undo_play(session):
    assert op("clear", session) == {"type": "clear", "target": {"trackId": "drums", "lane": "kick"}}
    assert op("clear the snare", session) == {"type": "clear", "target": {"trackId": "drums", "lane": "snare"}}
    assert op("clear drums", session) == {"type": "clear", "target": {"trackId": "drums"}}
    assert op("mute", session) == {"type": "mute", "trackId": "drums", "muted": True}
    assert op("unmute synth one", session) == {"type": "mute", "trackId": "synth-1", "muted": False}
    assert isinstance(interpret("mute kick", session, False), NotUnderstood)
    assert op("select snare", session) == {"type": "select", "target": {"trackId": "drums", "lane": "snare"}}
    assert op("switch to synth three", session) == {"type": "select", "target": {"trackId": "synth-3"}}
    assert isinstance(interpret("select", session, False), NotUnderstood)
    assert op("undo that", session) == {"type": "undo"}
    assert op("play", session) == {"type": "play", "playing": True}
    assert op("start playback please", session) == {"type": "play", "playing": True}


def test_boundaries_match_contract_guide(session):
    assert interpret("record kick", session, False).boundary == "next-beat"  # RECORDING-USABILITY.md
    assert interpret("tempo 100", session, False).boundary == "next-loop"
    assert interpret("clear", session, False).boundary == "immediate"
    assert interpret("undo", session, False).boundary == "immediate"
    assert interpret("groove stop", session, True).boundary == "immediate"
    assert interpret("mute", session, False).boundary == "immediate"
    assert interpret("select snare", session, False).boundary == "immediate"
    assert interpret("stop", session, False).boundary == "immediate"


def test_semantic_validation_catches_what_the_schema_allows():
    assert validate_operation({"type": "record", "target": {"trackId": "drums"}})
    assert validate_operation({"type": "select", "target": {"trackId": "synth-1", "lane": "kick"}})
    assert validate_operation({"type": "format-disk"})
    assert validate_operation({"type": "clear", "target": {"trackId": "drums"}}) is None


@pytest.mark.parametrize("words,value", [
    ("one twenty", 120), ("one oh five", 105), ("ninety", 90), ("two hundred", 200),
    ("one hundred ten", 110), ("eighty eight", 88), ("to 100 please", 100), ("no numbers here", None),
])
def test_spoken_numbers(words, value):
    assert find_number(words.split()) == value


def test_stop_recording_cancels_an_armed_take_only_when_one_is_armed():
    session = load_fixture("SessionState")
    assert isinstance(interpret("stop recording", session, False), NotUnderstood)
    assert interpret("stop recording", session, False, take_armed=True).operation == {"type": "stop-recording"}
    assert interpret("stop", session, False, take_armed=True).operation == {"type": "stop-recording"}
    assert interpret("stop playback", session, False, take_armed=True).operation == {"type": "play", "playing": False}


def test_a_spoken_tempo_number_wins_over_faster_or_slower():
    from groove_agent.contracts import load_fixture
    from groove_agent.intents import Command, interpret
    session = load_fixture("SessionState")  # 120 BPM
    assert interpret("make the beat a little faster, like 128", session, False) == Command({"type": "tempo", "bpm": 128}, "next-loop")
    assert interpret("slower, about ninety", session, False) == Command({"type": "tempo", "bpm": 90}, "next-loop")
    assert interpret("faster", session, False) == Command({"type": "tempo", "bpm": 130}, "next-loop")
    assert interpret("slower", session, False) == Command({"type": "tempo", "bpm": 110}, "next-loop")
