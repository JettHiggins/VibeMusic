"""WAV streaming harness for the speech pipeline, without a browser or an STT provider.

A synthetic take is written to disk as a 16 kHz WAV: beatboxed hits (short noise bursts)
and one voiced segment standing in for "Groove, stop". It is read back and streamed in
20 ms speech-audio chunks on a 44.1 kHz capture clock through the real Connection.

Transcription goes through a SpeechWorker, as in the service, but the worker here is
SCRIPTED: it returns fixed text for each segment in order, when the test chooses. These
tests prove segmentation timing, command-span frame math, stream-scoped coverage and
ordering; they do not test speech recognition. Energy segmentation is experimental.
"""
import base64
import threading
import wave

import numpy as np
import pytest

from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture, validate
from groove_agent.speech_pipeline import ThreadedSpeechWorker

CONTEXT_RATE, PAYLOAD_RATE = 44100, 16000
CHUNK = 320  # 20 ms at 16 kHz
CHUNK_FRAMES = 882  # 20 ms at 44.1 kHz
TAKE_START = 352800  # recording window opens at the second loop at 120 BPM
WINDOW_FRAMES = CHUNK_FRAMES  # segmenter resolution is one 20 ms window


class ScriptedWorker:
    """Queues jobs like a background worker; `finish` delivers SCRIPTED results in order."""
    name = "SCRIPTED test transcriber (not speech recognition)"

    def __init__(self, texts=(), fail=False):
        self.texts, self.fail, self.jobs, self.transcribed = list(texts), fail, [], []

    def submit(self, job):
        self.jobs.append(job)

    def finish(self, connection):
        replies = []
        while self.jobs:
            job = self.jobs.pop(0)
            self.transcribed.append(job)
            if self.fail:
                replies += connection.speech_result(job, None, "RuntimeError: model crashed", 0.0)
            else:
                replies += connection.speech_result(job, self.texts.pop(0) if self.texts else "", None, 0.0)
        return replies


def synth_take(path, hits=(0.5, 1.0, 1.5), speech=(2.0, 2.7), seconds=4.0):
    rng = np.random.default_rng(7)
    t = np.arange(int(seconds * PAYLOAD_RATE)) / PAYLOAD_RATE
    audio = 0.0005 * rng.standard_normal(len(t))  # room noise, about -66 dBFS
    for start in hits:  # 60 ms kick-like bursts: loud but too short to be speech
        i = int(start * PAYLOAD_RATE)
        n = int(0.06 * PAYLOAD_RATE)
        audio[i:i + n] += 0.6 * rng.standard_normal(n) * np.exp(-np.arange(n) / (0.015 * PAYLOAD_RATE))
    a, b = (int(x * PAYLOAD_RATE) for x in speech)
    voiced = t[a:b] - t[a]
    syllables = 0.6 + 0.4 * np.sin(2 * np.pi * 4 * voiced)  # stays voiced, like connected speech
    audio[a:b] += 0.2 * syllables * sum(np.sin(2 * np.pi * 140 * k * voiced) / k for k in range(1, 6))
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(PAYLOAD_RATE)
        out.writeframes(pcm.tobytes())
    return path


