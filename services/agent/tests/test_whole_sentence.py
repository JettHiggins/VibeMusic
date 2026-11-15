"""Voice reliability round, WS3: whole-sentence endpointing and reliable spoken stop.

Real EnergySegmenter and Connection on synthetic 16 kHz takes streamed in 20 ms chunks; the
transcriber is SCRIPTED (it returns fixed text per segment), so these prove segmentation, holding,
joining, spans and ordering, not recognition. Pauses and the 4 s segment cap must not execute
unfinished fragments or send them to the language model; complete commands (Groove stop) never wait.
"""
import numpy as np

from groove_agent.speech_pipeline import EnergySegmenter
from groove_agent.speech import decode_chunk
from test_speech_harness import (CONTEXT_RATE, WINDOW_FRAMES, ScriptedWorker, chunks_from_wav, connect, flat, frame_at,
                                 stream, synth_take)


class PendingLanguage:
    def __init__(self):
        self.jobs = []
    def submit(self, job):
        self.jobs.append(job)
        return True


def run(tmp_path, texts, recording, speech, more=(), seconds=7.0, language=False):
    worker = ScriptedWorker(texts)
    connection = connect(worker, recording=recording)
    if language:
        connection._language = PendingLanguage()
    take = synth_take(tmp_path / "take.wav", hits=(), speech=speech, more_speech=more, seconds=seconds)
    replies = flat(stream(connection, worker, chunks_from_wav(take)))
    return connection, worker, replies


def commands(replies):
    return [r["command"]["operation"] for r in replies if r["type"] == "command"]


def test_a_pause_inside_a_sentence_gives_one_command_not_a_fragment(tmp_path):
    connection, worker, replies = run(tmp_path, ["Groove, set the tempo to", "one forty"], recording=False,
                                      speech=(2.0, 2.8), more=((3.7, 4.2),), language=True)
    assert len(worker.transcribed) == 2  # really two segments: the pause outlasted the hangover
    assert commands(replies) == [{"type": "tempo", "bpm": 140}]
    assert not [r for r in replies if r["type"] == "error"] and connection._language.jobs == []


def test_a_take_command_split_by_a_pause_keeps_one_span_over_the_whole_sentence(tmp_path):
    connection, worker, replies = run(tmp_path, ["Groove, erase bar two", "beat three"], recording=True,
                                      speech=(2.0, 2.8), more=((3.7, 4.2),))
    spans = [r for r in replies if r["type"] == "command-span"]
    assert len(spans) == 1
    assert abs(spans[0]["startFrame"] - frame_at(2.0)) <= WINDOW_FRAMES
    assert abs(spans[0]["endFrame"] - frame_at(4.2)) <= 2 * WINDOW_FRAMES
    assert commands(replies) == [{"type": "erase-event", "target": {"trackId": "drums", "lane": "kick"}, "step": 24}]
    order = [r["type"] for r in replies]
    covering = next(i for i, r in enumerate(replies) if r["type"] == "speech-verified"
                    and r["throughFrame"] >= spans[0]["startFrame"])
    assert order.index("command-span") < order.index("command") < covering  # nothing verified before the span


def test_singing_after_a_refused_fragment_is_never_swallowed_into_the_command_span(tmp_path):
    connection, worker, replies = run(tmp_path, ["Groove, erase bar two", "la la la"], recording=True,
                                      speech=(2.0, 2.8), more=((3.7, 4.2),))
    spans = [r for r in replies if r["type"] == "command-span"]
    assert len(spans) == 1 and spans[0]["endFrame"] < frame_at(3.7)  # the sung segment stays in the take
    assert commands(replies) == []
    assert [r["requestId"] for r in replies if r["type"] == "error"] == [worker.transcribed[0].job_id]


