"""Cancellable research jobs that run off the event loop and stream `research` messages.

A job answers with retrieval results first, then streams refinement progress.
Nothing here touches audio timing: jobs run in worker threads and only emit
messages. Renders are serialized across jobs so one request cannot starve another.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional, Sequence

import numpy as np

from .audio import DEFAULT_RECIPE, Embedder, Renderer, RenderRecipe, render_problem, wav_bytes
from .corpus import Cancelled, Corpus, Entry
from .retrieval import RETRIEVAL_VERSION, Ranking, RetrievalIndex, TextCache

TEXT_CACHE = "text-embeddings.npz"  # beside the corpus; keyed by embedder identity
from .search import MAX_VARIATIONS, Scored, evolve
from .space import MetadataError, ParameterSpace

Emit = Callable[[dict], None]
NOT_CONFIGURED = ("sound research is not configured: it needs the offline SLOOP renderer from Workstream 1 "
                  "and an embedding model")
MAX_PREVIEWS = 200
RETRIEVAL_PROGRESS = 0.2


@dataclass
class ResearchBackend:
    space: ParameterSpace
    renderer: Renderer
    embedder: Embedder
    recipe: RenderRecipe = DEFAULT_RECIPE
    variations_per_preset: int = 0
    budget: int = MAX_VARIATIONS
    corpus_seed: int = 0
    corpus: Optional[Corpus] = None
    corpus_dir: Optional[Path] = None  # where a freshly built corpus is saved for the next start
    _index: Optional[RetrievalIndex] = field(default=None, repr=False)
    _index_corpus: Optional[Corpus] = field(default=None, repr=False)

    @property
    def label(self) -> str:
        return f"renderer: {self.renderer.name}; embedder: {self.embedder.name}; ranking: {RETRIEVAL_VERSION}"

    def ranking(self, description: str) -> Ranking:
        """Ranking for a description over the current corpus (which must be built)."""
        if self.corpus is None:
            raise RuntimeError("corpus is not built")
        if self._index is None or self._index_corpus is not self.corpus:
            names = {(int(p["engine"]), int(p["preset"])): label for label, p in self.space.preset_patches()}
            cache = TextCache(self.embedder, self.corpus_dir / TEXT_CACHE if self.corpus_dir is not None else None)
            self._index = RetrievalIndex(cache, [e.embedding for e in self.corpus.entries],
                                         [e.patch for e in self.corpus.entries], names)
            self._index_corpus = self.corpus
            cache.save()  # fixed index texts only; spoken descriptions stay in memory
        return self._index.ranking(description)

    def top(self, ranking: Ranking, k: int = 5) -> list[tuple[Entry, float]]:
        """Best k corpus entries for a ranking, best first; ties keep corpus order."""
        if self.corpus is None or not self.corpus.entries:
            return []
        scores = ranking.corpus_scores()
        order = np.argsort(-scores, kind="stable")[:k]
        return [(self.corpus.entries[i], float(scores[i])) for i in order]


@dataclass
class _Job:
    job_id: str
    cancel: threading.Event = field(default_factory=threading.Event)
    ids: dict = field(default_factory=dict)  # patch key -> candidate id, stable across progress messages
    last: list = field(default_factory=list)
    done: bool = False


class ResearchService:
    def __init__(self, backend: Optional[ResearchBackend] = None, preview_base: str = "http://127.0.0.1:8000") -> None:
        self.backend = backend
        self._preview_base = preview_base.rstrip("/")
        self._render_lock = threading.Lock()
        self._previews: "OrderedDict[str, bytes]" = OrderedDict()
        self._previews_lock = threading.Lock()

    def port(self, emit: Emit) -> "ResearchPort":
        return ResearchPort(self, emit)

    def preview(self, token: str) -> Optional[bytes]:
        with self._previews_lock:
            return self._previews.get(token)

    def _store_preview(self, job_id: str, candidate_id: str, item: Scored) -> str:
        if item.audio is None or self.backend is None:
            return ""
        token = hashlib.sha256(f"{job_id}\n{candidate_id}".encode("utf-8")).hexdigest()[:32]
        with self._previews_lock:
            if token not in self._previews:
                self._previews[token] = wav_bytes(item.audio, self.backend.renderer.sample_rate)
                while len(self._previews) > MAX_PREVIEWS:
                    self._previews.popitem(last=False)
        return f"{self._preview_base}/previews/{token}.wav"


class ResearchPort:
    """One connection's view of the service. Jobs die with the connection."""

    def __init__(self, service: ResearchService, emit: Emit) -> None:
        self._service = service
        self._emit = emit
        self._jobs: dict[str, _Job] = {}
        self._lock = threading.Lock()
        self._threads: list[threading.Thread] = []

    def start(self, job_id: str, description: str, seeds: Optional[Sequence[dict]] = None) -> None:
        with self._lock:
            if job_id in self._jobs:
                return  # same request delivered twice
            job = self._jobs[job_id] = _Job(job_id)
        thread = threading.Thread(target=self._run, args=(job, description, list(seeds or [])),
                                  name=f"research-{job_id}", daemon=True)
        self._threads.append(thread)
        thread.start()

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None or job.done:
            return False
        job.cancel.set()
        return True

    def close(self) -> None:
        with self._lock:
            jobs = list(self._jobs.values())
        for job in jobs:
            job.cancel.set()

    def join(self, timeout: float = 30.0) -> None:
        """Wait for workers; used by tests."""
        for thread in self._threads:
            thread.join(timeout)

    # -- worker ------------------------------------------------------------------

    def _message(self, job: _Job, status: str, progress: float, best: Sequence[Scored], error: Optional[str] = None) -> None:
        backend = self._service.backend
        candidates = []
        for item in best:
            candidate_id = job.ids.setdefault(item.key(), f"{job.job_id}:{len(job.ids) + 1}")
            candidates.append({"id": candidate_id, "patch": item.patch,
                               "provenance": f"{item.origin}; {backend.label}" if backend else item.origin,
                               "previewUrl": self._service._store_preview(job.job_id, candidate_id, item),
                               "score": item.score})
        job.last = list(best)
        message = {"type": "research", "jobId": job.job_id, "status": status,
                   "progress": min(1.0, max(0.0, progress)), "candidates": candidates}
        if error:
            message["error"] = error
        if status != "running":
            job.done = True
        self._emit(message)

    def _run(self, job: _Job, description: str, seeds: list[dict]) -> None:
        backend = self._service.backend
        if backend is None:
            self._message(job, "failed", 0.0, [], NOT_CONFIGURED)
            return
        try:
            self._message(job, "running", 0.0, [])
            with self._service._render_lock:
                if job.cancel.is_set():
                    raise Cancelled()
                if backend.corpus is None:
                    backend.corpus = Corpus.build(backend.space, backend.renderer, backend.embedder, backend.recipe,
                                                  seed=backend.corpus_seed,
                                                  variations_per_preset=backend.variations_per_preset,
                                                  cancelled=job.cancel.is_set)
                    if backend.corpus_dir is not None:
                        backend.corpus.save(backend.corpus_dir)
                ranking = backend.ranking(description)
                # Refinement starts from the candidates being refined, rescored for the new text.
                # A fresh search, or a refinement whose seeds are all unusable, starts from retrieval.
                carried: dict[str, Scored] = {}
                for patch in seeds:
                    if backend.space.problem(patch) is not None:
                        continue
                    audio = backend.renderer.render(patch, backend.recipe)
                    if render_problem(audio) is None:
                        score = ranking.score(patch, backend.embedder.embed_audio(audio, backend.renderer.sample_rate))
                        item = Scored(patch, score, "carried over from the previous search", audio)
                        carried.setdefault(item.key(), item)
                pool = list(carried.values())
                if not pool:
                    for entry, score in backend.top(ranking, 5):
                        if job.cancel.is_set():
                            raise Cancelled()
                        # Disk corpora keep embeddings/patches, not float audio in RAM.
                        # Re-render selected hits so cached candidates still have real previews.
                        audio = entry.audio if entry.audio is not None else backend.renderer.render(entry.patch, backend.recipe)
                        if render_problem(audio) is None:
                            pool.append(Scored(entry.patch, score, f"retrieved: {entry.label}", audio))
                if not pool:
                    self._message(job, "failed", 0.0, [], "no usable patches: every render was silent or clipping")
                    return
                pool.sort(key=lambda s: (-s.score, s.key()))
                self._message(job, "running", RETRIEVAL_PROGRESS, pool[:5])
                seed = int.from_bytes(hashlib.sha256(description.encode("utf-8")).digest()[:4], "big")
                result = evolve(pool, backend.space, backend.renderer, backend.embedder, ranking.query, backend.recipe,
                                seed=seed, budget=backend.budget, cancelled=job.cancel.is_set,
                                progress=lambda done, total, best: self._message(
                                    job, "running", RETRIEVAL_PROGRESS + (1 - RETRIEVAL_PROGRESS) * done / max(1, total) * 0.99,
                                    best), ranking=ranking)
            self._message(job, "complete", 1.0, result.best)
        except Cancelled:
            self._message(job, "cancelled", 0.0, job.last)
        except Exception as error:  # a failed job must never take the service down
            self._message(job, "failed", 0.0, [], f"{type(error).__name__}: {error}"[:300])


