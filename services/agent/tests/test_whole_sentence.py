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
