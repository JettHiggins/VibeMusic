"""Blind-listening kit: preset-only retrieval versus retrieval plus search, for fixed prompts.

    GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap python -m groove_agent.research.evaluate [output directory]

For each prompt it writes two WAV files named A and B in seeded random order,
one from each method, plus `answers.json` (which is which; do not open before
listening) and `sheet.csv` for listeners to fill in. `latency.csv` records time
to first candidates and to completion. Similarity scores are recorded for
reference only: they are not a measure of musical quality, which is what the
listening sheet is for. Output belongs under the git-ignored `artifacts/`.
"""
from __future__ import annotations

import csv
import json
import random
import sys
import time
from pathlib import Path

from .audio import unit, wav_bytes
from .corpus import Corpus
from .search import Scored, evolve
from .service import ResearchBackend, backend_from_env

PROMPTS = ("80s electric piano", "deep sub bass", "warm analog pad", "bright plucked string",
           "glassy bell", "church organ", "breathy choir", "gritty lead synth")
SEED = 20261114


def run(backend: ResearchBackend, out: Path, prompts=PROMPTS, seed: int = SEED) -> list[dict]:
    out.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    if backend.corpus is None:
        backend.corpus = Corpus.build(backend.space, backend.renderer, backend.embedder, backend.recipe)
    corpus_seconds = time.perf_counter() - started
    rng = random.Random(seed)
    rows, answers = [], {}
    for number, prompt in enumerate(prompts, 1):
        t0 = time.perf_counter()
        query = unit(backend.embedder.embed_text(prompt))
        top = [Scored(e.patch, s, e.label, e.audio) for e, s in backend.corpus.top(query, 5)]
        retrieval_seconds = time.perf_counter() - t0
        result = evolve(top, backend.space, backend.renderer, backend.embedder, query, backend.recipe,
                        seed=seed + number, budget=backend.budget)
        total_seconds = time.perf_counter() - t0
        preset, searched = top[0], result.best[0]
        if searched.audio is None:  # search found nothing better than a corpus entry without stored audio
            searched.audio = backend.renderer.render(searched.patch, backend.recipe)
        if preset.audio is None:
            preset.audio = backend.renderer.render(preset.patch, backend.recipe)
        order = [("preset-only", preset), ("search", searched)]
        rng.shuffle(order)
        for letter, (_, item) in zip("AB", order):
            (out / f"{number:02d}-{letter}.wav").write_bytes(wav_bytes(item.audio, backend.renderer.sample_rate))
        answers[f"{number:02d}"] = {"prompt": prompt, "A": order[0][0], "B": order[1][0],
                                    "preset": preset.origin, "presetPatch": preset.patch, "searchPatch": searched.patch,
                                    "identical": preset.key() == searched.key()}
        rows.append({"number": f"{number:02d}", "prompt": prompt, "preset_label": preset.origin,
                     "preset_similarity": round(preset.score, 4), "search_similarity": round(searched.score, 4),
                     "seconds_to_retrieval": round(retrieval_seconds, 2), "seconds_to_complete": round(total_seconds, 2),
                     "renders": result.rendered, "rejected": result.rejected})
    (out / "answers.json").write_text(json.dumps(
        {"seed": seed, "renderer": backend.renderer.name, "embedder": backend.embedder.name,
         "engineRevision": backend.space.engine_revision, "corpusSeconds": round(corpus_seconds, 1), "prompts": answers},
        indent=1), encoding="utf-8")
    with open(out / "latency.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with open(out / "sheet.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["listener", "number", "prompt", "preferred (A/B/same)", "notes"])
        for row in rows:
            writer.writerow(["", row["number"], row["prompt"], "", ""])
    return rows


def main() -> None:
    root = Path(__file__).resolve().parents[4]
    backend = backend_from_env(root)
    if backend is None:
        raise SystemExit("set GROOVE_RESEARCH=sloop and GROOVE_EMBEDDER=clap")
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "artifacts" / "evaluation"
    for row in run(backend, out):
        print(row)
    print(f"Blind-listening kit written to {out}")


if __name__ == "__main__":
    main()
