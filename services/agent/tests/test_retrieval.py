"""Ranking and benchmark logic with a tiny keyword embedder: no model, no download."""
import json
import random
from pathlib import Path

import numpy as np
import pytest

from groove_agent.research import benchmark
from groove_agent.research.retrieval import (NAME_WEIGHT, TEMPLATES, VOCABULARY, RetrievalIndex, spoken_name,
                                             text_query)
from groove_agent.research.search import Scored, evolve

AXES = ("piano", "drum", "organ", "bell")


class KeywordEmbedder:
    """Text vector counts instrument words; each template adds a distinct small component."""
    name = "keyword test embedder"

    def __init__(self):
        self.calls = 0

    def embed_text(self, text):
        self.calls += 1
        rng = np.random.default_rng(abs(hash(text)) % 2**32)
        vector = np.array([text.count(word) for word in AXES] + [0.0] * 4, dtype=float)
        vector[4:] = 0.05 * rng.standard_normal(4)
        return vector + np.array([0, 0, 0, 0, 0, 0, 0, 0.2])

    def embed_audio(self, audio, sample_rate):
        return np.asarray(audio, dtype=float)


def audio(*weights):
    return np.array(list(weights) + [0.0] * (8 - len(weights)))


def index(entries, names, weight=NAME_WEIGHT):
    embeddings = [a for _, a in entries]
    patches = [p for p, _ in entries]
    return RetrievalIndex(KeywordEmbedder(), embeddings, patches, names, weight)


def patch(engine, preset):
    return {"engine": engine, "preset": preset, "parameters": {}, "engineRevision": "r"}


def test_factory_names_are_spelled_out_without_the_engine_family():
    assert spoken_name("FM6 / TINE EP") == "tine electric piano"
    assert spoken_name("DIGITAL / WURLI") == "wurlitzer electric piano"
    assert spoken_name("SAMPLE / GRAND PNO") == "grand piano"
    assert spoken_name("PHYS / TIMPANI") == "timpani"


def test_description_is_averaged_over_every_template():
    embedder = KeywordEmbedder()
    query = text_query(embedder, "piano")
    assert embedder.calls == len(TEMPLATES) and np.isclose(np.linalg.norm(query), 1.0)
    assert int(np.argmax(query[:4])) == 0


def test_hub_correction_demotes_a_render_close_to_every_word():
    names = {(0, i): f"X / N{i}" for i in range(4)}
    hub_like = audio(0.9, 0, 0, 0, 0, 0, 0, 0.8)  # leans on the component every word shares
    piano = audio(1, 0, 0, 0, 0, 0, 0.9, 0.2)     # specific: piano plus something no word describes
    entries = [(patch(0, 0), hub_like), (patch(0, 1), piano),
               (patch(0, 2), audio(0, 0, 1, 0, 0, 0, 0, 0.2)), (patch(0, 3), audio(0, 0, 0, 1, 0, 0, 0, 0.2))]
    idx = index(entries, names, weight=0.0)
    ranking = idx.ranking("piano")
    raw = idx.audio @ ranking.query
    scores = ranking.corpus_scores()
    assert idx.hub[0] > idx.hub[1]
    assert raw[0] > raw[1]        # plain cosine prefers the hub
    assert scores[1] > scores[0]  # hub correction prefers the specific piano render


def test_name_prior_breaks_a_family_mismatch_and_variations_inherit_it():
    names = {(0, 0): "PHYS / DRUM", (1, 0): "DIGITAL / PIANO", (2, 0): "X / ORGAN", (3, 0): "X / BELL"}
    drum_like = audio(0.9, 0.5, 0, 0, 0, 0, 0, 0.3)  # sounds slightly more like the query
    piano = audio(0.85, 0.5, 0, 0, 0, 0, 0, 0.3)
    entries = [(patch(0, 0), drum_like), (patch(1, 0), piano),
               (patch(2, 0), audio(0, 0, 1, 0, 0, 0, 0, 0.3)), (patch(3, 0), audio(0, 0, 0, 1, 0, 0, 0, 0.3))]
    without = index(entries, names, weight=0.0)
    with_names = index(entries, names)
    assert int(np.argmax(without.ranking("piano").corpus_scores())) == 0
    ranking = with_names.ranking("piano")
    assert int(np.argmax(ranking.corpus_scores())) == 1
    variation = dict(patch(1, 0), parameters={"3": 7})
    assert ranking.name_prior(variation) == ranking.name_prior(patch(1, 0)) > 0
    assert ranking.name_prior(patch(9, 9)) == 0.0  # unknown preset: neutral, audio decides


def test_corpus_scores_equal_scores_for_the_same_render():
    names = {(0, i): f"X / {w.upper()}" for i, w in enumerate(AXES)}
    entries = [(patch(0, i), audio(*np.eye(4)[i], 0, 0, 0, 0.3)) for i in range(4)]
    ranking = index(entries, names).ranking("organ")
    assert np.allclose(ranking.corpus_scores(), [ranking.score(p, a) for p, a in entries])
    assert int(np.argmax(ranking.corpus_scores())) == 2


