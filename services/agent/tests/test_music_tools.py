"""Groove music tools (2026-11-15 plan): whole-song edits as ordinary validated, undoable commands."""
import pytest

from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture, validate
from groove_agent.intents import MusicTool, interpret
from groove_agent.language import decode_decision
from groove_agent.music_tools import (ToolRefusal, change_key, drum_fill, estimate_key, run_tool, tidy_timing,
                                      transpose)
from test_research import FakePort, candidates


def song():
    session = load_fixture("SessionState")
    session["selected"] = {"trackId": "synth-1"}
    session["tracks"][0]["notes"] = [  # slightly off-grid melody in C major
        {"id": "n1", "step": 1, "duration": 3, "midi": 60, "velocity": 0.8},
        {"id": "n2", "step": 5, "duration": 2, "midi": 64, "velocity": 0.8},
        {"id": "n3", "step": 7, "duration": 5, "midi": 67, "velocity": 0.8, "chord": [71, 74]},
    ]
    session["tracks"][3]["hits"] = [{"id": "k1", "step": 1, "lane": "kick", "velocity": 0.9},
                                    {"id": "k2", "step": 15, "lane": "kick", "velocity": 0.9},
                                    {"id": "h1", "step": 3, "lane": "closed-hat", "velocity": 0.5}]
    return session


def notes(operation):
    return [(n["id"], n["step"], n["duration"], n["midi"]) for n in operation["notes"]]


def test_tidy_timing_snaps_to_the_grid_and_removes_overlaps():
    [op] = tidy_timing(song(), ["synth-1"], "eighth")
    # halves round up (1 -> 2), lengths to whole eighths, then trimmed so nothing runs into the next note
    assert notes(op) == [("n1", 2, 4, 60), ("n2", 6, 2, 64), ("n3", 8, 6, 67)]
    [quarter] = tidy_timing(song(), ["synth-1"], "quarter")
    assert notes(quarter) == [("n1", 0, 4, 60), ("n2", 4, 4, 64), ("n3", 8, 4, 67)]
    whole = tidy_timing(song())
    assert [o["trackId"] for o in whole] == ["synth-1", "drums"]
    assert sorted((h["lane"], h["step"]) for h in whole[1]["hits"]) == [("closed-hat", 4), ("kick", 2), ("kick", 16)]
    for operation in whole:
        validate("SessionCommand", {"id": "x", "expectedRevision": 0, "boundary": "next-loop", "operation": operation})


def test_notes_landing_on_the_same_grid_line_keep_the_earlier_one():
    session = song()
    session["tracks"][0]["notes"] = [{"id": "a", "step": 4, "duration": 2, "midi": 60, "velocity": 0.8},
                                     {"id": "b", "step": 5, "duration": 2, "midi": 62, "velocity": 0.8}]
    [op] = tidy_timing(session, ["synth-1"], "quarter")
    assert notes(op) == [("a", 4, 4, 60)]


def test_tidy_refuses_when_nothing_changes():
    clean = load_fixture("SessionState")
    with pytest.raises(ToolRefusal):
        tidy_timing(clean)


def test_drum_fill_writes_one_lane_and_keeps_the_others():
    [op] = drum_fill(song(), "closed-hat", every=2)
    hats = sorted(h["step"] for h in op["hits"] if h["lane"] == "closed-hat")
    assert hats == list(range(0, 64, 2))
    assert sorted(h["id"] for h in op["hits"] if h["lane"] == "kick") == ["k1", "k2"]
    [off] = drum_fill(song(), "closed-hat", every=4, offset=2)
    assert sorted(h["step"] for h in off["hits"] if h["lane"] == "closed-hat")[:3] == [2, 6, 10]
    with pytest.raises(ToolRefusal):
        drum_fill(song(), "cowbell", every=2)


