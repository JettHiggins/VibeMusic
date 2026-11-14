"""WAV streaming harness for the speech pipeline, without a browser or an STT provider.

A synthetic take is written to disk as a 16 kHz WAV: beatboxed hits (short noise bursts)
and one voiced segment standing in for "Groove, stop". It is read back and streamed in
20 ms speech-audio chunks on a 44.1 kHz capture clock through the real Connection.

The transcriber is SCRIPTED: it returns fixed text for each segment in order. These tests
prove segmentation timing, command-span frame math and speech-verified ordering; they do
not test speech recognition, which needs the pending STT provider decision.
"""
import base64
import wave

import numpy as np
import pytest

from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture, validate

CONTEXT_RATE, PAYLOAD_RATE = 44100, 16000
CHUNK = 320  # 20 ms at 16 kHz
CHUNK_FRAMES = 882  # 20 ms at 44.1 kHz
TAKE_START = 352800  # recording window opens at the second loop at 120 BPM
WINDOW_FRAMES = CHUNK_FRAMES  # segmenter resolution is one 20 ms window


class ScriptedTranscriber:
    name = "SCRIPTED test transcriber (not speech recognition)"

    def __init__(self, texts):
        self.texts = list(texts)
        self.calls = []

    def transcribe(self, samples, sample_rate):
        self.calls.append(len(samples) / sample_rate)
        return self.texts.pop(0) if self.texts else ""


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


def chunks_from_wav(path, start_frame=TAKE_START, stream="take-1", clock="ctx"):
    with wave.open(str(path)) as source:
        assert source.getframerate() == PAYLOAD_RATE and source.getnchannels() == 1
        pcm = source.readframes(source.getnframes())
    for seq, offset in enumerate(range(0, len(pcm) // 2 - CHUNK + 1, CHUNK)):
        data = pcm[offset * 2:(offset + CHUNK) * 2]
        begin = start_frame + seq * CHUNK_FRAMES
        yield {"type": "speech-audio", "streamId": stream, "seq": seq, "clockId": clock, "startFrame": begin,
               "endFrame": begin + CHUNK_FRAMES, "sampleRate": PAYLOAD_RATE, "encoding": "pcm-s16le",
               "data": base64.b64encode(data).decode()}


def connect(transcriber, recording=True, clock="ctx"):
    connection = Connection(transcriber=transcriber)
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


def stream(connection, chunks):
    """Returns [(chunk, replies)] after validating every frame in both directions."""
    log = []
    for chunk in chunks:
        validate("ClientMessage", chunk)
        replies = connection.handle(chunk, 0.0)
        for reply in replies:
            validate("ServerMessage", reply)
        log.append((chunk, replies))
    return log


def frame_at(seconds):
    return TAKE_START + round(seconds * CONTEXT_RATE)


@pytest.fixture
def take(tmp_path):
    return synth_take(tmp_path / "take.wav")


def test_groove_stop_during_recording_gets_a_measured_span_then_a_command_then_the_watermark(take):
    transcriber = ScriptedTranscriber(["Groove, stop"])
    log = stream(connect(transcriber), chunks_from_wav(take))
    replies = [r for _, rs in log for r in rs]
    assert replies[0] == {"type": "speech-status", "available": True, "provider": transcriber.name}
    spans = [r for r in replies if r["type"] == "command-span"]
    assert len(spans) == 1 and len(transcriber.calls) == 1  # the three hits were never sent to the transcriber
    span = spans[0]
    assert abs(span["startFrame"] - frame_at(2.0)) <= WINDOW_FRAMES
    assert abs(span["endFrame"] - frame_at(2.7)) <= WINDOW_FRAMES
    commands = [r["command"] for r in replies if r["type"] == "command"]
    assert [c["operation"]["type"] for c in commands] == ["stop-recording"]
    # Ordering: span, then command, then the first watermark that covers the span.
    order = [r["type"] for r in replies]
    covering = next(i for i, r in enumerate(replies) if r["type"] == "speech-verified" and r["throughFrame"] >= span["startFrame"])
    assert order.index("command-span") < order.index("command") < covering


def test_watermark_is_monotonic_never_ahead_of_audio_and_held_during_speech(take):
    log = stream(connect(ScriptedTranscriber(["Groove, stop"])), chunks_from_wav(take))
    marks, received = [], []
    for chunk, replies in log:
        for reply in replies:
            if reply["type"] == "speech-verified":
                assert reply["clockId"] == "ctx"
                assert reply["throughFrame"] <= chunk["endFrame"] - 1  # never past received audio
                marks.append(reply["throughFrame"])
                received.append(chunk["endFrame"] - 1)
    assert marks == sorted(set(marks))  # strictly increasing
    speech_start = frame_at(2.0)
    held = [m for m, r in zip(marks, received) if speech_start <= r < frame_at(2.7)]
    assert all(m < speech_start for m in held)  # nothing during the open segment covers it
    # Hits resolve quickly (burst + 300 ms hangover); the take ends verified up to the trailing hangover.
    assert any(frame_at(0.56) <= m <= frame_at(1.0) for m in marks)
    assert marks[-1] >= frame_at(4.0) - round(0.36 * CONTEXT_RATE)


def test_hits_alone_produce_no_span_and_a_verified_take(tmp_path):
    take = synth_take(tmp_path / "hits.wav", speech=(3.9, 3.9))
    transcriber = ScriptedTranscriber([])
    replies = [r for _, rs in stream(connect(transcriber), chunks_from_wav(take)) for r in rs]
    assert not [r for r in replies if r["type"] in ("command-span", "command")] and transcriber.calls == []
    assert max(r["throughFrame"] for r in replies if r["type"] == "speech-verified") >= frame_at(3.5)


def test_speech_without_the_wake_phrase_during_recording_is_performance(take):
    replies = [r for _, rs in stream(connect(ScriptedTranscriber(["la la la"])), chunks_from_wav(take)) for r in rs]
    assert not [r for r in replies if r["type"] in ("command-span", "command", "error")]
    assert max(r["throughFrame"] for r in replies if r["type"] == "speech-verified") > frame_at(2.7)


def test_outside_recording_plain_speech_is_a_command_without_a_span(take):
    replies = [r for _, rs in stream(connect(ScriptedTranscriber(["play"]), recording=False), chunks_from_wav(take))
               for r in rs]
    assert not [r for r in replies if r["type"] == "command-span"]
    assert [r["command"]["operation"] for r in replies if r["type"] == "command"] == [{"type": "play", "playing": True}]


def test_a_dropped_chunk_freezes_the_watermark_before_the_gap(take):
    chunks = list(chunks_from_wav(take))
    del chunks[60]  # 1.2 s
    log = stream(connect(ScriptedTranscriber(["Groove, stop"])), chunks)
    replies = [r for _, rs in log for r in rs]
    errors = [r for r in replies if r["type"] == "error"]
    assert len(errors) == 1 and "expected seq 60" in errors[0]["message"]  # caught before the frame gap
    gap_start = chunks[59]["endFrame"]
    assert max(r["throughFrame"] for r in replies if r["type"] == "speech-verified") < gap_start
    assert not [r for r in replies if r["type"] == "command-span"]  # later audio was never classified
