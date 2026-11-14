"""Local speech-to-text with faster-whisper (team decision in docs/STATUS.md). No API, no key.

Optional: needs `requirements-speech.txt`. The model downloads on first use into the user's
Hugging Face cache, never into the repository. One loaded model is shared by every connection;
each connection's ThreadedSpeechWorker calls `transcribe` off the event loop, and a lock keeps
one decode at a time so concurrent connections cannot oversubscribe the CPU.

Decoding favours latency for short commands: English only, greedy (beam 1), no timestamps, no
conditioning on earlier text. A short initial prompt lists the command vocabulary so "Groove"
and lane names are spelled consistently. Whisper can invent text for non-speech, so the
interpreter, not this module, decides whether a transcript is a command.
"""
from __future__ import annotations

import os
import threading
from importlib.metadata import version
from math import gcd

import numpy as np

WHISPER_RATE = 16000
DEFAULT_MODEL = "base.en"  # measured baseline; see docs in services/agent/README.md
COMMAND_PROMPT = ("Groove, record kick. Groove, stop. Groove, stop playback. Snare, closed hats, synth one. "
                  "Tempo one forty. Undo. Clear. Mute drums.")


def to_whisper_rate(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Polyphase resampling to 16 kHz. Browser speech arrives at the approved 44.1 kHz, so this is
    the normal path; SciPy is declared in requirements-speech.txt for it."""
    audio = np.asarray(audio, dtype=np.float32)
    if sample_rate == WHISPER_RATE or audio.size == 0:
        return audio
    from scipy.signal import resample_poly
    divisor = gcd(WHISPER_RATE, sample_rate)
    return resample_poly(audio, WHISPER_RATE // divisor, sample_rate // divisor).astype(np.float32)


class FasterWhisperTranscriber:
    def __init__(self, model: str = "", device: str = "", compute_type: str = "", threads: int = 0) -> None:
        from faster_whisper import WhisperModel

        model = model or os.environ.get("GROOVE_STT_MODEL", DEFAULT_MODEL)
        device = device or os.environ.get("GROOVE_STT_DEVICE", "cpu")
        compute_type = compute_type or os.environ.get("GROOVE_STT_COMPUTE", "int8")
        threads = threads or int(os.environ.get("GROOVE_STT_THREADS", "4"))
        self._model = WhisperModel(model, device=device, compute_type=compute_type, cpu_threads=threads)
        self._lock = threading.Lock()
        self.name = (f"local faster-whisper {version('faster-whisper')} ({model}, {device}/{compute_type}, "
                     f"{threads} threads)")

    def transcribe(self, samples: np.ndarray, sample_rate: int) -> str:
        audio = np.asarray(samples, dtype=np.float32)
        if audio.size == 0:
            return ""
        audio = to_whisper_rate(audio, sample_rate)
        with self._lock:
            segments, _ = self._model.transcribe(
                audio, language="en", beam_size=1, condition_on_previous_text=False, without_timestamps=True,
                vad_filter=False, initial_prompt=COMMAND_PROMPT, temperature=0.0)
            return " ".join(segment.text.strip() for segment in segments).strip()


def transcriber_from_env():
    """GROOVE_STT=faster-whisper enables local recognition; unset means none (speech unavailable)."""
    mode = os.environ.get("GROOVE_STT", "").strip().lower()
    if not mode:
        return None
    if mode != "faster-whisper":
        raise RuntimeError(f"GROOVE_STT={mode!r} is not supported; use 'faster-whisper'")
    return FasterWhisperTranscriber()