def test_transpose_moves_melody_and_chords_only():
    [op] = transpose(song(), 12)
    assert [n["midi"] for n in op["notes"]] == [72, 76, 79] and op["notes"][2]["chord"] == [83, 86]
    with pytest.raises(ToolRefusal):
        transpose(load_fixture("SessionState"), 2)


def test_change_key_moves_notes_by_scale_degree_and_sets_snapping():
    session = song()
    session["pitchSnap"] = {"root": 0, "scale": "major"}
    ops = change_key(session, 9, "minor")  # C major -> A minor: C E G -> A C E
    assert ops[0] == {"type": "set-pitch-snap", "settings": {"root": 9, "scale": "minor"}}
    assert [n["midi"] for n in ops[1]["notes"]] == [57, 60, 64]
    assert ops[1]["notes"][2]["chord"] == [67, 71]  # B D -> G B (same degrees, nearest octave)
    ops = change_key(session, 2, "minor")  # C major -> D minor
    assert [n["midi"] for n in ops[1]["notes"]] == [62, 65, 69]
    assert estimate_key(song()) == (0, "major")
    only_key = change_key(session, 2, "minor", move_notes=False)
    assert only_key == [{"type": "set-pitch-snap", "settings": {"root": 2, "scale": "minor"}}]


@pytest.mark.parametrize("text, name, args", [
    ("Groove, fix up the timing of my notes", "tidy_timing", {"scope": "selected", "grid": None}),
    ("Groove, clean up the whole beat", "tidy_timing", {"scope": "all", "grid": None}),
    ("Groove, fill in every other hi-hat", "drum_pattern", {"lane": "closed-hat", "every": 2, "offset": 0}),
    ("Groove, hats on the off beat", "drum_pattern", {"lane": "closed-hat", "every": 4, "offset": 2}),
    ("Groove, transpose up two semitones", "transpose", {"semitones": 2, "scope": "all"}),
    ("Groove, put the song in D minor", "change_key", {"root": 2, "scale": "minor", "move_notes": True}),
])
def test_spoken_requests_reach_the_music_tools_without_a_model(text, name, args):
    assert interpret(text, song(), False) == MusicTool(name, args)


def test_key_phrase_without_a_move_verb_still_only_sets_snapping():
    assert interpret("key D minor", song(), False).operation == {"type": "set-pitch-snap", "settings": {"root": 2, "scale": "minor"}}


@pytest.mark.parametrize("decision, expected", [
    ({"kind": "tool", "name": "drum_pattern", "args": {"lane": "closed-hat", "every": 2, "offset": 0}},
     MusicTool("drum_pattern", {"lane": "closed-hat", "every": 2, "offset": 0})),
    ({"kind": "input", "action": "calibrate"}, "calibrate-input"),
])
def test_model_tool_decisions_decode(decision, expected):
    result = decode_decision(decision)
    assert result == expected if isinstance(expected, MusicTool) else result.operation["type"] == expected


def connection(session=None):
    conn = Connection(research=FakePort(), voice_research=True)
    conn.handle({"type": "session", "session": session or song()}, 0)
    return conn


def say(conn, text, uid):
    return conn.handle({"type": "utterance", "id": uid, "text": text, "clockId": "c", "startFrame": 0, "endFrame": 1,
                        "duringRecording": False}, 0)


def test_whole_beat_cleanup_issues_one_pattern_edit_per_track_in_order():
    conn = connection()
    out = say(conn, "Groove, clean up the whole beat", "u1")
    assert [m["command"]["operation"]["trackId"] for m in out] == ["synth-1"]  # next-loop edits go one at a time
    for message in out:
        validate("ServerMessage", message)
    follow = conn.handle({"type": "ack", "commandId": out[0]["command"]["id"], "status": "applied", "revision": 1}, 1)
    assert [m["command"]["operation"]["trackId"] for m in follow] == ["drums"]


def test_key_change_sets_snapping_immediately_then_moves_notes():
    conn = connection()
    out = say(conn, "Groove, put the song in A minor", "u1")
    assert [m["command"]["operation"]["type"] for m in out] == ["set-pitch-snap", "edit-pattern"]
    assert [m["command"]["boundary"] for m in out] == ["immediate", "next-loop"]


