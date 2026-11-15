"""Patch corpus: presets and seeded bounded variations, rendered and embedded once.

Each entry keeps the complete patch, the render recipe, the engine revision,
the audio and the embedding. Saved corpora go under the git-ignored `artifacts/`
directory; share them as files, never commit them.
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from .audio import Embedder, Renderer, RenderRecipe, render_problem, unit, wav_bytes
from .space import ParameterSpace

Cancel = Callable[[], bool]
Progress = Callable[[int, int], None]


class Cancelled(Exception):
    pass


@dataclass
class Entry:
    id: str
    label: str
    patch: dict
    embedding: np.ndarray  # unit length
    audio: Optional[np.ndarray] = None


@dataclass
class Corpus:
    entries: list[Entry]
    engine_revision: str
    recipe: RenderRecipe
    renderer: str
    embedder: str
    sample_rate: int
    seed: int
    rejected: int = 0

    @classmethod
    def build(cls, space: ParameterSpace, renderer: Renderer, embedder: Embedder, recipe: RenderRecipe,
              seed: int = 0, variations_per_preset: int = 0, cancelled: Cancel = lambda: False,
              progress: Progress = lambda done, total: None) -> "Corpus":
        if renderer.engine_revision != space.engine_revision:
            raise ValueError("renderer and parameter space are for different engine revisions")
        rng = random.Random(seed)
        plan: list[tuple[str, str, dict]] = []
        for number, (label, patch) in enumerate(space.preset_patches()):
            plan.append((f"preset-{number}", label, patch))
            for variation in range(variations_per_preset):
                plan.append((f"preset-{number}-v{variation}", f"{label} variation {variation} (seed {seed})",
                             space.mutate(patch, rng)))
        corpus = cls([], space.engine_revision, recipe, renderer.name, embedder.name, renderer.sample_rate, seed)
        for done, (entry_id, label, patch) in enumerate(plan):
            if cancelled():
                raise Cancelled()
            audio = renderer.render(patch, recipe)
            if render_problem(audio) is None:
                corpus.entries.append(Entry(entry_id, label, patch,
                                            unit(embedder.embed_audio(audio, renderer.sample_rate)), audio))
            else:
                corpus.rejected += 1
            progress(done + 1, len(plan))
        return corpus

    def top(self, text_embedding: np.ndarray, k: int = 5) -> list[tuple[Entry, float]]:
        """The k entries most similar to a text embedding, best first (cosine similarity)."""
        if not self.entries:
            return []
        query = unit(text_embedding)
        scores = np.stack([entry.embedding for entry in self.entries]) @ query
        order = np.argsort(-scores, kind="stable")[:k]
        return [(self.entries[i], float(scores[i])) for i in order]

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "audio").mkdir(exist_ok=True)
        np.save(directory / "embeddings.npy", np.stack([e.embedding for e in self.entries]))
        for entry in self.entries:
            if entry.audio is not None:
                (directory / "audio" / f"{entry.id}.wav").write_bytes(wav_bytes(entry.audio, self.sample_rate))
        manifest = {"engineRevision": self.engine_revision, "recipe": self.recipe.to_json(),
                    "renderer": self.renderer, "embedder": self.embedder, "sampleRate": self.sample_rate,
                    "seed": self.seed, "rejected": self.rejected,
                    "entries": [{"id": e.id, "label": e.label, "patch": e.patch} for e in self.entries]}
        (directory / "corpus.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")

    @classmethod
    def load(cls, directory: Path) -> "Corpus":
        manifest = json.loads((directory / "corpus.json").read_text(encoding="utf-8"))
        embeddings = np.load(directory / "embeddings.npy")
        if len(embeddings) != len(manifest["entries"]):
            raise ValueError("corpus embeddings and manifest disagree")
        recipe = RenderRecipe(manifest["recipe"]["name"], manifest["recipe"]["seconds"],
                              tuple(tuple(note) for note in manifest["recipe"]["notes"]))
        entries = [Entry(item["id"], item["label"], item["patch"], embeddings[i])
                   for i, item in enumerate(manifest["entries"])]
        return cls(entries, manifest["engineRevision"], recipe, manifest["renderer"], manifest["embedder"],
                   manifest["sampleRate"], manifest["seed"], manifest["rejected"])
