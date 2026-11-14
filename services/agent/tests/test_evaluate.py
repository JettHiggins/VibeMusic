import csv
import json

from groove_agent.research.evaluate import run
from research_fixtures import backend


def test_blind_kit_has_both_methods_per_prompt_and_a_hidden_answer_key(tmp_path):
    rows = run(backend(budget=16), tmp_path, prompts=("electric piano", "bass"), seed=3)
    assert [r["prompt"] for r in rows] == ["electric piano", "bass"]
    for number in ("01", "02"):
        for letter in "AB":
            assert (tmp_path / f"{number}-{letter}.wav").read_bytes()[:4] == b"RIFF"
    answers = json.loads((tmp_path / "answers.json").read_text())["prompts"]
    assert all({entry["A"], entry["B"]} == {"preset-only", "search"} for entry in answers.values())
    sheet = list(csv.reader(open(tmp_path / "sheet.csv", encoding="utf-8")))
    assert sheet[0][3].startswith("preferred") and len(sheet) == 3
    assert "preset-only" not in (tmp_path / "sheet.csv").read_text()  # the sheet never reveals the method
    latency = list(csv.DictReader(open(tmp_path / "latency.csv", encoding="utf-8")))
    assert all(float(r["seconds_to_complete"]) >= float(r["seconds_to_retrieval"]) for r in latency)
    assert all(int(r["renders"]) == 16 for r in latency)


def test_listening_results_are_not_overwritten(tmp_path):
    import pytest
    saved = tmp_path / 'sheet.csv'
    saved.write_text('listener preferences to keep', encoding='utf8')
    with pytest.raises(ValueError, match='empty evaluation directory'):
        run(backend(budget=0), tmp_path, prompts=('piano',))
    assert saved.read_text(encoding='utf8') == 'listener preferences to keep'
