"""Speech-audio chunks (ClientMessage `speech-audio`): semantic checks and per-stream continuity.

The schema checks structure. This module checks what it cannot: a non-empty frame range,
whole 16-bit samples, a sample count that matches the frame range at the transport's
context rate, one clock per stream, and contiguous chunks. Frames are AudioContext frames
on the latency-corrected performance timeline, half-open [startFrame, endFrame).

Gaps are never filled in: frames that were not received cannot be classified, so a
`speech-verified` watermark may never pass them (docs/CONTRACTS.md). Audio is decoded
in memory only; nothing here stores raw microphone audio.
"""
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional

import numpy as np

SAMPLE_TOLERANCE = 1  # resampling chunk edges may round by one payload sample
MAX_CHUNK_SECONDS = 1.0  # both the payload duration and the context-frame span


class ChunkError(ValueError):
    pass


@dataclass(frozen=True)
class Chunk:
    stream_id: str
    seq: int
    clock_id: str
    start_frame: int
    end_frame: int  # exclusive
    sample_rate: int
    samples: np.ndarray  # int16

    @property
    def last_frame(self) -> int:
        return self.end_frame - 1


def expected_samples(start_frame: int, end_frame: int, payload_rate: int, context_rate: int) -> float:
    return (end_frame - start_frame) * payload_rate / context_rate


def decode_chunk(message: Mapping[str, Any], context_rate: int) -> Chunk:
    """Decode one schema-valid speech-audio message; raise ChunkError if its contents are inconsistent."""
    start, end = message["startFrame"], message["endFrame"]
    if end <= start:
        raise ChunkError("endFrame must be greater than startFrame")
    if end - start > MAX_CHUNK_SECONDS * context_rate:
        raise ChunkError(f"chunk spans {end - start} frames; at most {MAX_CHUNK_SECONDS:g} s ({context_rate} frames) allowed")
    try:
        raw = base64.b64decode(message["data"], validate=True)
    except (binascii.Error, ValueError) as error:
        raise ChunkError(f"data is not base64: {error}") from error
    if len(raw) % 2:
        raise ChunkError("pcm-s16le data must contain whole 16-bit samples")
    samples = np.frombuffer(raw, dtype="<i2")
    if len(samples) > MAX_CHUNK_SECONDS * message["sampleRate"]:
        raise ChunkError(f"chunk carries {len(samples)} samples; at most {MAX_CHUNK_SECONDS:g} s at {message['sampleRate']} Hz")
    expected = expected_samples(start, end, message["sampleRate"], context_rate)
    if abs(len(samples) - expected) > SAMPLE_TOLERANCE:
        raise ChunkError(f"{len(samples)} samples at {message['sampleRate']} Hz do not cover frames "
                         f"[{start}, {end}) at {context_rate} Hz (expected about {expected:.1f})")
    return Chunk(message["streamId"], message["seq"], message["clockId"], start, end,
                 message["sampleRate"], samples)


@dataclass
class _Stream:
    clock_id: str
    next_seq: int
    next_frame: int
    sample_rate: int = 0
    first_frame: int = 0
    broken: bool = False


@dataclass
class StreamTracker:
    """Continuity per stream. A stream that breaks (gap, reorder, clock change) stays broken."""
    streams: dict[str, _Stream] = field(default_factory=dict)
    max_streams: int = 16

    def accept(self, chunk: Chunk) -> bool:
        """True for a new stream's first chunk. Raises ChunkError (once) when continuity breaks."""
        stream = self.streams.get(chunk.stream_id)
        if stream is None:
            if chunk.seq != 0:
                self.mark_broken(chunk.stream_id)
                raise ChunkError(f"a stream must start at seq 0, got {chunk.seq}")
            self.streams[chunk.stream_id] = _Stream(chunk.clock_id, 1, chunk.end_frame, chunk.sample_rate,
                                                    chunk.start_frame)
            while len(self.streams) > self.max_streams:
                self.streams.pop(next(iter(self.streams)))
            return True
        problem = self._problem(stream, chunk)
        if problem:
            stream.broken = True
            raise ChunkError(problem)
        stream.next_seq, stream.next_frame = chunk.seq + 1, chunk.end_frame
        return False

    def mark_broken(self, stream_id: str) -> None:
        """Stop accepting a stream after any rejected chunk, so each stream reports one error."""
        stream = self.streams.setdefault(stream_id, _Stream("", 0, 0))
        stream.broken = True

    def is_broken(self, stream_id: str) -> bool:
        stream = self.streams.get(stream_id)
        return stream is not None and stream.broken

    def first_frame(self, stream_id: str) -> Optional[int]:
        """First frame of the stream: the fromFrame of any coverage it produces."""
        stream = self.streams.get(stream_id)
        return None if stream is None or stream.broken else stream.first_frame

    def received_through(self, stream_id: str) -> Optional[int]:
        """Last contiguously received frame (inclusive), the upper bound for any watermark."""
        stream = self.streams.get(stream_id)
        return None if stream is None else stream.next_frame - 1

    @staticmethod
    def _problem(stream: _Stream, chunk: Chunk) -> Optional[str]:
        if stream.broken:
            return "stream already broken; start a new streamId"
        if chunk.clock_id != stream.clock_id:
            return "clockId changed within a stream; a new audio context needs a new streamId"
        if chunk.sample_rate != stream.sample_rate:
            return f"sampleRate changed from {stream.sample_rate} to {chunk.sample_rate} within a stream"
        if chunk.seq != stream.next_seq:
            return f"expected seq {stream.next_seq}, got {chunk.seq}"
        if chunk.start_frame != stream.next_frame:
            kind = "gap" if chunk.start_frame > stream.next_frame else "overlap"
            return (f"{kind} at frame {stream.next_frame} (chunk starts at {chunk.start_frame}); "
                    "frames that are not received are never speech-verified")
        return None