def chunks_from_wav(path, start_frame=TAKE_START, stream="take-1", clock="ctx", first_seq=0):
    with wave.open(str(path)) as source:
        assert source.getframerate() == PAYLOAD_RATE and source.getnchannels() == 1
        pcm = source.readframes(source.getnframes())
    for index, offset in enumerate(range(0, len(pcm) // 2 - CHUNK + 1, CHUNK)):
        data = pcm[offset * 2:(offset + CHUNK) * 2]
        begin = start_frame + index * CHUNK_FRAMES
        yield {"type": "speech-audio", "streamId": stream, "seq": first_seq + index, "clockId": clock,
               "startFrame": begin, "endFrame": begin + CHUNK_FRAMES, "sampleRate": PAYLOAD_RATE,
               "encoding": "pcm-s16le", "data": base64.b64encode(data).decode()}


def connect(worker, recording=True, clock="ctx"):
    connection = Connection(speech=worker)
    session = load_fixture("SessionState")
    transport = {"clockId": clock, "sampleRate": CONTEXT_RATE, "currentFrame": TAKE_START, "loopStartFrame": TAKE_START,
                 "playing": True, "recording": recording, "pendingCommandIds": []}
    if recording:
        transport.update(recordingState="recording", recordingStartFrame=TAKE_START,
                         recordingTarget={"trackId": "drums", "lane": "kick"})
    for message in ({"type": "session", "session": session}, {"type": "transport", "transport": transport}):
        validate("ClientMessage", message)
        connection.handle(message, 0.0)
    return connection


def stream(connection, worker, chunks, transcribe_each_chunk=True):
    """Returns [(chunk, replies)]. With transcribe_each_chunk, results arrive right after each chunk."""
    log = []
    for chunk in chunks:
        validate("ClientMessage", chunk)
        replies = connection.handle(chunk, 0.0)
        if transcribe_each_chunk:
            replies += worker.finish(connection)
        for reply in replies:
            validate("ServerMessage", reply)
        log.append((chunk, replies))
    return log


def flat(log):
    return [r for _, rs in log for r in rs]


def marks(replies):
    return [r for r in replies if r["type"] == "speech-verified"]


def frame_at(seconds):
    return TAKE_START + round(seconds * CONTEXT_RATE)


@pytest.fixture
def take(tmp_path):
    return synth_take(tmp_path / "take.wav")


def test_groove_stop_during_recording_gets_a_measured_span_then_a_command_then_the_watermark(take):
    worker = ScriptedWorker(["Groove, stop"])
    replies = flat(stream(connect(worker), worker, chunks_from_wav(take)))
    assert replies[0] == {"type": "speech-status", "streamId": "take-1", "available": True, "provider": worker.name}
    spans = [r for r in replies if r["type"] == "command-span"]
    assert len(spans) == 1 and len(worker.transcribed) == 1  # the three hits were never transcribed
    span = spans[0]
    assert abs(span["startFrame"] - frame_at(2.0)) <= WINDOW_FRAMES
    assert abs(span["endFrame"] - frame_at(2.7)) <= WINDOW_FRAMES
    commands = [r["command"] for r in replies if r["type"] == "command"]
    assert [c["operation"]["type"] for c in commands] == ["stop-recording"]
    order = [r["type"] for r in replies]
    covering = next(i for i, r in enumerate(replies) if r["type"] == "speech-verified" and r["throughFrame"] >= span["startFrame"])
    assert order.index("command-span") < order.index("command") < covering


def test_watermark_is_stream_scoped_monotonic_never_ahead_of_audio_and_held_during_speech(take):
    worker = ScriptedWorker(["Groove, stop"])
    log = stream(connect(worker), worker, chunks_from_wav(take))
    seen, received = [], []
    for chunk, replies in log:
        for reply in marks(replies):
            assert reply["clockId"] == "ctx" and reply["streamId"] == "take-1" and reply["fromFrame"] == TAKE_START
            assert reply["throughFrame"] <= chunk["endFrame"] - 1  # never past received audio
            seen.append(reply["throughFrame"])
            received.append(chunk["endFrame"] - 1)
    assert seen == sorted(set(seen))  # strictly increasing
    speech_start = frame_at(2.0)
    assert all(m < speech_start for m, r in zip(seen, received) if speech_start <= r < frame_at(2.7))
    assert any(frame_at(0.56) <= m <= frame_at(1.0) for m in seen)  # hits resolve after burst + hangover
    assert seen[-1] >= frame_at(4.0) - round(0.36 * CONTEXT_RATE)


def test_watermark_waits_for_a_slow_transcription_then_follows_its_span(take):
    worker = ScriptedWorker(["Groove, stop"])
    connection = connect(worker)
    log = stream(connection, worker, chunks_from_wav(take), transcribe_each_chunk=False)
    early = marks(flat(log))
    assert worker.jobs and max(m["throughFrame"] for m in early) < frame_at(2.0)  # held at the pending segment
    late = worker.finish(connection)
    assert [r["type"] for r in late] == ["command-span", "command", "speech-verified"]
    assert late[-1]["throughFrame"] > frame_at(2.7)


def test_issue_3d_wake_phrase_not_understood_is_excluded_then_reported_without_mutation(take):
    worker = ScriptedWorker(["Groove, banana"])
    replies = flat(stream(connect(worker), worker, chunks_from_wav(take)))
    kinds = [r["type"] for r in replies]
    assert "command" not in kinds
    span = kinds.index("command-span")
    assert kinds[span + 1] == "error"
    covering = next(i for i, r in enumerate(replies) if r["type"] == "speech-verified" and r["throughFrame"] >= frame_at(2.0))
    assert span < covering


def test_a_transcription_failure_holds_coverage_and_reports_the_stream_unavailable(take):
    worker = ScriptedWorker(fail=True)
    replies = flat(stream(connect(worker), worker, chunks_from_wav(take)))
    failure = next(i for i, r in enumerate(replies) if r["type"] == "error")
    assert "recognition failed" in replies[failure]["message"]
    status = replies[failure + 1]
    assert status["type"] == "speech-status" and status["available"] is False and status["streamId"] == "take-1"
    assert not marks(replies[failure:])  # nothing after the failure is ever verified
    assert max(m["throughFrame"] for m in marks(replies)) < frame_at(2.0)


def test_hits_alone_produce_no_span_and_a_verified_take(tmp_path):
    take = synth_take(tmp_path / "hits.wav", speech=(3.9, 3.9))
    worker = ScriptedWorker()
    replies = flat(stream(connect(worker), worker, chunks_from_wav(take)))
    assert not [r for r in replies if r["type"] in ("command-span", "command")] and worker.transcribed == []
    assert max(r["throughFrame"] for r in marks(replies)) >= frame_at(3.5)


def test_speech_without_the_wake_phrase_during_recording_is_performance(take):
    worker = ScriptedWorker(["la la la"])
    replies = flat(stream(connect(worker), worker, chunks_from_wav(take)))
    assert not [r for r in replies if r["type"] in ("command-span", "command", "error")]
    assert max(r["throughFrame"] for r in marks(replies)) > frame_at(2.7)


def test_outside_recording_plain_speech_is_a_command_without_a_span(take):
    worker = ScriptedWorker(["play"])
    replies = flat(stream(connect(worker, recording=False), worker, chunks_from_wav(take)))
    assert not [r for r in replies if r["type"] == "command-span"]
    assert [r["command"]["operation"] for r in replies if r["type"] == "command"] == [{"type": "play", "playing": True}]


def test_ws1_gap_then_new_stream_on_the_same_clock_never_verifies_pre_gap_or_missing_audio(take):
    worker = ScriptedWorker()
    connection = connect(worker)
    chunks = list(chunks_from_wav(take))
    before_gap, after_gap = chunks[:60], chunks[61:]  # chunk 60 (1.2 s) is lost
    replies = flat(stream(connection, worker, before_gap + [after_gap[0]]))
    assert [r for r in replies if r["type"] == "error"]  # the gap breaks take-1
    gap_start = before_gap[-1]["endFrame"]
    old = marks(replies)
    assert all(m["streamId"] == "take-1" and m["throughFrame"] < gap_start for m in old)
    # The browser restarts capture on the same clock as a new stream; it starts after the gap.
    restart = [dict(c, streamId="take-2", seq=i) for i, c in enumerate(after_gap[1:])]
    new = flat(stream(connection, worker, restart))
    assert new[0]["type"] == "speech-status" and new[0]["streamId"] == "take-2"
    new_marks = marks(new)
    assert new_marks and all(m["streamId"] == "take-2" and m["fromFrame"] == restart[0]["startFrame"] for m in new_marks)
    assert restart[0]["startFrame"] > gap_start  # coverage never includes the missing frames or pre-gap input
    assert all(m["fromFrame"] > gap_start for m in new_marks)


def test_threaded_worker_transcribes_off_the_calling_thread_and_reports_failures():
    from groove_agent.speech_pipeline import Segment, SpeechJob
    seen, done = [], threading.Event()

    class Recognizer:
        name = "SCRIPTED threaded test"

        def transcribe(self, samples, rate):
            if len(samples) == 0:
                raise RuntimeError("no audio")
            return f"heard {len(samples)} on {threading.current_thread().name}"

    def deliver(job, text, error):
        seen.append((job.job_id, text, error))
        if len(seen) == 2:
            done.set()

    worker = ThreadedSpeechWorker(Recognizer(), deliver)
    segment = Segment(0, 9, np.zeros(10, np.float32), PAYLOAD_RATE)
    worker.submit(SpeechJob("a", "s", "c", segment))
    worker.submit(SpeechJob("b", "s", "c", Segment(0, 0, np.zeros(0, np.float32), PAYLOAD_RATE)))
    assert done.wait(10)
    worker.close()
    worker.join()
    assert seen[0] == ("a", "heard 10 on speech-worker", None)
    assert seen[1][0] == "b" and seen[1][1] is None and "no audio" in seen[1][2]
    assert threading.current_thread().name != "speech-worker"


# -- capture-time context (WS1 review of c8f4ed4) ------------------------------------------

def transport_message(state, current, start=TAKE_START, clock="ctx", **extra):
    transport = {"clockId": clock, "sampleRate": CONTEXT_RATE, "currentFrame": current, "loopStartFrame": TAKE_START,
                 "playing": True, "recording": state == "recording", "pendingCommandIds": [], "recordingState": state}
    if state == "recording":
        transport.update(recordingStartFrame=start, recordingTarget={"trackId": "drums", "lane": "kick"})
    if state == "armed":
        transport.update(armedTarget={"trackId": "drums", "lane": "snare"})
    transport.update(extra)
    message = {"type": "transport", "transport": transport}
    validate("ClientMessage", message)
    return message


def deliver_after(connection, worker, *transports):
    for message in transports:
        assert connection.handle(message, 0.0) == []
    replies = worker.finish(connection)
    for reply in replies:
        validate("ServerMessage", reply)
    return replies


def test_ws1_repro_result_delivered_after_the_take_stopped_keeps_its_capture_context(take):
    worker = ScriptedWorker(["Groove, stop"])
    connection = connect(worker)
    stream(connection, worker, chunks_from_wav(take), transcribe_each_chunk=False)
    late = deliver_after(connection, worker, transport_message("idle", frame_at(4)))
    kinds = [r["type"] for r in late]
    assert kinds[0] == "command-span"  # spoken during the take: still excluded from it
    assert not any(r["type"] == "command" and r["command"]["operation"] == {"type": "play", "playing": False}
                   for r in late)  # never reinterpreted as ordinary speech that stops playback
    assert "command" not in kinds and kinds[1] == "error" and "ended" in late[1]["message"]
    assert kinds[-1] == "speech-verified" and late[-1]["streamId"] == "take-1"


def test_result_from_an_old_take_never_acts_on_a_new_take_or_count_in(take):
    for newer in (transport_message("armed", frame_at(4.2)),
                  transport_message("recording", frame_at(6), start=frame_at(5))):
        worker = ScriptedWorker(["Groove, stop"])
        connection = connect(worker)
        stream(connection, worker, chunks_from_wav(take), transcribe_each_chunk=False)
        late = deliver_after(connection, worker, transport_message("idle", frame_at(4)), newer)
        assert [r["type"] for r in late][:2] == ["command-span", "error"], newer
        assert "command" not in [r["type"] for r in late]  # the new take is not stopped


def test_a_segment_that_closes_after_the_stop_snapshot_keeps_its_capture_context(take):
    worker = ScriptedWorker(["Groove, stop"])
    connection = connect(worker)
    chunks = list(chunks_from_wav(take))
    split = next(i for i, c in enumerate(chunks) if c["startFrame"] >= frame_at(2.5))  # mid-speech
    stream(connection, worker, chunks[:split])
    connection.handle(transport_message("idle", frame_at(2.6)), 0.0)  # stop arrives before the audio does
    replies = flat(stream(connection, worker, chunks[split:]))
    kinds = [r["type"] for r in replies]
    assert "command-span" in kinds and "command" not in kinds
    span = next(r for r in replies if r["type"] == "command-span")
    assert abs(span["startFrame"] - frame_at(2.0)) <= WINDOW_FRAMES


def test_a_command_inside_the_current_take_still_applies_after_a_slow_transcription(take):
    worker = ScriptedWorker(["Groove, stop"])
    connection = connect(worker)
    stream(connection, worker, chunks_from_wav(take), transcribe_each_chunk=False)
    late = deliver_after(connection, worker, transport_message("recording", frame_at(4.5)))  # same take continues
    assert [r["type"] for r in late][:2] == ["command-span", "command"]
    assert late[1]["command"]["operation"] == {"type": "stop-recording"}


def test_stop_recording_spoken_during_count_in_keeps_its_armed_context(tmp_path):
    take = synth_take(tmp_path / "countin.wav", hits=(), speech=(1.0, 1.6), seconds=3.0)
    worker = ScriptedWorker(["stop recording"])
    connection = connect(worker, recording=False)
    connection.handle(transport_message("armed", TAKE_START), 0.0)
    stream(connection, worker, chunks_from_wav(take), transcribe_each_chunk=False)
    late = deliver_after(connection, worker, transport_message("armed", frame_at(2.9)))
    assert [r["command"]["operation"] for r in late if r["type"] == "command"] == [{"type": "stop-recording"}]