def test_a_sentence_longer_than_the_segment_cap_is_joined_not_cut(tmp_path):
    take = synth_take(tmp_path / "long.wav", hits=(), speech=(1.0, 6.0), seconds=8.0)
    segmenter = EnergySegmenter(16000)
    segments = [segment for chunk in chunks_from_wav(take) for segment in segmenter.feed(decode_chunk(chunk, CONTEXT_RATE))]
    assert [segment.cut for segment in segments] == [True, False]  # a forced 4 s cut, then the natural end
    connection, worker, replies = run(tmp_path, ["Groove, set the tempo", "to ninety please"], recording=True,
                                      speech=(1.0, 6.0), seconds=8.5, language=True)
    assert commands(replies) == [{"type": "tempo", "bpm": 90}]
    spans = [r for r in replies if r["type"] == "command-span"]
    assert len(spans) == 1 and spans[0]["endFrame"] >= frame_at(5.9)
    assert connection._language.jobs == []  # the fragment never reached the language model


def test_an_unknown_sentence_reaches_the_model_once_and_whole(tmp_path):
    connection, worker, replies = run(tmp_path, ["Groove, make the bass line", "a little more bouncy"], recording=False,
                                      speech=(2.0, 2.8), more=((3.7, 4.6),), seconds=7.5, language=True)
    assert [job.text for job in connection._language.jobs] == ["Groove, make the bass line a little more bouncy"]


def test_groove_stop_is_not_delayed_by_sentence_holding_and_keeps_playback(tmp_path):
    worker = ScriptedWorker(["Groove, stop", "la la la"])
    connection = connect(worker, recording=True)
    # Singing resumes 0.8 s later (past the 0.6 s hangover). KNOWN LIMIT: singing resumed within the
    # hangover merges into the same energy segment, so stop then waits for a pause or the 4 s cap.
    take = synth_take(tmp_path / "stop.wav", hits=(), speech=(2.0, 2.6), more_speech=((3.4, 4.0),), seconds=4.4)
    log = stream(connection, worker, chunks_from_wav(take))
    issued = next(chunk for chunk, replies in log if any(r["type"] == "command" for r in replies))
    # Issued as soon as the "Groove, stop" segment closes (hangover), long before the 2 s join wait.
    assert issued["endFrame"] <= frame_at(2.6 + 0.6 + 0.1)
    assert commands(flat(log)) == [{"type": "stop-recording"}]  # stop-recording, never play(false)
    assert connection._speech_state["take-1"].held_wake is None


def test_a_new_addressed_command_after_a_fragment_is_not_merged_into_it(tmp_path):
    connection, worker, replies = run(tmp_path, ["Groove, set the tempo to", "Groove stop"], recording=True,
                                      speech=(2.0, 2.8), more=((3.5, 4.0),))
    assert commands(replies) == [{"type": "stop-recording"}]
    errors = [r for r in replies if r["type"] == "error"]
    assert len(errors) == 1 and errors[0]["requestId"] == worker.transcribed[0].job_id


def test_spoken_stop_variants_parse_as_stop_recording_during_a_take():
    from groove_agent.contracts import load_fixture
    from groove_agent.intents import Command, interpret
    session = load_fixture("SessionState")
    for text in ("Groove, stop.", "Groove stop recording", "Grove, stop!", "Groove, stopped", "Groove... stop"):
        assert interpret(text, session, True) == Command({"type": "stop-recording"}, "immediate"), text
    assert interpret("Groove stop playback", session, True) == Command({"type": "play", "playing": False}, "immediate")


class ProbingWorker(ScriptedWorker):
    """SCRIPTED transcriber that also answers early-stop probes (like ThreadedSpeechWorker)."""
    supports_probe = True

    def __init__(self, probe_text, texts=()):
        super().__init__(texts)
        self.probe_text, self.probed = probe_text, []

    def finish(self, connection):
        replies = []
        while self.jobs:
            job = self.jobs.pop(0)
            if job.probe:
                # Only the first probe hears the scripted words; later dips are inside the singing.
                text = "" if self.probed else self.probe_text
                self.probed.append(job)
                replies += connection.speech_result(job, text, None, 0.0)
            else:
                self.transcribed.append(job)
                replies += connection.speech_result(job, self.texts.pop(0) if self.texts else "", None, 0.0)
        return replies


