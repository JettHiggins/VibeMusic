"""Seeded, bounded evolutionary refinement of retrieved patches.

Score is cosine similarity between the render's embedding and the text
embedding. That score ranks candidates for audition; it is not a measure of
musical quality (PLAN.md milestone 4).
"""
from __future__ import annotations

import json
import random
from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, Optional, Sequence

import numpy as np

if TYPE_CHECKING:
    from .retrieval import Ranking

from .audio import Embedder, Renderer, RenderRecipe, render_problem, unit
from .corpus import Cancel, Cancelled
from .space import ParameterSpace

MAX_VARIATIONS = 128  # per request, PLAN.md
# Playtest: show more candidates, and keep them audibly different (similar scores sounded alike).
CANDIDATES = 10
DIVERSITY = 0.5  # MMR weight: score minus DIVERSITY x similarity to an already chosen candidate


@dataclass
class Scored:
    patch: dict
    score: float
    origin: str
    audio: Optional[np.ndarray] = None
    embedding: Optional[np.ndarray] = None  # unit audio embedding, for diversity; not serialized

    def key(self) -> str:
        return json.dumps(self.patch, sort_keys=True)


def diverse(items: Sequence[Scored], k: int = CANDIDATES, weight: float = DIVERSITY) -> list[Scored]:
    """Up to k items by maximal marginal relevance: each pick maximizes score - weight x its highest
    cosine similarity to the picks so far. Items without an embedding are only ranked by score. The
    chosen set is returned best score first, so candidate 1 is still the closest match."""
    remaining = sorted(items, key=lambda s: (-s.score, s.key()))
    chosen: list[Scored] = []
    while remaining and len(chosen) < k:
        def value(item: Scored) -> float:
            if item.embedding is None or not chosen:
                return item.score
            similar = max((float(item.embedding @ c.embedding) for c in chosen if c.embedding is not None), default=0.0)
            return item.score - weight * similar
        best = max(remaining, key=lambda item: (value(item), -remaining.index(item)))
        chosen.append(best)
        remaining.remove(best)
    return sorted(chosen, key=lambda item: (-item.score, item.key()))  # shown best first


@dataclass
class SearchResult:
    best: list[Scored]  # best first, unique patches
    rendered: int
    rejected: int


def evolve(seeds: Sequence[Scored], space: ParameterSpace, renderer: Renderer, embedder: Embedder,
           text_embedding: np.ndarray, recipe: RenderRecipe, seed: int, budget: int = MAX_VARIATIONS,
           population: int = 16, elite: int = 6, keep: int = CANDIDATES, cancelled: Cancel = lambda: False,
           progress: Callable[[int, int, list[Scored]], None] = lambda done, total, best: None,
           ranking: Optional[Ranking] = None) -> SearchResult:
    """Render at most `budget` variations of `seeds` and return the best `keep` patches found.

    Deterministic for a given seed, renderer and embedder. Silent or clipping
    renders are rejected and still count against the budget. With `ranking`,
    children are scored like retrieval (retrieval.Ranking.score); seeds must
    then carry scores from the same ranking. Otherwise plain cosine is used.
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
            embedding = unit(embedder.embed_audio(audio, renderer.sample_rate))
            score = ranking.score(child, embedding) if ranking is not None else float(embedding @ query)
            candidate = Scored(child, score, f"evolved, seed {seed}, generation {generation}", audio, embedding)
            pool.setdefault(candidate.key(), candidate)
        progress(rendered, budget, diverse(ranked(), keep))
    return SearchResult(diverse(ranked(), keep), rendered, rejected)