def test_tool_refusals_are_reported_and_change_nothing():
    conn = connection(load_fixture("SessionState"))
    [error] = say(conn, "Groove, fix up the timing of my notes", "u1")
    assert error["type"] == "error" and "nothing to tidy" in error["message"] and conn.pending_command_ids == []


def test_spoken_sound_search_loads_the_best_match_and_respects_a_later_choice():
    conn = connection()
    context = say(conn, "Groove, can I get a bright disco synth", "u1")[0]
    job = context["jobId"]
    listing = candidates(job)
    first = conn.observe_research({"type": "research", "jobId": job, "status": "running", "progress": 0.2,
                                   "candidates": listing[:3]})
    assert first == []  # retrieval not complete yet
    loaded = conn.observe_research({"type": "research", "jobId": job, "status": "running", "progress": 0.2,
                                    "candidates": (listing * 4)[:10]})
    [command] = [m for m in loaded if m["type"] == "command"]
    assert command["command"]["operation"] == {"type": "apply-patch", "trackId": "synth-1", "patch": listing[0]["patch"]}
    conn.handle({"type": "ack", "commandId": command["command"]["id"], "status": "applied", "revision": 1}, 1)
    # The user picks another sound by hand; the final result must not overwrite it.
    session = song()
    session["revision"] = 2
    session["tracks"][0]["patch"] = listing[1]["patch"]
    conn.handle({"type": "session", "session": session}, 2)
    final = conn.observe_research({"type": "research", "jobId": job, "status": "complete", "progress": 1,
                                   "candidates": [listing[2]] + listing[:2]})
    assert not [m for m in final if m["type"] == "command"]


def test_typed_ui_searches_never_auto_load():
    conn = connection()
    conn.handle({"type": "sound-request", "id": "ui-1", "trackId": "synth-1", "description": "pad"}, 0)
    out = conn.observe_research({"type": "research", "jobId": "ui-1", "status": "complete", "progress": 1,
                                 "candidates": candidates("ui-1")})
    assert not [m for m in out if m["type"] == "command"]


def test_run_tool_labels():
    operations, label = run_tool("drum_pattern", {"lane": "kick", "every": 4}, song())
    assert label == "kick every 4 sixteenths" and operations[0]["type"] == "edit-pattern"


def test_auto_load_happens_once_after_retrieval_and_once_at_completion_with_distinct_ids():
    conn = connection()
    job = say(conn, "Groove, can I get a bright disco synth", "u1")[0]["jobId"]
    listing = candidates(job)
    ten = (listing * 4)[:10]
    issued = []
    for status, items in [("running", ten), ("running", list(reversed(ten))), ("running", ten), ("complete", [listing[2]] + ten[:9])]:
        out = conn.observe_research({"type": "research", "jobId": job, "status": status, "progress": 0.5, "candidates": items})
        for message in out:
            if message["type"] == "command":
                issued.append(message["command"])
                patched = song()
                patched["revision"] = len(issued)
                patched["tracks"][0]["patch"] = message["command"]["operation"]["patch"]
                conn.handle({"type": "ack", "commandId": message["command"]["id"], "status": "applied", "revision": len(issued)}, 1)
                conn.handle({"type": "session", "session": patched}, 1)
    assert [c["id"].rsplit(":", 2)[-2] for c in issued] == ["load-retrieval", "load-final"]
    assert issued[1]["operation"]["patch"] == listing[2]["patch"]


class Pending:
    def __init__(self):
        self.jobs = []
    def unavailable(self):
        return None
    def submit(self, job):
        self.jobs.append(job)
        return True


def agent_connection(session=None):
    conn = connection(session)
    conn._language = Pending()
    return conn


