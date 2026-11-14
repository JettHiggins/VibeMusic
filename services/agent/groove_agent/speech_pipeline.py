"""Provider-independent speech pipeline: segment streamed audio, transcribe, and bound the watermark.

A `Transcriber` (the STT provider seam: local faster-whisper or a cloud API, pending the
team decision) turns one segment's samples into text. Everything else is here and does not
depend on the provider:

* Energy segmentation in 20 ms windows on the payload audio, mapped back to AudioContext
  frames per chunk. Short bursts (beatboxed hits) are not speech; a segment closes after
  `hangover` of quiet or at `max_segment`.
* `decided_through`: the last context frame whose classification is final. Quiet before a
  segment is final at once; an open segment, or quiet inside its hangover, holds the
  watermark just before the segment's first frame. It never passes received audio.

`Connection` sends a closed segment's transcript through the normal utterance path
(so recording-time "Groove ..." commands produce command-span then command) and only
then advances speech-verified. Transcription runs synchronously in this version; a real
provider must not block the event loop (run it in a worker, keeping the same ordering).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Protocol

import numpy as np

from .speech import Chunk


class Transcriber(Protocol):
    name: str

    def transcribe(self, samples: np.ndarray, sample_rate: int) -> str:
        """Text for one speech segment (float32 mono in -1..1). Empty when nothing was said."""


@dataclass(frozen=True)
class Segment:
    start_frame: int
    last_frame: int  # inclusive, like speech-verified throughFrame
    samples: np.ndarray
    sample_rate: int


@dataclass
class EnergySegmenter:
    sample_rate: int  # payload rate
    window_s: float = 0.02
    threshold_dbfs: float = -40.0
    min_speech_s: float = 0.15
    hangover_s: float = 0.30
    max_segment_s: float = 4.0
    _samples: np.ndarray = field(default_factory=lambda: np.zeros(0, np.float32))
    _frames: np.ndarray = field(default_factory=lambda: np.zeros(0, np.int64))
    _received_through: int = -1
    _decided_through: int = -1
    _open: Optional[list] = None  # [start index into history, loud windows, quiet windows since last loud]
    _history_s: list = field(default_factory=list)
    _history_f: list = field(default_factory=list)

    @property
    def window(self) -> int:
        return max(1, round(self.window_s * self.sample_rate))

    def feed(self, chunk: Chunk) -> list[Segment]:
        """Add one contiguous chunk; return segments that closed."""
        if chunk.sample_rate != self.sample_rate:
            raise ValueError("payload sample rate changed within a stream")
        samples = chunk.samples.astype(np.float32) / 32768.0
        n = len(samples)
        span = chunk.end_frame - chunk.start_frame
        frames = chunk.start_frame + (np.arange(n, dtype=np.int64) * span) // max(1, n)
        self._samples = np.concatenate([self._samples, samples])
        self._frames = np.concatenate([self._frames, frames])
        self._received_through = chunk.last_frame
        closed: list[Segment] = []
        w = self.window
        while len(self._samples) >= w:
            win, win_frames = self._samples[:w], self._frames[:w]
            self._samples, self._frames = self._samples[w:], self._frames[w:]
            rms = float(np.sqrt(np.mean(win.astype(np.float64) ** 2)))
            loud = 20 * np.log10(max(rms, 1e-10)) > self.threshold_dbfs
            segment = self._step(win, win_frames, loud)
            if segment is not None:
                closed.append(segment)
        return closed

    def _step(self, win: np.ndarray, win_frames: np.ndarray, loud: bool) -> Optional[Segment]:
        windows = lambda seconds: max(1, round(seconds / self.window_s))
        if self._open is None:
            if not loud:
                self._decided_through = int(win_frames[-1])
                return None
            self._open = [0, 0, 0]
            self._history_s, self._history_f = [], []
        self._history_s.append(win)
        self._history_f.append(win_frames)
        state = self._open
        if loud:
            state[1] += 1
            state[2] = 0
        else:
            state[2] += 1
        if state[2] < windows(self.hangover_s) and len(self._history_s) < windows(self.max_segment_s):
            return None
        # Close: drop trailing quiet windows from the segment; they are decided as quiet.
        keep = len(self._history_s) - state[2]
        loud_windows = state[1]
        samples = np.concatenate(self._history_s[:keep]) if keep else np.zeros(0, np.float32)
        frames = np.concatenate(self._history_f[:keep]) if keep else np.zeros(0, np.int64)
        self._open, self._history_s, self._history_f = None, [], []
        self._decided_through = int(win_frames[-1])
        if loud_windows < windows(self.min_speech_s) or not len(frames):
            return None  # a short burst such as a beatboxed hit: not speech
        return Segment(int(frames[0]), int(frames[-1]), samples, self.sample_rate)

    @property
    def decided_through(self) -> int:
        """Last context frame whose speech classification is final (-1 for none)."""
        if self._open is not None and self._history_f:
            return min(self._received_through, int(self._history_f[0][0]) - 1)
        return min(self._received_through, self._decided_through)
