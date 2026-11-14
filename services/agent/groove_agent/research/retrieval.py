"""Ranking a sound description against rendered patches (retrieval and refinement).

Raw single-prompt CLAP cosine put "80s electric piano" -> PHYS / TIMPANI first; the
first electric piano was 24th of 153 factory presets (see benchmark.py and CLAP.md).
The checkpoint matched native LAION exactly once preprocessing matched, so the fix is
in how text and patches are compared:

1. Prompt ensemble: the description is embedded in several fixed templates and averaged.
2. Hub correction (CSLS): each render's similarity is reduced by its mean similarity to
   its nearest generic instrument words, so renders that sit close to every query do not
   win every search. The vocabulary is fixed and independent of the benchmark prompts.
3. Preset-name prior: factory preset names are human-written metadata shipped with the
   engine. Description-to-name text similarity is added with a smaller weight than audio.
   Variations keep their factory preset, so they inherit its name. Audio remains the
   larger term, and evolutionary refinement still changes only the sound.

Both terms are z-scored over the corpus for each description, so the score is a
relative ranking value, not a cosine. Neither term measures musical quality.
"""
from __future__ import annotations

from pathlib import Path
from typing import Mapping, Optional, Sequence

import numpy as np

from .audio import Embedder, unit

RETRIEVAL_VERSION = "templates-7+csls-10+names-0.75/v1"

TEMPLATES = ("{}", "the sound of {}", "a recording of {}", "{} sound", "a {} playing a melody",
             "music played on {}", "a synthesizer patch that sounds like {}")
VOCABULARY = ("piano", "organ", "guitar", "bass", "drums", "violin", "flute", "trumpet", "saxophone", "bell",
              "synthesizer", "pad", "choir", "voice", "strings", "harp", "marimba", "xylophone", "noise", "wind",
              "percussion", "clarinet", "cello", "banjo", "sitar", "lead synth", "pluck", "keyboard", "horn",
              "whistle", "kick drum", "snare", "cymbal", "glockenspiel", "ukulele", "electric guitar",
              "synth bass", "ambient texture", "chimes")
HUB_NEIGHBOURS = 10
NAME_WEIGHT = 0.75  # chosen on benchmark.TUNING; the smallest weight with the best tuning MRR
# Factory names are abbreviated for a small display; spell them out for the text encoder.
ABBREVIATIONS = {"EP": "electric piano", "WURLI": "wurlitzer electric piano", "PNO": "piano", "GTR": "guitar",
                 "ORGN": "organ", "ORG": "organ", "LD": "lead", "STR": "strings", "STB": "stab", "SQR": "square",
                 "MTL": "metal", "MEMB": "membrane", "NZ": "noise", "DX": "dx7 fm", "B3": "hammond organ",
                 "M1": "korg m1", "CZ": "casio cz", "GM": "general midi", "SYN": "synth", "VOX": "voice",
                 "MIN": "minor", "MIN7": "minor seventh", "UP": "upright", "GB": "game boy", "ATMOS": "atmospheric",
                 "RESO": "resonant", "PWM": "pulse width", "1BIT": "1-bit"}


def spoken_name(label: str) -> str:
    """'DIGITAL / DX RHODES' -> 'dx7 fm rhodes'. The engine family prefix names a synthesis method, not a sound."""
    name = label.split(" / ", 1)[-1]
    return " ".join(ABBREVIATIONS.get(word, word.lower()) for word in name.split())