def test_evolve_scores_children_with_the_ranking():
    class Space:
        def mutate(self, parent, rng):
            return dict(parent, parameters={"n": rng.random()})

    class Renderer:
        sample_rate = 8000

        def render(self, child, recipe):
            return audio(0.5, 0.1 + child["parameters"]["n"], 0, 0, 0, 0, 0, 0.3) * 0.5

    names = {(0, 0): "X / PIANO"}
    idx = index([(patch(0, 0), audio(1, 0, 0, 0, 0, 0, 0, 0.3))], names)
    ranking = idx.ranking("piano")
    seed = Scored(patch(0, 0), ranking.corpus_scores()[0], "seed", None)
    seen = []
    original = ranking.score
    ranking.score = lambda p, a, hub=None: seen.append(p) or original(p, a, hub)
    result = evolve([seed], Space(), Renderer(), idx.embedder, ranking.query, None, seed=1, budget=8, ranking=ranking)
    assert result.rendered == 8 and len(seen) == 8
    assert result.best[0].score == max(s.score for s in result.best)


def test_benchmark_metrics():
    labels = ["A / DRUM", "B / PIANO", "C / EP", "D / ORGAN"]
    relevance = {"electric piano": ("C / EP",), "organ": ("D / ORGAN",)}
    table = {"electric piano": [0.9, 0.5, 0.8, 0.1], "organ": [0.1, 0.2, 0.3, 0.9]}
    results = benchmark.evaluate(labels, lambda p: table[p], relevance)
    assert [(r.first_relevant_rank, r.top, r.top_relevant) for r in results] == [(2, "A / DRUM", False), (1, "D / ORGAN", True)]
    s = benchmark.summary(results)
    assert s["top1"] == 0.5 and s["hit5"] == 1.0 and s["mrr"] == pytest.approx(0.75)
    assert "| electric piano | 2 | A / DRUM (miss) |" in benchmark.markdown({"x": results})
    with pytest.raises(ValueError, match="not in corpus"):
        benchmark.evaluate(labels, lambda p: table[p], {"x": ("Z / NONE",)})


def test_benchmark_prompts_are_disjoint_and_name_real_factory_presets():
    assert not set(benchmark.TUNING) & set(benchmark.HELD_OUT)
    assert not set(VOCABULARY) & (set(benchmark.TUNING) | set(benchmark.HELD_OUT))
    metadata = Path(__file__).resolve().parents[3] / "apps" / "web" / "public" / "engine" / "metadata.json"
    if not metadata.exists():
        pytest.skip("engine metadata not built")
    data = json.loads(metadata.read_text(encoding="utf-8"))
    engines = data["engines"] if isinstance(data, dict) else data
    labels = {f"{e['name']} / {p['name']}" for e in engines for p in e["presets"]}
    wanted = {name for rel in (benchmark.TUNING, benchmark.HELD_OUT) for names in rel.values() for name in names}
    assert wanted <= labels, sorted(wanted - labels)


def test_text_cache_persists_fixed_texts_and_ignores_another_embedder(tmp_path):
    from groove_agent.research.retrieval import TextCache
    path = tmp_path / "text-embeddings.npz"
    first = KeywordEmbedder()
    cache = TextCache(first, path)
    vectors = cache.embed_texts(["piano", "organ", "piano"])
    assert first.calls == 2 and np.allclose(vectors[0], vectors[2])
    cache.save()
    reloaded_embedder = KeywordEmbedder()
    reloaded = TextCache(reloaded_embedder, path)
    assert np.allclose(reloaded.embed_text("organ"), vectors[1]) and reloaded_embedder.calls == 0
    other = KeywordEmbedder()
    other.name = "a different model"
    TextCache(other, path).embed_text("organ")
    assert other.calls == 1  # identity mismatch: cached vectors are not reused


def test_backend_ranking_reuses_the_saved_index_texts(tmp_path):
    from research_fixtures import backend
    from groove_agent.research.corpus import Corpus
    from groove_agent.research.service import TEXT_CACHE
    b = backend(budget=0)
    b.corpus = Corpus.build(b.space, b.renderer, b.embedder, b.recipe)
    b.corpus_dir = tmp_path
    first = [e.id for e, _ in b.top(b.ranking("electric piano"))]
    assert (tmp_path / TEXT_CACHE).exists()
    saved = dict(np.load(tmp_path / TEXT_CACHE))
    assert "electric piano" not in set(saved["texts"])  # descriptions are not written to disk
    fresh = backend(budget=0)
    fresh.corpus, fresh.corpus_dir = b.corpus, tmp_path
    assert [e.id for e, _ in fresh.top(fresh.ranking("electric piano"))] == first
