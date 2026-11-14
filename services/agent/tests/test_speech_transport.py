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
    assert out == [{"type": "speech-status", "streamId": "mic-1", "available": False, "provider": "none",
                    "reason": "no speech recognizer configured; speech-verified is not sent; hold speech-dependent commits"}]
    replies = [m for seq in range(1, 50) for m in send(conn, chunk(seq, seq * 882))]
    assert replies == []
    second = send(conn, chunk(0, 0, stream="mic-2"))
    assert second[0]["type"] == "speech-status" and second[0]["streamId"] == "mic-2"
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



def test_ws1_repro_six_seconds_at_8khz_in_one_chunk_is_rejected():
    long = chunk(0, 0, frames=6 * CONTEXT_RATE, rate=8000)  # 48,000 samples: fits the base64 limit
    validate("ClientMessage", long)
    with pytest.raises(ChunkError, match="at most 1 s"):
        decode_chunk(long, CONTEXT_RATE)
    one_second = chunk(0, 0, frames=CONTEXT_RATE, rate=48000)
    assert len(decode_chunk(one_second, CONTEXT_RATE).samples) == 48000  # exactly one second is allowed


def test_context_span_over_one_second_is_rejected_even_with_few_samples():
    sparse = chunk(0, 0, frames=CONTEXT_RATE + 1, rate=8000)
    with pytest.raises(ChunkError, match="frames"):
        decode_chunk(sparse, CONTEXT_RATE)


def test_ws1_repro_rate_change_within_a_stream_breaks_it():
    tracker = StreamTracker()
    tracker.accept(decode_chunk(chunk(0, 0, rate=16000), CONTEXT_RATE))
    with pytest.raises(ChunkError, match="sampleRate changed from 16000 to 8000"):
        tracker.accept(decode_chunk(chunk(1, 882, rate=8000), CONTEXT_RATE))
    assert tracker.is_broken("mic-1") and tracker.first_frame("mic-1") is None


def test_a_stream_must_start_at_seq_zero(conn):
    tracker = StreamTracker()
    with pytest.raises(ChunkError, match="seq 0"):
        tracker.accept(decode_chunk(chunk(3, 0), CONTEXT_RATE))
    out = send(conn, chunk(3, 0, stream="late-start"))
    assert [m["type"] for m in out] == ["error"] and "seq 0" in out[0]["message"]
    assert send(conn, chunk(4, 882, stream="late-start")) == []  # one error per bad stream


def test_first_frame_marks_where_a_stream_coverage_can_begin():
    tracker = StreamTracker()
    tracker.accept(decode_chunk(chunk(0, 5000), CONTEXT_RATE))
    tracker.accept(decode_chunk(chunk(1, 5882), CONTEXT_RATE))
    assert tracker.first_frame("mic-1") == 5000 and tracker.received_through("mic-1") == 6763


def test_speech_verified_fixture_is_scoped_to_one_stream():
    fixture = load_fixture("SpeechVerified")
    validate("ServerMessage", fixture)
    assert fixture["fromFrame"] <= fixture["throughFrame"] and fixture["streamId"]
    validate("ServerMessage", {"type": "speech-verified", "clockId": "c", "throughFrame": 10})  # older producers
