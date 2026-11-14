"""speech-audio contract proposal: frame math, continuity, and the no-recognizer behaviour."""
import base64

import numpy as np
import pytest

from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture, validate
from groove_agent.speech import ChunkError, StreamTracker, decode_chunk

CONTEXT_RATE = 44100
CLOCK = "audio-context-1"


def transport(clock=CLOCK, rate=CONTEXT_RATE):
    return {"type": "transport", "transport": {"clockId": clock, "sampleRate": rate, "currentFrame": 0,
                                               "loopStartFrame": 0, "playing": True, "recording": True,
                                               "pendingCommandIds": []}}


def chunk(seq, start, frames=882, rate=16000, stream="mic-1", clock=CLOCK, samples=None):
    count = round(frames * rate / CONTEXT_RATE) if samples is None else samples
    pcm = (np.sin(np.arange(count) / 5) * 1000).astype("<i2").tobytes()
    return {"type": "speech-audio", "streamId": stream, "seq": seq, "clockId": clock, "startFrame": start,
            "endFrame": start + frames, "sampleRate": rate, "encoding": "pcm-s16le",
            "data": base64.b64encode(pcm).decode()}


def send(connection, message):
    validate("ClientMessage", message)
    out = connection.handle(message, 0.0)
    for reply in out:
        validate("ServerMessage", reply)
    return out


@pytest.fixture
def conn():
    connection = Connection()
    send(connection, {"type": "session", "session": load_fixture("SessionState")})
    send(connection, transport())
    return connection


def test_fixture_is_a_valid_20ms_chunk_on_the_context_clock():
    fixture = load_fixture("SpeechAudio")
    validate("ClientMessage", fixture)
    decoded = decode_chunk(fixture, CONTEXT_RATE)
    assert len(decoded.samples) == 320 and decoded.end_frame - decoded.start_frame == 882  # 20 ms at both rates
    assert decoded.last_frame == fixture["endFrame"] - 1  # half-open range
    validate("ServerMessage", load_fixture("SpeechStatus"))


@pytest.mark.parametrize("rate", [8000, 16000, 22050, 44100, 48000])
def test_sample_count_must_cover_the_frame_range(rate):
    good = chunk(0, 1000, frames=4410, rate=rate)
    assert len(decode_chunk(good, CONTEXT_RATE).samples) == round(4410 * rate / CONTEXT_RATE)
    with pytest.raises(ChunkError, match="do not cover"):
        decode_chunk(chunk(0, 1000, frames=4410, rate=rate, samples=round(4410 * rate / CONTEXT_RATE) + 3), CONTEXT_RATE)


def test_empty_ranges_and_odd_bytes_are_rejected():
    empty = chunk(0, 1000)
    empty["endFrame"] = empty["startFrame"]
    with pytest.raises(ChunkError, match="greater"):
        decode_chunk(empty, CONTEXT_RATE)
    odd = chunk(0, 1000)
    odd["data"] = base64.b64encode(b"\x00\x01\x02").decode()
    with pytest.raises(ChunkError, match="whole 16-bit"):
        decode_chunk(odd, CONTEXT_RATE)


def test_contiguous_chunks_advance_received_frames_and_gaps_break_the_stream():
    tracker = StreamTracker()
    assert tracker.accept(decode_chunk(chunk(0, 0), CONTEXT_RATE)) is True
    assert tracker.accept(decode_chunk(chunk(1, 882), CONTEXT_RATE)) is False
    assert tracker.received_through("mic-1") == 1763
    with pytest.raises(ChunkError, match="gap at frame 1764"):
        tracker.accept(decode_chunk(chunk(2, 1800), CONTEXT_RATE))
    assert tracker.is_broken("mic-1") and tracker.received_through("mic-1") == 1763  # gap frames never count
    with pytest.raises(ChunkError, match="expected seq"):
        t = StreamTracker()
        t.accept(decode_chunk(chunk(0, 0), CONTEXT_RATE))
        t.accept(decode_chunk(chunk(5, 882), CONTEXT_RATE))
    with pytest.raises(ChunkError, match="clockId changed"):
        t = StreamTracker()
        t.accept(decode_chunk(chunk(0, 0), CONTEXT_RATE))
        t.accept(decode_chunk(chunk(1, 882, clock="other"), CONTEXT_RATE))


def test_without_a_recognizer_audio_gets_one_status_per_stream_and_never_a_watermark(conn):
    out = send(conn, chunk(0, 0))
    assert out == [{"type": "speech-status", "available": False, "provider": "none",
                    "reason": "no speech recognizer configured; speech-verified is not sent"}]
    replies = [m for seq in range(1, 50) for m in send(conn, chunk(seq, seq * 882))]
    assert replies == []
    assert send(conn, chunk(0, 0, stream="mic-2"))[0]["type"] == "speech-status"
    assert not any(m["type"] in ("speech-verified", "command-span", "command") for m in replies)


def test_a_broken_stream_reports_once_then_drops_audio(conn):
    send(conn, chunk(0, 0))
    out = send(conn, chunk(1, 5000))
    assert [m["type"] for m in out] == ["error"] and out[0]["requestId"] == "mic-1" and "gap" in out[0]["message"]
    assert send(conn, chunk(2, 5882)) == []


def test_audio_on_a_foreign_or_unknown_clock_is_rejected_once():
    connection = Connection()
    first = send(connection, chunk(0, 0))
    assert first[0]["type"] == "error" and "transport" in first[0]["message"]
    assert send(connection, chunk(1, 882)) == []
    send(connection, transport(clock="new-context"))
    out = send(connection, chunk(0, 0, stream="mic-2"))
    assert out[0]["type"] == "error" and "clockId" in out[0]["message"]
