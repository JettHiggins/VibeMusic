"""Render checks and preview encoding. Mono float audio in -1..1."""
from __future__ import annotations

import io
import wave
from dataclasses import dataclass
from typing import Optional, Protocol

import numpy as np

SILENT_PEAK = 1e-3
CLIP_LEVEL = 0.999
CLIP_FRACTION = 1e-3


@dataclass(frozen=True)
class RenderRecipe:
    """Fixed notes used for every render so patches are compared on the same phrase."""
    name: str
    seconds: float
    notes: tuple[tuple[float, float, int, float], ...]  # (start s, duration s, MIDI, velocity 0-1)

    def to_json(self) -> dict:
        return {"name": self.name, "seconds": self.seconds, "notes": [list(n) for n in self.notes]}


DEFAULT_RECIPE = RenderRecipe("c-major-phrase-v1", 3.0, (
    (0.0, 0.4, 60, 0.8), (0.5, 0.4, 64, 0.8), (1.0, 0.4, 67, 0.8), (1.5, 1.0, 72, 0.9),
))


class Renderer(Protocol):
    """Offline render of one patch. The real implementation must run the pinned SLOOP engine."""
    name: str
    engine_revision: str
    sample_rate: int

    def render(self, patch: dict, recipe: RenderRecipe) -> np.ndarray: ...


class Embedder(Protocol):
    """Joint audio/text embedding (LAION CLAP music checkpoint in the real system)."""
    name: str

    def embed_audio(self, audio: np.ndarray, sample_rate: int) -> np.ndarray: ...

    def embed_text(self, text: str) -> np.ndarray: ...


def render_problem(audio: np.ndarray) -> Optional[str]:
    """Reason to reject a render (empty, non-finite, silent, clipping), or None."""
    if audio.ndim != 1 or audio.size == 0:
        return "empty render"
    if not np.all(np.isfinite(audio)):
        return "non-finite samples"
    magnitude = np.abs(audio)
    if float(magnitude.max()) < SILENT_PEAK:
        return "silent"
    if float(np.mean(magnitude >= CLIP_LEVEL)) > CLIP_FRACTION:
        return "clipping"
    return None


def wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(pcm.tobytes())
    return buffer.getvalue()


def unit(vector: np.ndarray) -> np.ndarray:
    vector = np.asarray(vector, dtype=np.float64).ravel()
    norm = float(np.linalg.norm(vector))
    if norm == 0.0 or not np.isfinite(norm):
        raise ValueError("embedding has no direction")
    return vector / norm
