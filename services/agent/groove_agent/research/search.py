"""Seeded, bounded evolutionary refinement of retrieved patches.

Score is cosine similarity between the render's embedding and the text
embedding. That score ranks candidates for audition; it is not a measure of
musical quality (PLAN.md milestone 4).
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass
from typing import Callable, Optional, Sequence

import numpy as np

from .audio import Embedder, Renderer, RenderRecipe, render_problem, unit
from .corpus import Cancel, Cancelled
from .space import ParameterSpace

MAX_VARIATIONS = 128  # per request, PLAN.md


@dataclass
class Scored:
    patch: dict
    score: float
    origin: str
    audio: Optional[np.ndarray] = None

    def key(self) -> str:
        return json.dumps(self.patch, sort_keys=True)


@dataclass
class SearchResult:
    best: list[Scored]  # best first, unique patches
    rendered: int
    rejected: int


def evolve(seeds: Sequence[Scored], space: ParameterSpace, renderer: Renderer, embedder: Embedder,
           text_embedding: np.ndarray, recipe: RenderRecipe, seed: int, budget: int = MAX_VARIATIONS,
           population: int = 16, elite: int = 6, keep: int = 5, cancelled: Cancel = lambda: False,
           progress: Callable[[int, int, list[Scored]], None] = lambda done, total, best: None) -> SearchResult:
    """Render at most `budget` variations of `seeds` and return the best `keep` patches found.

    Deterministic for a given seed, renderer and embedder. Silent or clipping
    renders are rejected and still count against the budget.
    """
    if not seeds:
        raise ValueError("search needs at least one seed patch")
    budget = max(0, min(int(budget), MAX_VARIATIONS))
    rng = random.Random(seed)
    query = unit(text_embedding)
    pool: dict[str, Scored] = {}
    for item in seeds:
        pool.setdefault(item.key(), item)

    def ranked() -> list[Scored]:
        return sorted(pool.values(), key=lambda s: (-s.score, s.key()))

    rendered = rejected = 0
    generation = 0
    while rendered < budget:
        generation += 1
        parents = ranked()[:elite]
        for _ in range(min(population, budget - rendered)):
            if cancelled():
                raise Cancelled()
            parent = parents[min(len(parents) - 1, int(rng.random() ** 2 * len(parents)))]  # favors the best
            child = space.mutate(parent.patch, rng)
            rendered += 1
            audio = renderer.render(child, recipe)
            if render_problem(audio) is not None:
                rejected += 1
                continue
            score = float(unit(embedder.embed_audio(audio, renderer.sample_rate)) @ query)
            candidate = Scored(child, score, f"evolved, seed {seed}, generation {generation}", audio)
            pool.setdefault(candidate.key(), candidate)
        progress(rendered, budget, ranked()[:keep])
    return SearchResult(ranked()[:keep], rendered, rejected)