def test_groove_stop_followed_quickly_by_singing_stops_at_the_dip_and_keeps_the_singing(tmp_path):
    # Singing resumes 0.4 s after "Groove, stop": inside the 0.6 s hangover, so energy alone would
    # keep one open segment until the singing pauses. The 0.25 s dip probe acts on the stop at once.
    worker = ProbingWorker("Groove, stop.", texts=["la la la"])
    connection = connect(worker, recording=True)
    take = synth_take(tmp_path / "quick.wav", hits=(), speech=(2.0, 2.6), more_speech=((3.0, 3.6),), seconds=4.6)
    log = stream(connection, worker, chunks_from_wav(take))
    replies = flat(log)
    issued = next(chunk for chunk, rs in log if any(r["type"] == "command" for r in rs))
    assert issued["endFrame"] <= frame_at(2.6 + 0.25 + 0.05)
    assert commands(replies) == [{"type": "stop-recording"}]
    spans = [r for r in replies if r["type"] == "command-span"]
    assert len(spans) == 1 and spans[0]["endFrame"] < frame_at(3.0)  # the singing stays in the take
    assert len(worker.transcribed) == 1 and worker.transcribed[0].segment.start_frame >= frame_at(2.9)
    order = [r["type"] for r in replies]
    assert order.index("command-span") < order.index("command")


def test_a_probe_that_is_not_exactly_a_stop_never_acts_and_the_full_segment_decides(tmp_path):
    worker = ProbingWorker("Groove, set the tempo", texts=["Groove, set the tempo to ninety"])
    connection = connect(worker, recording=True)
    take = synth_take(tmp_path / "noprobe.wav", hits=(), speech=(2.0, 2.6), more_speech=((3.0, 3.6),), seconds=4.8)
    replies = flat(stream(connection, worker, chunks_from_wav(take)))
    assert worker.probed and len(worker.transcribed) == 1
    assert commands(replies) == [{"type": "tempo", "bpm": 90}]


def test_probes_are_off_outside_a_take_and_for_workers_without_probe_support(tmp_path):
    take = synth_take(tmp_path / "idle.wav", hits=(), speech=(2.0, 2.6), more_speech=((3.0, 3.6),), seconds=4.6)
    idle = ProbingWorker("Groove, stop.", texts=["Groove stop la la"])
    flat(stream(connect(idle, recording=False), idle, chunks_from_wav(take)))
    assert idle.probed == []
    plain = ScriptedWorker(["Groove, stop."])
    replies = flat(stream(connect(plain, recording=True), plain, chunks_from_wav(take)))
    assert commands(replies) == [{"type": "stop-recording"}] and all(not job.probe for job in plain.transcribed)


def test_at_most_one_probe_is_in_flight_per_stream(tmp_path):
    class SlowProbes(ProbingWorker):
        def finish(self, connection):  # probes are never answered: they stay in flight
            self.jobs = [job for job in self.jobs if not job.probe or self.probed.append(job)]
            return super().finish(connection)
    worker = SlowProbes("Groove, stop.", texts=["la la la"])
    take = synth_take(tmp_path / "dips.wav", hits=(), speech=(1.0, 1.4), more_speech=((1.7, 2.1), (2.4, 2.8), (3.1, 3.5)),
                      seconds=3.6)
    flat(stream(connect(worker, recording=True), worker, chunks_from_wav(take)))
    assert len(worker.probed) == 1


# -- WS1 review of PR #43 (docs/reviews/PR43-SENTENCE-REVIEW.md): valid prefixes and coverage ------

from groove_agent.connection import HOLD_LAG_BUDGET_SECONDS  # noqa: E402
from test_research import FakePort  # noqa: E402


