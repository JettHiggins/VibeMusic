"""Instrument-family retrieval benchmark over the factory presets (no listening, no API).

    GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap python -m groove_agent.research.benchmark [--scorer NAME ...]

For fixed prompts, a factory preset counts as relevant when its name identifies the
requested instrument family (for "80s electric piano": RHODES, DX RHODES, WURLI, TINE EP).
The judgement uses preset names only, written before any scores were inspected.
This measures gross family mismatches such as "80s electric piano" -> PHYS / TIMPANI;
it does not measure which relevant preset sounds best. Listening is still required
(PLAN.md milestone 4), and similarity scores are not a quality measure.

`TUNING` prompts were used while choosing text templates; `HELD_OUT` prompts were not,
so report both. Evaluation prompts in evaluate.PROMPTS are the tuning set.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Callable, Mapping, Sequence

import numpy as np

from .audio import unit

TUNING: Mapping[str, tuple[str, ...]] = {
    "80s electric piano": ("DIGITAL / RHODES", "DIGITAL / DX RHODES", "DIGITAL / WURLI", "FM6 / TINE EP"),
    "deep sub bass": ("ANALOG / 808 BOOM", "ANALOG / SUB BASS", "SAMPLE / DEEP BASS", "FM6 / ROUND BASS",
                      "ANALOG / MONO BASS", "ANALOG / 808 DIRTY"),
    "warm analog pad": ("ANALOG / WARM PAD", "ANALOG / ATMOS PAD", "ANALOG / SINE PAD", "TRIO / SAW PAD",
                        "TRIO / PULSE PAD", "FM6 / SOFT PAD", "PHASE / CZ PAD"),
    "bright plucked string": ("PHYS / STR PLUCK", "PHYS / PHYS HARP", "PHYS / NYLON GTR", "PHYS / STEEL GTR",
                              "PHYS / KOTO", "PHYS / BANJO", "PHYS / SITAR", "DIGITAL / HARP", "FM6 / NYLON PICK"),
    "glassy bell": ("FM6 / GLASS BELL", "DIGITAL / TUBE BELL", "PHYS / BIG BELL", "PHYS / CHIMES",
                    "PHYS / BELL TREE", "DIGITAL / TRAP BELL", "DIGITAL / PLUGG BELL", "DIGITAL / GLOCKEN",
                    "DIGITAL / CELESTA", "DIGITAL / MUSIC BOX", "PHYS / GLASS BOWL"),
    "church organ": ("WHEEL / CHAPEL", "WHEEL / GOSPEL", "WHEEL / SOUL ORGAN", "WHEEL / JAZZ ORGAN",
                     "WHEEL / DIRTY B3", "WHEEL / HOUSE ORGN", "WHEEL / ROCK ORGAN", "WHEEL / REGGAE ORG",
                     "FM6 / DRAWBARS"),
    "breathy choir": ("VOICE / CHOIR AAH", "VOICE / SOUL OOH", "VOICE / VOX PAD"),
    "gritty lead synth": ("ANALOG / FAT LEAD", "ANALOG / PWM LEAD", "ANALOG / G-FUNK LD", "TRIO / SYNC LEAD",
                          "TRIO / SQR LEAD", "PHASE / CZ LEAD", "LOFI / GAME LEAD", "LOFI / WAVE LEAD"),
}

HELD_OUT: Mapping[str, tuple[str, ...]] = {
    "acoustic grand piano": ("SAMPLE / GRAND PNO", "DIGITAL / FM GRAND", "SAMPLE / DUSTY PNO", "DIGITAL / M1 PIANO"),
    "wooden marimba": ("DIGITAL / MARIMBA", "DIGITAL / XYLOPHONE", "FM6 / WOOD BARS", "PHYS / MODAL BAR"),
    "brass section": ("FM6 / BRASS SECT", "ANALOG / SYN BRASS", "PHASE / CZ BRASS", "SAMPLE / HORN STAB",
                      "TRIO / POWER STAB"),
    "acid bassline": ("ANALOG / ACID 303",),
    "caribbean steel drum": ("DIGITAL / STEEL DRUM", "PHYS / STEEL PAN"),
    "nylon string guitar": ("PHYS / NYLON GTR", "FM6 / NYLON PICK"),
    "falling rain": ("NOISE / RAIN",),
    "bowed cello": ("PHYS / CELLO BOW",),
    "vibraphone": ("SAMPLE / VIBES", "PHYS / VIBRA BAR"),
    "accordion": ("TRIO / ACCORDION",),
    "8-bit video game chiptune": ("LOFI / GAME LEAD", "LOFI / 8BIT ARP", "LOFI / CHIP CHORD", "LOFI / NES BASS",
                                  "LOFI / GB BASS", "LOFI / 1BIT BEEP", "LOFI / WAVE LEAD"),
    "harmonica": ("VOICE / HARMONICA",),
}

Scorer = Callable[[str], np.ndarray]  # prompt -> one similarity per corpus label


@dataclass(frozen=True)
class PromptResult:
    prompt: str
    first_relevant_rank: int  # 1-based; len(labels) + 1 when nothing relevant exists
    top: str
    top_relevant: bool
    relevant_in_top5: int


def evaluate(labels: Sequence[str], scorer: Scorer, relevance: Mapping[str, Sequence[str]]) -> list[PromptResult]:
    missing = {name for names in relevance.values() for name in names} - set(labels)
    if missing:
        raise ValueError(f"relevance labels not in corpus: {sorted(missing)}")
    results = []
    for prompt, relevant in relevance.items():
        scores = np.asarray(scorer(prompt), dtype=np.float64)
        if scores.shape != (len(labels),):
            raise ValueError("scorer must return one score per label")
        order = np.argsort(-scores, kind="stable")
        hits = [labels[i] in relevant for i in order]
        first = hits.index(True) + 1 if True in hits else len(labels) + 1
        results.append(PromptResult(prompt, first, labels[order[0]], hits[0], sum(hits[:5])))
    return results


def summary(results: Sequence[PromptResult]) -> dict:
    n = len(results)
    return {"prompts": n,
            "top1": sum(r.top_relevant for r in results) / n,
            "hit5": sum(r.relevant_in_top5 > 0 for r in results) / n,
            "mrr": sum(1.0 / r.first_relevant_rank for r in results) / n,
            "median_rank": float(np.median([r.first_relevant_rank for r in results]))}


def cosine_scorer(embeddings: np.ndarray, embed_text: Callable[[str], np.ndarray]) -> Scorer:
    matrix = np.stack([unit(e) for e in embeddings])
    return lambda prompt: matrix @ unit(embed_text(prompt))


def markdown(rows: Mapping[str, Sequence[PromptResult]]) -> str:
    """One row per prompt, one column pair (rank, top label) per scorer."""
    names = list(rows)
    lines = ["| prompt | " + " | ".join(f"{n}: first relevant rank | {n}: top match" for n in names) + " |",
             "|---|" + "---|---|" * len(names)]
    for i, result in enumerate(next(iter(rows.values()))):
        cells = []
        for n in names:
            r = rows[n][i]
            cells += [str(r.first_relevant_rank), r.top + (" (match)" if r.top_relevant else " (miss)")]
        lines.append(f"| {result.prompt} | " + " | ".join(cells) + " |")
    for n in names:
        s = summary(rows[n])
        lines.append(f"\n**{n}**: top-1 {s['top1']:.0%}, relevant in top 5 {s['hit5']:.0%}, "
                     f"MRR {s['mrr']:.3f}, median first-relevant rank {s['median_rank']:g} (of {len(rows[n])} prompts)")
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> None:
    from pathlib import Path

    from .corpus import Corpus
    from .retrieval import RETRIEVAL_VERSION
    from .service import backend_from_env

    parser = argparse.ArgumentParser(description="Instrument-family retrieval benchmark over factory presets")
    parser.parse_args(argv)
    root = Path(__file__).resolve().parents[4]
    backend = backend_from_env(root)
    if backend is None:
        raise SystemExit("set GROOVE_RESEARCH=sloop and GROOVE_EMBEDDER=clap")
    if backend.corpus is None:
        backend.corpus = Corpus.build(backend.space, backend.renderer, backend.embedder, backend.recipe)
        if backend.corpus_dir is not None:
            backend.corpus.save(backend.corpus_dir)
    presets = [e for e in backend.corpus.entries if "variation" not in e.label]
    labels = [e.label for e in presets]
    cosine = cosine_scorer(np.stack([e.embedding for e in presets]), backend.embedder.embed_text)
    ranked = {e.id for e in presets}

    def ranking(prompt: str) -> np.ndarray:
        scores = backend.ranking(prompt).corpus_scores()
        return np.array([s for e, s in zip(backend.corpus.entries, scores) if e.id in ranked])

    print(f"embedder: {backend.embedder.name}\nranking: {RETRIEVAL_VERSION}\n")
    for title, relevance in (("Tuning prompts (evaluation set)", TUNING), ("Held-out prompts", HELD_OUT)):
        print(f"### {title}\n")
        print(markdown({"single-prompt cosine": evaluate(labels, cosine, relevance),
                        "ranking": evaluate(labels, ranking, relevance)}))
        print()


if __name__ == "__main__":
    main()