class TextCache:
    """Memoized text embeddings, optionally persisted next to a corpus.

    The index embeds ~1,300 fixed template texts (preset names and vocabulary); caching
    them avoids repeating that on the first request after a restart. The file is used
    only when its embedder identity matches exactly.
    """

    def __init__(self, embedder: Embedder, path: Optional[Path] = None) -> None:
        self.embedder = embedder
        self.name = embedder.name
        self.path = path
        self._vectors: dict[str, np.ndarray] = {}
        self._dirty = False
        if path is not None and path.exists():
            with np.load(path, allow_pickle=False) as data:
                if str(data["identity"]) == self.name and len(data["texts"]) == len(data["vectors"]):
                    self._vectors = {str(t): v for t, v in zip(data["texts"], data["vectors"])}

    def embed_audio(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        return self.embedder.embed_audio(audio, sample_rate)

    def embed_text(self, text: str) -> np.ndarray:
        return self.embed_texts([text])[0]

    def embed_texts(self, texts: Sequence[str]) -> list[np.ndarray]:
        missing = list(dict.fromkeys(t for t in texts if t not in self._vectors))
        if missing:
            batch = getattr(self.embedder, "embed_texts", None)
            vectors = batch(missing) if batch else [self.embedder.embed_text(t) for t in missing]
            self._vectors.update(zip(missing, (np.asarray(v, dtype=np.float64) for v in vectors)))
            self._dirty = True
        return [self._vectors[t] for t in texts]

    def save(self) -> None:
        if self.path is None or not self._dirty or not self._vectors:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        texts = list(self._vectors)
        with open(self.path, "wb") as handle:
            np.savez(handle, identity=np.array(self.name), texts=np.array(texts),
                     vectors=np.stack([self._vectors[t] for t in texts]))
        self._dirty = False


def _embed_many(embedder: Embedder, texts: Sequence[str]) -> np.ndarray:
    batch = getattr(embedder, "embed_texts", None)
    vectors = batch(list(texts)) if batch else [embedder.embed_text(t) for t in texts]
    return np.stack([unit(v) for v in vectors])


def text_query(embedder: Embedder, text: str) -> np.ndarray:
    """Unit-length mean of the description in every template."""
    return unit(_embed_many(embedder, [t.format(text) for t in TEMPLATES]).mean(axis=0))


def _zscore(values: np.ndarray) -> tuple[float, float]:
    spread = float(values.std())
    return float(values.mean()), spread if spread > 1e-12 else 1.0


class RetrievalIndex:
    """Per-corpus state: generic-vocabulary embeddings and preset-name embeddings.

    `names` maps (engine, preset) to its factory label; any patch with those indices
    (presets and their variations) gets that name's prior.
    """

    def __init__(self, embedder: Embedder, embeddings: np.ndarray, patches: Sequence[Mapping],
                 names: Mapping[tuple[int, int], str], name_weight: float = NAME_WEIGHT) -> None:
        self.embedder = embedder
        self.name_weight = name_weight
        self.audio = np.stack([unit(e) for e in embeddings]) if len(embeddings) else np.zeros((0, 1))
        self.vocabulary = np.stack([text_query(embedder, word) for word in VOCABULARY])
        self.hub = np.array([self.hubness(a) for a in self.audio])
        self.keys = [(int(p["engine"]), int(p["preset"])) for p in patches]
        labels = sorted(set(names.values()))
        self._name_row = {label: i for i, label in enumerate(labels)}
        self.name_vectors = np.stack([text_query(embedder, spoken_name(l)) for l in labels]) if labels else np.zeros((0, 1))
        self.names = dict(names)

    def hubness(self, audio_embedding: np.ndarray) -> float:
        similarities = self.vocabulary @ unit(audio_embedding)
        k = min(HUB_NEIGHBOURS, len(similarities))
        return float(np.sort(similarities)[-k:].mean())

    def ranking(self, description: str) -> "Ranking":
        return Ranking(self, text_query(self.embedder, description))


class Ranking:
    """Scores for one description. Works for corpus entries and for new renders (refinement)."""

    def __init__(self, index: RetrievalIndex, query: np.ndarray) -> None:
        self.index = index
        self.query = query
        self._name_scores = index.name_vectors @ query if len(index.name_vectors) else np.zeros(0)
        corpus_audio = 2 * (index.audio @ query) - index.hub if len(index.audio) else np.zeros(1)
        self._audio_stats = _zscore(corpus_audio)
        self._name_stats = _zscore(self._name_scores) if len(self._name_scores) else (0.0, 1.0)

    def name_prior(self, patch: Mapping) -> float:
        label = self.index.names.get((int(patch["engine"]), int(patch["preset"])))
        if label is None:
            return 0.0  # no factory name known: neutral, audio decides
        mean, spread = self._name_stats
        return (float(self._name_scores[self.index._name_row[label]]) - mean) / spread

    def score(self, patch: Mapping, audio_embedding: np.ndarray, hub: Optional[float] = None) -> float:
        a = unit(audio_embedding)
        hub = self.index.hubness(a) if hub is None else hub
        mean, spread = self._audio_stats
        return (2 * float(a @ self.query) - hub - mean) / spread + self.index.name_weight * self.name_prior(patch)

    def corpus_scores(self) -> np.ndarray:
        return np.array([self.score({"engine": e, "preset": p}, a, h)
                         for (e, p), a, h in zip(self.index.keys, self.index.audio, self.index.hub)])
