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

`Connection` hands each closed segment to a `SpeechWorker`, which transcribes it off the
event loop (`ThreadedSpeechWorker`). The transcript then goes through the normal utterance
path (recognized "Groove ..." speech gets its command-span, then a command or an error)
before speech-verified may pass it. A failed transcription stops that stream's coverage
and reports it unavailable; nothing is verified that was not actually classified.

EXPERIMENTAL: energy segmentation is a placeholder until a real VAD is chosen; it treats
sustained singing as a candidate segment. Tests use a SCRIPTED transcriber, which proves
timing and ordering only, never recognition.
"""
from __future__ import annotations

import queue
from collections import deque
import threading
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

import numpy as np

from .speech import Chunk


class Transcriber(Protocol):
    name: str

    def transcribe(self, samples: np.ndarray, sample_rate: int) -> str:
        """Text for one speech segment (float32 mono in -1..1). Empty when nothing was said."""


@dataclass(frozen=True)
class Word:
    text: str
    start: float  # seconds relative to the supplied audio, before resampling
    end: float


@dataclass(frozen=True)
class Transcript:
    text: str
    words: tuple[Word, ...] = ()


@dataclass(frozen=True)
class Segment:
    start_frame: int
    last_frame: int  # inclusive, like speech-verified throughFrame
    samples: np.ndarray  # exactly [start_frame, last_frame]: spans and alignment use this
    sample_rate: int
    # Quiet audio just outside the measured segment. Only the recognizer hears it: in noise the
    # raised threshold clips weak onsets/endings ("Play" was heard as "Light"/"Clear" without it).
    pre: np.ndarray = field(default_factory=lambda: np.zeros(0, np.float32))
    post: np.ndarray = field(default_factory=lambda: np.zeros(0, np.float32))
    # Closed by max_segment while speech was still going: the sentence continues in the next segment.
    cut: bool = False

    @property
    def recognition_samples(self) -> np.ndarray:
        if not len(self.pre) and not len(self.post):
            return self.samples
        return np.concatenate([self.pre, self.samples, self.post]).astype(np.float32)

    @property
    def lead_seconds(self) -> float:
        """Recognizer word times include this lead; subtract it to get times within `samples`."""
        return len(self.pre) / self.sample_rate


@dataclass
class EnergySegmenter:
    sample_rate: int  # payload rate
    window_s: float = 0.02
    threshold_dbfs: float = -40.0  # never call anything quieter than this loud
    # Noisy rooms: the noise floor is the quietest 20 ms window of the last `floor_s`; a window is
    # loud only `margin_db` above it. Speech has pauses, so it does not raise the floor; steady room
    # noise sets it at once (start) or within `floor_s` (noise that begins mid-take).
    floor_s: float = 1.5
    margin_db: float = 6.0
    # Steady noise that starts mid-take is loud until the floor catches up. Speech dips between
    # syllables and words; a loud run this long that stays within `stationary_db` is noise (or a
    # long held sung note) and is dropped without transcription.
    stationary_s: float = 1.0
    stationary_db: float = 6.0
    pad_s: float = 0.2  # recognition-only context before/after each segment
    # Only speech (a continuous run of min_speech_s) holds the hangover open; short bursts after
    # it (beatboxing straight after "Groove, clear") neither extend it nor join the span, except
    # a final consonant within `tail_s` of the last speech run ("sto-p").
    tail_s: float = 0.15
    min_speech_s: float = 0.15  # one continuous loud run this long makes a segment speech
    burst_gap_s: float = 0.10  # quiet that ends a candidate with only short bursts (beatboxed hits)
    hangover_s: float = 0.60  # keeps "Groove, <pause> stop" in one segment (measured pause ~0.5 s)
    max_segment_s: float = 4.0
    _samples: np.ndarray = field(default_factory=lambda: np.zeros(0, np.float32))
    _frames: np.ndarray = field(default_factory=lambda: np.zeros(0, np.int64))
    _received_through: int = -1
    _decided_through: int = -1
    _open: Optional[list] = None  # [current loud run, longest loud run, quiet windows since last loud]
    _history_s: list = field(default_factory=list)
    _history_f: list = field(default_factory=list)
    _history_loud: list = field(default_factory=list)
    _levels: deque = field(default_factory=deque)
    _quiet: deque = field(default_factory=deque)  # recent windows before a segment opens
    _pre: list = field(default_factory=list)

    @property
    def noise_floor_dbfs(self) -> float:
        return min(self._levels) if self._levels else -120.0

    @property
    def threshold(self) -> float:
        """Current loudness threshold in dBFS (fixed minimum, raised by the measured noise floor)."""
        return max(self.threshold_dbfs, self.noise_floor_dbfs + self.margin_db)

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
            level = 20 * np.log10(max(rms, 1e-10))
            self._levels.append(level)
            while len(self._levels) > max(1, round(self.floor_s / self.window_s)):
                self._levels.popleft()
            loud = level > self.threshold
            segment = self._step(win, win_frames, loud, level)
            if segment is not None:
                closed.append(segment)
        return closed

    def _step(self, win: np.ndarray, win_frames: np.ndarray, loud: bool, level: float = 0.0) -> Optional[Segment]:
        windows = lambda seconds: max(1, round(seconds / self.window_s))
        if self._open is None:
            if not loud:
                self._decided_through = int(win_frames[-1])
                self._quiet.append(win)
                while len(self._quiet) > windows(self.pad_s):
                    self._quiet.popleft()
                return None
            # [current loud run, longest run, quiet since last loud, run levels, loudest, last speech index]
            self._open = [0, 0, 0, [], -120.0, -1]
            self._history_s, self._history_f, self._history_loud = [], [], []
            self._pre, self._quiet = list(self._quiet), deque()
        self._history_s.append(win)
        self._history_f.append(win_frames)
        self._history_loud.append(loud)
        state = self._open
        if loud:
            state[0] += 1
            state[1] = max(state[1], state[0])
            state[2] = 0
            state[3].append(level)
            state[4] = max(state[4], level)
            here = len(self._history_s) - 1
            # Part of the speech: a long run, or a short bit within the tail of the last speech
            # (word endings after a dip). Later bursts are not speech and do not extend it.
            if state[0] >= windows(self.min_speech_s) or (state[5] >= 0 and here - state[5] <= windows(self.tail_s)):
                state[5] = here
        else:
            state[0] = 0
            state[2] += 1
            state[3] = []
        recent = state[3][-windows(self.stationary_s):]
        if state[0] >= windows(self.stationary_s) and max(recent) - min(recent) < self.stationary_db:
            self._open, self._history_s, self._history_f, self._history_loud = None, [], [], []
            self._decided_through = int(win_frames[-1])
            return None  # steady noise (or a long held note): never transcribed
        if state[2] and state[4] <= self.threshold:
            # The floor has risen since this candidate opened: nothing in it is loud any more,
            # so it was noise from before the floor adapted. Drop it now, not after the hangover.
            self._open, self._history_s, self._history_f, self._history_loud = None, [], [], []
            self._decided_through = int(win_frames[-1])
            return None
        speech = state[1] >= windows(self.min_speech_s)
        full = len(self._history_s) >= windows(self.max_segment_s)
        cut = False
        if speech:
            # The hangover runs from the last speech, not the last burst; close between bursts.
            since_speech = len(self._history_s) - 1 - state[5]
            # Close only in a real gap (burst_gap of quiet): a word onset like the "st" of "stop"
            # is followed by its vowel within ~40 ms, while beatboxed hits leave ~0.2 s gaps.
            still_speaking = loud or since_speech < windows(self.hangover_s) or state[2] < windows(self.burst_gap_s)
            if not full and still_speaking:
                return None
            cut = full and still_speaking
            keep = self._speech_end(state[5], windows(self.tail_s)) + 1
        else:
            # Short bursts close after a brief gap, so beatboxing never holds the watermark.
            if not full and state[2] < windows(self.burst_gap_s):
                return None
            keep = len(self._history_s) - state[2]
        # Windows after `keep` are decided as not speech: quiet, or drum hits after the command.
        samples = np.concatenate(self._history_s[:keep]) if keep else np.zeros(0, np.float32)
        frames = np.concatenate(self._history_f[:keep]) if keep else np.zeros(0, np.int64)
        trailing = self._history_s[keep:keep + windows(self.pad_s)]
        pre = np.concatenate(self._pre) if self._pre else np.zeros(0, np.float32)
        post = np.concatenate(trailing) if trailing else np.zeros(0, np.float32)
        self._quiet = deque(self._history_s[keep:][-windows(self.pad_s):])
        self._open, self._history_s, self._history_f, self._history_loud, self._pre = None, [], [], [], []
        self._decided_through = int(win_frames[-1])
        if not speech or not len(frames):
            return None  # only short bursts such as beatboxed hits: not speech
        return Segment(int(frames[0]), int(frames[-1]), samples, self.sample_rate, pre, post, cut)

    def _speech_end(self, last_speech: int, tail: int) -> int:
        """Last window of the command: its last speech run plus a final consonant that starts
        within `tail` windows of it (and the rest of that same burst)."""
        end, index = last_speech, last_speech + 1
        while index < len(self._history_loud):
            if self._history_loud[index] and (index - last_speech <= tail or index == end + 1):
                end = index
            elif index - last_speech > tail:
                break
            index += 1
        return end

    @property
    def decided_through(self) -> int:
        """Last context frame whose speech classification is final (-1 for none)."""
        if self._open is not None and self._history_f:
            return min(self._received_through, int(self._history_f[0][0]) - 1)
        return min(self._received_through, self._decided_through)


@dataclass(frozen=True)
class SpeechJob:
    job_id: str
    stream_id: str
    clock_id: str
    segment: Segment
    context_start_frame: Optional[int] = None  # actual first word; exclusion may include pre-roll
    research_epoch: int = 0  # newer UI research must defeat delayed recognition of old speech


Deliver = Callable[[SpeechJob, Optional[str | Transcript], Optional[str]], None]  # (job, text, error)


class SpeechWorker(Protocol):
    """Transcribes jobs off the event loop and reports each result exactly once, in submission order."""
    name: str

    def submit(self, job: SpeechJob) -> None: ...


class ThreadedSpeechWorker:
    """One background thread per connection running a Transcriber. `deliver` is called on that
    thread; the service hands results back to the event loop (call_soon_threadsafe)."""

    def __init__(self, transcriber: Transcriber, deliver: Deliver) -> None:
        self.name = transcriber.name
        self._transcriber = transcriber
        self._deliver = deliver
        self._jobs: "queue.Queue[Optional[SpeechJob]]" = queue.Queue()
        self._thread = threading.Thread(target=self._run, name="speech-worker", daemon=True)
        self._thread.start()

    def submit(self, job: SpeechJob) -> None:
        self._jobs.put(job)

    def close(self) -> None:
        self._jobs.put(None)

    def join(self, timeout: float = 30.0) -> None:
        self._thread.join(timeout)

    def _run(self) -> None:
        while True:
            job = self._jobs.get()
            if job is None:
                return
            try:
                transcribe = getattr(self._transcriber, "transcribe_timed", self._transcriber.transcribe)
                text = transcribe(job.segment.recognition_samples, job.segment.sample_rate)
                lead = job.segment.lead_seconds
                if lead and isinstance(text, Transcript):  # word times back onto the measured samples
                    text = Transcript(text.text, tuple(Word(w.text, w.start - lead, w.end - lead) for w in text.words))
            except Exception as error:  # a provider failure must hold coverage, never fake it
                self._deliver(job, None, f"{type(error).__name__}: {error}"[:300])
            else:
                self._deliver(job, text, None)