def backend_from_env(root: Path) -> Optional[ResearchBackend]:
    """Research backend chosen by GROOVE_RESEARCH. Unset means none; nothing mock is used silently.

    `mock` wires the toy renderer and hash embedder over real engine metadata so
    the protocol can be exercised end to end. Candidates are then valid bounded
    patches for the real engine, but their ranking is meaningless.
    """
    mode = os.environ.get("GROOVE_RESEARCH", "").strip().lower()
    if not mode:
        return None
    if mode not in ("mock", "sloop"):
        raise RuntimeError(f"GROOVE_RESEARCH={mode!r} is not supported; use 'sloop' or 'mock'")
    from .mock import MockEmbedder, MockRenderer
    engine_dir = Path(os.environ.get("GROOVE_ENGINE_DIR", root / "apps" / "web" / "public" / "engine"))
    path = Path(os.environ.get("GROOVE_ENGINE_METADATA", engine_dir / "metadata.json"))
    if not path.exists():
        raise RuntimeError(f"engine metadata not found at {path}; build it with scripts/build-engine.py")
    revision = os.environ.get("GROOVE_ENGINE_REVISION", "bac9c05ea7627449405aa10e48da21d75b6c8c56")
    try:
        space = ParameterSpace(json.loads(path.read_text(encoding="utf-8")), revision)
    except (ValueError, MetadataError) as error:
        raise RuntimeError(f"engine metadata at {path} is unusable: {error}") from error
    if mode == "mock":
        return ResearchBackend(space, MockRenderer(space), MockEmbedder())
    from .sloop import SloopRenderer
    if not (engine_dir / "voicesynth.wasm").exists():
        raise RuntimeError(f"engine WASM not found in {engine_dir}; build it with scripts/build-engine.py")
    renderer = SloopRenderer.from_directory(engine_dir, revision)
    embedder_name = os.environ.get("GROOVE_EMBEDDER", "").strip().lower()
    if embedder_name == "clap":
        from .clap import ClapEmbedder
        embedder: Embedder = ClapEmbedder()
    elif embedder_name == "mock":
        embedder = MockEmbedder()
    else:
        raise RuntimeError("GROOVE_RESEARCH=sloop needs GROOVE_EMBEDDER=clap (or 'mock' for wiring tests)")
    corpus_dir = Path(os.environ.get("GROOVE_CORPUS_DIR", root / "artifacts" / "corpus" / embedder_name))
    backend = ResearchBackend(space, renderer, embedder)
    if (corpus_dir / "corpus.json").exists():
        corpus = Corpus.load(corpus_dir)
        if (corpus.engine_revision, corpus.renderer, corpus.embedder, corpus.recipe) == (
                revision, renderer.name, embedder.name, backend.recipe):
            backend.corpus = corpus  # otherwise it is stale and gets rebuilt on the first request
    backend.corpus_dir = corpus_dir
    return backend