def research_run(tmp_path, texts, speech, more=(), seconds=9.0, recording=False):
    worker = ScriptedWorker(texts)
    connection = connect(worker, recording=recording)
    connection.session["selected"] = {"trackId": "synth-1"}
    connection._research = port = FakePort()
    connection._voice_research = True
    take = synth_take(tmp_path / "research.wav", hits=(), speech=speech, more_speech=more, seconds=seconds)
    log = stream(connection, worker, chunks_from_wav(take))
    return connection, port, log


def test_ws1_repro_forced_cut_valid_sound_prefix_waits_for_the_whole_request(tmp_path):
    _, port, log = research_run(tmp_path, ["Groove make it sound like a warm piano", "with a soft attack"], speech=(1, 6))
    early = [r for chunk, replies in log if chunk["endFrame"] < frame_at(6) for r in replies if r["type"] == "research-context"]
    assert early == []
    assert [description for _, description, _ in port.started] == ["warm piano with a soft attack"]
    contexts = [r for r in flat(log) if r["type"] == "research-context"]
    assert len(contexts) == 1 and contexts[0]["description"] == "warm piano with a soft attack"


def test_a_paused_valid_sound_prefix_is_completed_by_its_continuation(tmp_path):
    _, port, _ = research_run(tmp_path, ["Groove, find a warm piano", "with a soft attack"],
                              speech=(1.0, 2.2), more=((3.0, 3.8),), seconds=7.0)
    assert [description for _, description, _ in port.started] == ["warm piano with a soft attack"]


def test_a_complete_sound_request_starts_exactly_once_after_the_join_wait(tmp_path):
    _, port, log = research_run(tmp_path, ["Groove, find a warm piano"], speech=(1.0, 2.2), seconds=5.0)
    started = next(chunk for chunk, replies in log if any(r["type"] == "research-context" for r in replies))
    assert frame_at(2.2 + 2.0) <= started["endFrame"] <= frame_at(2.2 + 0.6 + 2.0 + 0.1)
    assert [description for _, description, _ in port.started] == ["warm piano"]


def test_singing_after_a_sound_request_in_a_take_is_not_part_of_it(tmp_path):
    _, port, log = research_run(tmp_path, ["Groove, find a warm piano", "la la la"], speech=(1.0, 2.2),
                                more=((3.0, 3.8),), seconds=7.0, recording=True)
    assert [description for _, description, _ in port.started] == ["warm piano"]
    spans = [r for r in flat(log) if r["type"] == "command-span"]
    assert len(spans) == 1 and spans[0]["endFrame"] < frame_at(3.0)


def test_priority_stop_in_a_forced_cut_segment_acts_without_waiting(tmp_path):
    worker = ScriptedWorker(["Groove, stop", "la la la"])
    connection = connect(worker, recording=True)
    log = stream(connection, worker, chunks_from_wav(synth_take(tmp_path / "cutstop.wav", hits=(), speech=(1, 6), seconds=7)))
    issued = next(chunk for chunk, replies in log if any(r["type"] == "command" for r in replies))
    assert worker.transcribed[0].segment.cut and issued["endFrame"] <= frame_at(5.1)  # at the 4 s cut, not after
    assert commands(flat(log)) == [{"type": "stop-recording"}]


def test_complete_commands_are_never_held(tmp_path):
    _, worker, replies = run(tmp_path, ["Groove tempo 100", "Groove select synth three"], recording=False,
                             speech=(1.0, 1.8), more=((2.4, 3.2),), seconds=4.2)
    assert commands(replies) == [{"type": "tempo", "bpm": 100}, {"type": "select", "target": {"trackId": "synth-3"}}]


