import csv
import json

import pytest

from groove_agent.research.evaluate import PROMPTS, main, prompt_list, run
from research_fixtures import backend


def kit(tmp_path, name="listen", **kwargs):
    out = tmp_path / name
    rows = run(backend(budget=16), out, prompts=("electric piano", "bass"), seed=3, **kwargs)
    return rows, out, kwargs.get("key_dir") or tmp_path / f"{name}-answer-key"


def test_blind_kit_has_both_methods_per_prompt_and_a_hidden_answer_key(tmp_path):
    rows, out, key = kit(tmp_path)
    assert [r["prompt"] for r in rows] == ["electric piano", "bass"]
    for number in ("01", "02"):
        for letter in "AB":
            assert (out / f"{number}-{letter}.wav").read_bytes()[:4] == b"RIFF"
    answers = json.loads((key / "answers.json").read_text())["prompts"]
    assert all({entry["A"], entry["B"]} == {"preset-only", "search"} for entry in answers.values())
    sheet = list(csv.reader(open(out / "sheet.csv", encoding="utf-8")))
    assert sheet[0][3].startswith("preferred") and len(sheet) == 3
    # Listeners get only WAVs, the blank sheet and the fingerprint; nothing names a method or a preset.
    assert sorted(p.name for p in out.iterdir()) == ["01-A.wav", "01-B.wav", "02-A.wav", "02-B.wav", "kit.json", "sheet.csv"]
    for name in ("sheet.csv", "kit.json"):
        text = (out / name).read_text()
        assert "preset-only" not in text and "search\"" not in text and "presetPatch" not in text
    latency = list(csv.DictReader(open(key / "latency.csv", encoding="utf-8")))
    assert all(float(r["seconds_to_complete"]) >= float(r["seconds_to_retrieval"]) for r in latency)
    assert all(int(r["renders"]) == 16 for r in latency)


def test_same_seed_gives_identical_kits_and_order(tmp_path):
    _, first, first_key = kit(tmp_path, "one")
    _, second, second_key = kit(tmp_path, "two")
    a, b = (json.loads((d / "kit.json").read_text()) for d in (first, second))
    assert a["fingerprint"] == b["fingerprint"] and a["files"] == b["files"] and a["seed"] == 3
    order = lambda key: {n: (e["A"], e["B"]) for n, e in json.loads((key / "answers.json").read_text())["prompts"].items()}
    assert order(first_key) == order(second_key)
    assert json.loads((first_key / "answers.json").read_text())["fingerprint"] == a["fingerprint"]


def test_listening_results_are_not_overwritten(tmp_path):
    saved = tmp_path / 'sheet.csv'
    saved.write_text('listener preferences to keep', encoding='utf8')
    with pytest.raises(ValueError, match='empty evaluation directory'):
        run(backend(budget=0), tmp_path, prompts=('piano',))
    assert saved.read_text(encoding='utf8') == 'listener preferences to keep'


def test_answer_key_cannot_share_the_listening_directory(tmp_path):
    with pytest.raises(ValueError, match='answer key'):
        run(backend(budget=0), tmp_path / "kit", prompts=('piano',), key_dir=tmp_path / "kit")


def test_prompt_sets():
    assert prompt_list("fixed") == PROMPTS and len(PROMPTS) == 8 and "80s electric piano" in PROMPTS
    assert len(prompt_list("all")) == 20 and prompt_list("all")[:8] == PROMPTS
    assert prompt_list(" glassy bell, deep sub bass ,") == ("glassy bell", "deep sub bass")


def test_command_line_without_a_backend_explains_configuration(monkeypatch, tmp_path):
    monkeypatch.delenv("GROOVE_RESEARCH", raising=False)
    with pytest.raises(SystemExit, match="GROOVE_RESEARCH"):
        main([str(tmp_path / "kit"), "--seed", "42"])