def test_structured_requests_go_to_the_agent_with_the_quick_parse_as_fallback():
    from groove_agent.intents import Command
    conn = agent_connection()
    assert say(conn, "Groove, delete every third snare", "u1") == []  # not 'clear the snares'
    assert conn._language.jobs[0].text == "Groove, delete every third snare"
    assert say(conn, "Groove, fill in every other hi-hat", "u2") == []
    assert say(conn, "Groove, can I get a bright disco synth", "u3") == []  # the model rewords the sound
    assert len(conn._language.jobs) == 3
    # Model failure: the quick parse still acts (here the drum pattern).
    out = conn.language_result(conn._language.jobs[1], None, "language request timed out; no change applied", 1)
    assert out[0]["command"]["operation"]["type"] == "edit-pattern"
    # Exact simple commands never wait for the model.
    assert say(conn, "Groove, clear the snares", "u5")[0]["command"]["operation"] == {
        "type": "clear", "target": {"trackId": "drums", "lane": "snare"}}  # plural lane, not the selected track


def test_a_refused_or_failed_structured_request_without_fallback_reports_the_reason():
    conn = agent_connection()
    say(conn, "Groove, make the bass line bouncier", "u1")  # unknown: no quick parse
    [error] = conn.language_result(conn._language.jobs[0], None, "language request timed out; no change applied", 1)
    assert error["type"] == "error" and "timed out" in error["message"]


def test_a_multi_action_plan_builds_one_merged_edit_per_track():
    from groove_agent.intents import Plan
    conn = agent_connection()
    say(conn, "Groove, make a disco beat", "u1")
    plan = Plan((MusicTool("drum_steps", {"lane": "kick", "steps": [0, 4, 8, 12], "mode": "replace"}),
                 MusicTool("drum_pattern", {"lane": "closed-hat", "every": 4, "offset": 2}),
                 MusicTool("drum_steps", {"lane": "snare", "steps": [4, 12], "mode": "add"})))
    out = conn.language_result(conn._language.jobs[0], plan, None, 1)
    [command] = [m for m in out if m["type"] == "command"]
    hits = command["command"]["operation"]["hits"]
    lane = lambda name: sorted(h["step"] for h in hits if h["lane"] == name)
    assert lane("kick") == [0, 4, 8, 12] and lane("closed-hat")[:3] == [2, 6, 10] and lane("snare") == [4, 12]


def test_counted_drum_edits_use_exact_steps():
    session = song()
    session["tracks"][3]["hits"] = [{"id": f"s{i}", "step": step, "lane": "snare", "velocity": 0.8}
                                    for i, step in enumerate([4, 12, 20, 28, 36, 44, 52, 60])]
    operations, _ = run_tool("drum_steps", {"lane": "snare", "steps": [20, 44], "mode": "remove"}, session)
    assert sorted(h["step"] for h in operations[0]["hits"] if h["lane"] == "snare") == [4, 12, 28, 36, 52, 60]


@pytest.mark.parametrize("text, args", [
    ("Groove, turn the drums down", {"track": "drums", "change": -15}),
    ("Groove, make synth three louder", {"track": "synth-3", "change": 15}),
    ("Groove, drums to 80 percent", {"track": "drums", "level": 80}),
    ("Groove, turn it up", {"track": None, "change": 15}),
])
def test_volume_phrases(text, args):
    assert interpret(text, song(), False) == MusicTool("set_volume", args)


def test_volume_changes_are_immediate_and_instant_even_with_a_model_mid_take():
    conn = agent_connection()
    [command] = say(conn, "Groove, turn the drums down", "u1")
    assert command["command"]["operation"] == {"type": "volume", "trackId": "drums", "volume": 0.55}
    assert command["command"]["boundary"] == "immediate" and conn._language.jobs == []