def test_held_sentences_never_push_browser_coverage_past_its_eight_second_stall_limit(tmp_path):
    # An unfinished fragment followed by long continuous speech (cut at 4 s) and more speech: the
    # longest hold this produces. Coverage lag is what the browser's SpeechSession measures:
    # last received frame minus the latest speech-verified throughFrame.
    worker = ScriptedWorker(["Groove, set the tempo to", "um so I was thinking that maybe", "we could try", "something"])
    connection = connect(worker, recording=True)
    take = synth_take(tmp_path / "lag.wav", hits=(), speech=(1.0, 1.8), more_speech=((2.3, 7.0), (7.3, 9.5)), seconds=12)
    verified, worst = frame_at(0), 0.0
    for chunk, replies in stream(connection, worker, chunks_from_wav(take)):
        for reply in replies:
            if reply["type"] == "speech-verified":
                verified = reply["throughFrame"]
        worst = max(worst, (chunk["endFrame"] - verified) / CONTEXT_RATE)
    print(f"worst coverage lag {worst:.2f} s")
    assert HOLD_LAG_BUDGET_SECONDS < 8.0 and worst < 8.0, worst


# -- WS1 follow-up review (docs/reviews/PR43-followup-reproduction.py) -------------------------------

def test_a_request_still_going_at_the_hold_budget_is_refused_never_partly_executed(tmp_path):
    connection, port, log = research_run(
        tmp_path, ["Groove make it sound like a warm piano", "with a soft attack and a mellow tone", "and a little chorus"],
        speech=(1, 9.5), seconds=13)
    replies = flat(log)
    assert port.started == [] and not [r for r in replies if r["type"] in ("research-context", "command")]
    errors = [r for r in replies if r["type"] == "error"]
    assert len(errors) == 1 and "too long" in errors[0]["message"] and "nothing was changed" in errors[0]["message"]


def test_a_refused_long_request_in_a_take_is_excluded_and_its_continuation_never_acts(tmp_path):
    worker = ScriptedWorker(["Groove set the tempo to", "um one hundred and something like", "forty"])
    connection = connect(worker, recording=True)
    take = synth_take(tmp_path / "long-take.wav", hits=(), speech=(1, 9.5), seconds=13)
    replies = flat(stream(connection, worker, chunks_from_wav(take)))
    assert commands(replies) == []
    spans = [r for r in replies if r["type"] == "command-span"]
    assert spans and spans[0]["startFrame"] <= frame_at(1.05) and max(s["endFrame"] for s in spans) >= frame_at(9.0)


def test_a_failed_probe_frees_its_slot_so_a_later_dip_can_still_stop(tmp_path):
    class FlakyProbes(ScriptedWorker):
        supports_probe = True
        def __init__(self):
            super().__init__(["la la la"])
            self.probes = []
        def finish(self, connection):
            replies = []
            while self.jobs:
                job = self.jobs.pop(0)
                if job.probe:
                    self.probes.append(job)
                    failed = len(self.probes) == 1
                    text = None if failed else ("Groove stop" if len(self.probes) == 2 else "")
                    replies += connection.speech_result(job, text, "temporary probe failure" if failed else None, 0.0)
                else:
                    self.transcribed.append(job)
                    replies += connection.speech_result(job, self.texts.pop(0) if self.texts else "", None, 0.0)
            return replies
    worker = FlakyProbes()
    connection = connect(worker, recording=True)
    take = synth_take(tmp_path / "flaky.wav", hits=(), speech=(1, 1.4), more_speech=((1.7, 2.1), (2.4, 2.8), (3.1, 3.5)),
                      seconds=4.8)
    replies = flat(stream(connection, worker, chunks_from_wav(take)))
    assert len(worker.probes) >= 2 and commands(replies) == [{"type": "stop-recording"}]


def test_a_stale_probe_result_cannot_clear_or_act_for_a_newer_probe(tmp_path):
    worker = ProbingWorker("Groove, stop.")
    connection = connect(worker, recording=True)
    take = synth_take(tmp_path / "stale.wav", hits=(), speech=(2.0, 2.6), seconds=2.95)  # ends inside the hangover
    for chunk in chunks_from_wav(take):
        connection.handle(chunk, 0.0)  # probes queue up but are not answered yet
    state = connection._speech_state["take-1"]
    current = state.probing
    assert current is not None
    from dataclasses import replace
    stale = replace(current, job_id=current.job_id + ":old")
    assert connection.speech_result(stale, "Groove, stop.", None, 0.0) == [] and state.probing is current
