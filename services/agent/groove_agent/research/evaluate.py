"""Blind-listening kit: preset-only retrieval versus retrieval plus search, for fixed prompts.

    GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap python -m groove_agent.research.evaluate \
        [listening directory] [--key-dir DIR] [--seed 20261114] [--prompts fixed|all|"a,b,c"]

For each prompt it writes two WAV files named A and B in seeded random order, one
from each method, and `sheet.csv` for listeners to fill in. The answer key
(`answers.json`, which method is A/B) and `latency.csv` (time to first candidates and
to completion, preset labels, scores) go to a separate key directory, by default
`<listening directory>-answer-key`. Listeners get only the listening directory.

Same seed, prompts, engine build and model revisions give the same A/B order on every
laptop. Audio should match too; `kit.json` lists a SHA-256 per WAV and one kit
fingerprint, so teammates can confirm they heard identical files before pooling
results. If fingerprints differ (e.g. CPU floating point changed a search ranking),
share one kit instead of pooling different ones.

Similarity scores are recorded for reference only: they are not a measure of
musical quality, which is what the listening sheet is for. Output belongs under the
git-ignored `artifacts/`.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import time
from pathlib import Path
from typing import Optional, Sequence

from .audio import wav_bytes
from .benchmark import HELD_OUT, TUNING
from .corpus import Corpus
from .retrieval import RETRIEVAL_VERSION
from .search import Scored, evolve
from .service import ResearchBackend, backend_from_env

PROMPTS = tuple(TUNING)  # the fixed PLAN.md evaluation prompts
SEED = 20261114
SHEET_HEADER = ["listener", "number", "prompt", "preferred (A/B/same)", "notes"]


def _empty(directory: Path) -> None:
    if directory.exists() and any(directory.iterdir()):
        raise ValueError(f'choose an empty evaluation directory; existing listening results are preserved: {directory}')


def run(backend: ResearchBackend, out: Path, prompts: Sequence[str] = PROMPTS, seed: int = SEED,
        key_dir: Optional[Path] = None) -> list[dict]:
    key_dir = key_dir if key_dir is not None else out.with_name(out.name + "-answer-key")
    if key_dir.resolve() == out.resolve():
        raise ValueError("the answer key must not be stored with the listening files")
    _empty(out)
    _empty(key_dir)
    if not prompts:
        raise ValueError('evaluation needs at least one prompt')
    out.mkdir(parents=True, exist_ok=True)
    key_dir.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    if backend.corpus is None:
        backend.corpus = Corpus.build(backend.space, backend.renderer, backend.embedder, backend.recipe)
    corpus_seconds = time.perf_counter() - started
    rng = random.Random(seed)
    rows, answers, hashes = [], {}, {}
    for number, prompt in enumerate(prompts, 1):
        t0 = time.perf_counter()
        ranking = backend.ranking(prompt)
        top = [Scored(e.patch, s, e.label, e.audio) for e, s in backend.top(ranking, 5)]
        # Cached corpora contain embeddings/patches, not audio. Count preview restoration
        # before reporting retrieval-ready latency, just as the live service does.
        for item in top:
            if item.audio is None:
                item.audio = backend.renderer.render(item.patch, backend.recipe)
        retrieval_seconds = time.perf_counter() - t0
        result = evolve(top, backend.space, backend.renderer, backend.embedder, ranking.query, backend.recipe,
                        seed=seed + number, budget=backend.budget, ranking=ranking)
        total_seconds = time.perf_counter() - t0
        preset, searched = top[0], result.best[0]
        if searched.audio is None:  # search found nothing better than a corpus entry without stored audio
            searched.audio = backend.renderer.render(searched.patch, backend.recipe)
        order = [("preset-only", preset), ("search", searched)]
        rng.shuffle(order)
        for letter, (_, item) in zip("AB", order):
            name = f"{number:02d}-{letter}.wav"
            data = wav_bytes(item.audio, backend.renderer.sample_rate)
            (out / name).write_bytes(data)
            hashes[name] = hashlib.sha256(data).hexdigest()
        answers[f"{number:02d}"] = {"prompt": prompt, "A": order[0][0], "B": order[1][0],
                                    "preset": preset.origin, "presetPatch": preset.patch, "searchPatch": searched.patch,
                                    "identical": preset.key() == searched.key()}
        rows.append({"number": f"{number:02d}", "prompt": prompt, "preset_label": preset.origin,
                     "preset_score": round(preset.score, 4), "search_score": round(searched.score, 4),
                     "seconds_to_retrieval": round(retrieval_seconds, 2), "seconds_to_complete": round(total_seconds, 2),
                     "renders": result.rendered, "rejected": result.rejected})
    identity = {"seed": seed, "prompts": list(prompts), "renderer": backend.renderer.name,
                "embedder": backend.embedder.name, "ranking": RETRIEVAL_VERSION,
                "engineRevision": backend.space.engine_revision, "budget": backend.budget}
    fingerprint = hashlib.sha256("\n".join(f"{k} {v}" for k, v in sorted(hashes.items())).encode()).hexdigest()
    (out / "kit.json").write_text(json.dumps({**identity, "fingerprint": fingerprint, "files": hashes}, indent=1),
                                  encoding="utf-8")
    (key_dir / "answers.json").write_text(json.dumps(
        {**identity, "fingerprint": fingerprint, "corpusSeconds": round(corpus_seconds, 1), "prompts": answers},
        indent=1), encoding="utf-8")
    with open(key_dir / "latency.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with open(out / "sheet.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(SHEET_HEADER)
        for row in rows:
            writer.writerow(["", row["number"], row["prompt"], "", ""])
    return rows


def prompt_list(value: str) -> tuple[str, ...]:
    if value == "fixed":
        return PROMPTS
    if value == "all":
        return tuple(TUNING) + tuple(HELD_OUT)
    prompts = tuple(p.strip() for p in value.split(",") if p.strip())
    if not prompts:
        raise argparse.ArgumentTypeError("no prompts given")
    return prompts


def main(argv: Optional[Sequence[str]] = None) -> None:
    root = Path(__file__).resolve().parents[4]
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("out", nargs="?", type=Path, default=root / "artifacts" / "evaluation")
    parser.add_argument("--key-dir", type=Path, default=None)
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--prompts", type=prompt_list, default=PROMPTS,
                        help="'fixed' (default, the PLAN.md prompts), 'all' (adds held-out), or a comma list")
    args = parser.parse_args(argv)
    backend = backend_from_env(root)
    if backend is None:
        raise SystemExit("set GROOVE_RESEARCH=sloop and GROOVE_EMBEDDER=clap")
    for row in run(backend, args.out, args.prompts, args.seed, args.key_dir):
        print({k: row[k] for k in ("number", "prompt", "seconds_to_retrieval", "seconds_to_complete")})
    key = args.key_dir or args.out.with_name(args.out.name + "-answer-key")
    print(f"Listening kit: {args.out}  (share this, and kit.json's fingerprint)")
    print(f"Answer key:    {key}  (do not open before listening)")


if __name__ == "__main__":
    main()
