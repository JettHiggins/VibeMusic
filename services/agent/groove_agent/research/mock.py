"""MOCK renderer and embedder for tests and protocol wiring only.

`MockRenderer` is a toy additive synth, not SLOOP: its audio says nothing about
how a patch sounds on the real engine. `MockEmbedder` is not CLAP: its text
vectors are hash-derived and carry no meaning. Results built from these are
labeled "MOCK" in every candidate's provenance and must not be presented as
researched sounds.
"""
from __future__ import annotations

import hashlib

import numpy as np

from .audio import RenderRecipe
from .space import ParameterSpace

BANDS = 24


class MockRenderer:
    name = "MOCK toy renderer (not SLOOP)"

    def __init__(self, space: ParameterSpace, sample_rate: int = 22050) -> None:
        self._space = space
        self.engine_revision = space.engine_revision
        self.sample_rate = sample_rate

    def render(self, patch: dict, recipe: RenderRecipe) -> np.ndarray:
        bounds = self._space.tunable(patch["engine"])
        values = np.array([(patch["parameters"].get(str(b.index), b.lo) - b.lo) / (b.hi - b.lo) for b in bounds]) \
            if bounds else np.array([0.5])
        total = int(recipe.seconds * self.sample_rate)
        out = np.zeros(total)
        rolloff = 0.6 + 2.4 * float(values[: max(1, len(values) // 2)].mean())
        decay = 1.0 + 8.0 * float(values[len(values) // 2:].mean() if len(values) > 1 else 0.5)
        for start, duration, midi, velocity in recipe.notes:
            first = int(start * self.sample_rate)
            t = np.arange(min(total - first, int((duration + 0.3) * self.sample_rate))) / self.sample_rate
            if t.size == 0:
                continue
            frequency = 440.0 * 2 ** ((midi - 69 + patch["engine"] % 3 * 12 - 12) / 12)
            tone = np.zeros(t.size)
            for harmonic in range(1, 9):
                weight = values[(harmonic - 1) % len(values)] * 0.5 + 0.5
                tone += weight / harmonic ** rolloff * np.sin(2 * np.pi * frequency * harmonic * t)
            out[first:first + t.size] += velocity * tone * np.exp(-decay * t) * np.minimum(1.0, t / 0.005)
        return (0.5 * out / max(1e-9, float(np.abs(out).max()))).astype(np.float32)


class MockEmbedder:
    name = "MOCK band-energy/hash embedder (not CLAP)"

    def embed_audio(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        spectrum = np.abs(np.fft.rfft(audio.astype(np.float64)))
        edges = np.unique(np.geomspace(1, spectrum.size, BANDS + 1).astype(int))
        energy = np.array([spectrum[a:b].mean() if b > a else 0.0 for a, b in zip(edges[:-1], edges[1:])])
        vector = np.zeros(BANDS)
        vector[: energy.size] = np.log1p(energy)
        return vector - vector.mean()

    def embed_text(self, text: str) -> np.ndarray:
        digest = hashlib.sha256(" ".join(text.lower().split()).encode("utf-8")).digest()
        return np.random.default_rng(int.from_bytes(digest[:8], "big")).standard_normal(BANDS)