def test_adjust_sound_shapes_the_current_patch_within_engine_ranges():
    from groove_agent.music_tools import adjust_sound
    [op] = adjust_sound(song(), "synth-1", {"brightness": 25, "reverb": 40, "attack": -100})
    params = op["patch"]["parameters"]
    assert op["type"] == "apply-patch" and params["1"] == 0 and 0 < params["36"] <= 127 and params["5"] > 0
    validate("SessionCommand", {"id": "x", "expectedRevision": 0, "boundary": "immediate", "operation": op})
    with pytest.raises(ToolRefusal):
        adjust_sound(song(), "drums", {"reverb": 10})
    with pytest.raises(ToolRefusal):
        adjust_sound(song(), "synth-1", {"wobble": 10})


@pytest.mark.parametrize("text, tracks", [
    ("Groove, clear everything", ["synth-1", "synth-2", "synth-3", "drums"]),
    ("Groove, clear the whole beat", ["synth-1", "synth-2", "synth-3", "drums"]),
    ("Groove, clear the whole drum kit", ["drums"]),
    ("Groove, clear synth one and two", ["synth-1", "synth-2"]),
    ("Groove, clear all synths", ["synth-1", "synth-2", "synth-3"]),
])
def test_clearing_several_tracks_at_once(text, tracks):
    conn = connection()
    out = say(conn, text, "u1")
    assert [m["command"]["operation"]["target"] for m in out] == [{"trackId": t} for t in tracks]


def test_specific_lanes_and_positions_are_unchanged():
    session = song()
    assert interpret("Groove, clear all the snares", session, False).operation["target"] == {"trackId": "drums", "lane": "snare"}
    assert interpret("Groove, erase bar 2 beat 3", session, False).operation["type"] == "erase-event"


def test_switching_instrument_during_a_take_stops_the_take_then_switches():
    conn = connection()
    conn.handle({"type": "transport", "transport": {"clockId": "c", "sampleRate": 44100, "currentFrame": 1000, "loopStartFrame": 0,
                 "playing": True, "recording": True, "pendingCommandIds": [], "recordingState": "recording",
                 "recordingStartFrame": 500, "recordingTarget": {"trackId": "synth-1"}}}, 0)
    out = conn.handle({"type": "utterance", "id": "u1", "text": "Groove, switch to synth two", "clockId": "c", "startFrame": 0,
                       "endFrame": 1, "duringRecording": True}, 0)
    assert [m["command"]["operation"]["type"] for m in out if m["type"] == "command"] == ["stop-recording", "select"]
    same = conn.handle({"type": "utterance", "id": "u2", "text": "Groove, select synth one", "clockId": "c", "startFrame": 2,
                        "endFrame": 3, "duringRecording": True}, 0)
    assert [m["command"]["operation"]["type"] for m in same if m["type"] == "command"] == ["select"]  # same track: no stop


def test_a_counted_clear_never_falls_back_to_clearing_the_lane():
    conn = agent_connection()
    assert say(conn, "Groove, delete every third snare", "u1") == []
    [error] = conn.language_result(conn._language.jobs[0], None, "language request timed out; no change applied", 1)
    assert error["type"] == "error" and conn.pending_command_ids == []


@pytest.mark.parametrize("text, expected", [
    ("Groove, make the drums one bar long", [("drums", 1)]),
    ("Groove, set synth three to two bars", [("synth-3", 2)]),
    ("Groove, make every track four bars", [("synth-1", 4), ("synth-2", 4), ("synth-3", 4), ("drums", 4)]),
])
def test_track_length_phrases(text, expected):
    result = interpret(text, song(), False)
    steps = result.steps if hasattr(result, "steps") else (result,)
    assert [(s.operation["trackId"], s.operation["bars"]) for s in steps] == expected
    for step in steps:
        validate("SessionCommand", {"id": "x", "expectedRevision": 0, "boundary": step.boundary, "operation": step.operation})


def test_drum_patterns_fill_only_a_short_tracks_length():
    session = song()
    session["tracks"][3]["bars"] = 1
    [op] = drum_fill(session, "closed-hat", every=2)
    assert sorted(h["step"] for h in op["hits"] if h["lane"] == "closed-hat") == list(range(0, 16, 2))
