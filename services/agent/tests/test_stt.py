"""Opt-in local recognition check: GROOVE_TEST_STT=1 GROOVE_TEST_STT_WAV=<16 kHz mono WAV of "Groove, stop">.

Loads faster-whisper (downloads the model on first run), embeds the spoken phrase in a take
between beatboxed hits, and streams it through the real Connection and ThreadedSpeechWorker.
Use a synthetic voice (e.g. Windows SAPI) or your own recording; do not commit either. A pass
shows the pipeline works with a real recognizer; it is not a physical-microphone signoff.
"""
import os
import threading
import time
import wave

import numpy as np
import pytest

pytestmark = pytest.mark.skipif(os.environ.get("GROOVE_TEST_STT") != "1" or not os.environ.get("GROOVE_TEST_STT_WAV"),
                                reason="set GROOVE_TEST_STT=1 and GROOVE_TEST_STT_WAV to run local recognition")


def test_spoken_groove_stop_streams_to_span_command_and_scoped_watermark(tmp_path):
    from groove_agent.connection import Connection
    from groove_agent.speech_pipeline import ThreadedSpeechWorker
    from groove_agent.stt import FasterWhisperTranscriber
    from test_speech_harness import CONTEXT_RATE, PAYLOAD_RATE, TAKE_START, chunks_from_wav, connect

    with wave.open(os.environ["GROOVE_TEST_STT_WAV"]) as source:
        assert source.getframerate() == PAYLOAD_RATE and source.getnchannels() == 1
        voice = np.frombuffer(source.readframes(source.getnframes()), "<i2").astype(np.float64) / 32768
    rng = np.random.default_rng(3)
    take = 0.0005 * rng.standard_normal(int(1.5 * PAYLOAD_RATE))
    for start in (0.3, 0.8):
        i, n = int(start * PAYLOAD_RATE), int(0.06 * PAYLOAD_RATE)
        take[i:i + n] += 0.6 * rng.standard_normal(n) * np.exp(-np.arange(n) / 240)
    audio = np.concatenate([take, voice, 0.0005 * rng.standard_normal(PAYLOAD_RATE)])
    path = tmp_path / "take.wav"
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1), out.setsampwidth(2), out.setframerate(PAYLOAD_RATE)
        out.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())

    replies, lock, done = [], threading.Lock(), threading.Event()
    stt = FasterWhisperTranscriber()

    def deliver(job, text, error):  # stands in for the service's call_soon_threadsafe hand-off
        with lock:
            replies.extend(connection.speech_result(job, text, error, time.monotonic()))
            if any(r["type"] == "command" for r in replies) or error:
                done.set()

    worker = ThreadedSpeechWorker(stt, deliver)
    connection = connect(worker)
    started = time.perf_counter()
    for chunk in chunks_from_wav(path):
        with lock:
            replies.extend(connection.handle(chunk, time.monotonic()))
    assert done.wait(30), replies
    worker.close()
    with lock:
        kinds = [r["type"] for r in replies]
        spans = [r for r in replies if r["type"] == "command-span"]
        commands = [r["command"]["operation"] for r in replies if r["type"] == "command"]
    assert commands == [{"type": "stop-recording"}], replies
    voice_start = TAKE_START + round(1.5 * CONTEXT_RATE)
    assert len(spans) == 1 and abs(spans[0]["startFrame"] - voice_start) < 0.3 * CONTEXT_RATE
    assert kinds.index("command-span") < kinds.index("command")
    covering = [r for r in replies if r["type"] == "speech-verified" and r["throughFrame"] >= spans[0]["endFrame"]]
    assert covering and covering[0]["streamId"] == "take-1" and covering[0]["fromFrame"] == TAKE_START
    print(f"{stt.name}: stop-recording proposed {time.perf_counter() - started:.2f}s after streaming began")



def test_real_model_joined_melody_and_stop_preserves_preceding_notes(tmp_path):
    from groove_agent.speech_pipeline import ThreadedSpeechWorker
    from groove_agent.stt import FasterWhisperTranscriber, to_whisper_rate
    from test_speech_harness import TAKE_START, PAYLOAD_RATE, CONTEXT_RATE, connect, chunks_from_wav
    with wave.open(os.environ["GROOVE_TEST_STT_WAV"]) as source:
        rate = source.getframerate()
        voice = np.frombuffer(source.readframes(source.getnframes()), "<i2").astype(np.float32) / 32768
    voice = to_whisper_rate(voice, rate)
    audible = np.flatnonzero(abs(voice) > .005)
    assert len(audible)
    voice = voice[audible[0]:audible[-1] + 1]
    # Same three pitches/durations and half-second transition as WS1's short-pause repro.
    music = np.zeros(2 * PAYLOAD_RATE, np.float32)
    for start, duration, midi in [(0, .375, 60), (.5, .375, 64), (1, .5, 67)]:
        t = np.arange(round(duration * PAYLOAD_RATE)) / PAYLOAD_RATE
        envelope = np.minimum(1, np.minimum(t / .015, (duration - t) / .015))
        tone = sum(.15 * envelope * np.sin(2 * np.pi * 440 * 2 ** ((midi - 69) / 12) * h * t) / h**2
                   for h in range(1, 5))
        music[round(start * PAYLOAD_RATE):round(start * PAYLOAD_RATE) + len(t)] = tone
    audio = np.concatenate([music, voice, np.zeros(PAYLOAD_RATE, np.float32)])
    path = tmp_path / "synthetic-joined-stop.wav"
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1), out.setsampwidth(2), out.setframerate(PAYLOAD_RATE)
        out.writeframes((audio * 32767).astype("<i2").tobytes())
    replies, jobs, lock, done = [], [], threading.Lock(), threading.Event()
    def deliver(job, text, error):
        with lock:
            jobs.append((job, text, error))
            replies.extend(connection.speech_result(job, text, error, time.monotonic()))
            done.set()
    worker = ThreadedSpeechWorker(FasterWhisperTranscriber(), deliver)
    connection = connect(worker)
    try:
        for chunk in chunks_from_wav(path):
            with lock:
                replies.extend(connection.handle(chunk, time.monotonic()))
        assert done.wait(30)
    finally:
        worker.close()
        worker.join()
    from groove_agent.contracts import validate
    for reply in replies:
        validate("ServerMessage", reply)
    assert len(jobs) == 1, jobs  # the same energy segment still includes singing and command
    assert [r["command"]["operation"] for r in replies if r["type"] == "command"] == [{"type": "stop-recording"}], jobs
    spans = [r for r in replies if r["type"] == "command-span"]
    assert len(spans) == 1
    span = spans[0]
    assert TAKE_START + 1.5 * CONTEXT_RATE < span["startFrame"] <= TAKE_START + 2.1 * CONTEXT_RATE
    assert span["endFrame"] >= TAKE_START + (2 + len(voice) / PAYLOAD_RATE - .1) * CONTEXT_RATE
    covering = next(i for i, r in enumerate(replies) if r["type"] == "speech-verified" and r["throughFrame"] >= span["endFrame"])
    assert replies.index(span) < next(i for i, r in enumerate(replies) if r["type"] == "command") < covering
    print("real local model preserved all tones before span", span, "transcript", jobs[0][1])
