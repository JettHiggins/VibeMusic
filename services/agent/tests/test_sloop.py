"""Real-engine tests. They need the built engine assets and skip when those are absent.

Build them with scripts/build-engine.py (see docs/SETUP.md); they are git-ignored.
"""
import json
import random
from pathlib import Path

import numpy as np
import pytest

from groove_agent.contracts import contracts_dir, validate
from groove_agent.research.audio import DEFAULT_RECIPE, RenderRecipe, render_problem
from groove_agent.research.mock import MockEmbedder
from groove_agent.research.service import ResearchBackend, ResearchService
from groove_agent.research.space import SESSION_OWNED, ParameterSpace

ENGINE_DIR = contracts_dir().parents[1] / "apps" / "web" / "public" / "engine"
REVISION = "bac9c05ea7627449405aa10e48da21d75b6c8c56"  # ENGINE_REVISION in apps/web/src/engine/snapshot.ts
pytestmark = pytest.mark.skipif(not (ENGINE_DIR / "voicesynth.wasm").exists() or not (ENGINE_DIR / "metadata.json").exists(),
                                reason="SLOOP engine assets are not built")
SHORT = RenderRecipe("test-two-notes", 1.0, ((0.0, 0.3, 60, 0.8), (0.4, 0.3, 67, 0.8)))


@pytest.fixture(scope="module")
def metadata():
    return json.loads((ENGINE_DIR / "metadata.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def space(metadata):
    return ParameterSpace(metadata, REVISION)


@pytest.fixture(scope="module")
def renderer():
    from groove_agent.research.sloop import SloopRenderer
    return SloopRenderer.from_directory(ENGINE_DIR, REVISION)


def test_real_metadata_gives_valid_patches_without_session_owned_parameters(space, metadata):
    presets = space.preset_patches()
    assert len(presets) == sum(len(e["presets"]) for e in metadata["engines"]) and space.engine_count == 12
    for label, patch in presets:
        assert space.problem(patch) is None, label
        assert not SESSION_OWNED & {int(k) for k in patch["parameters"]}
        validate("PatchCandidate", {"id": "x", "patch": patch, "provenance": label, "previewUrl": "", "score": 0})
    names = [b.name for b in space.tunable(0)]
    assert names[:12] == ["ATK", "DEC", "SUS", "REL", "FLT", "SHP", "DST", "CHO", "DLY", "REV", "DTUNE", "FILT"]
    rng = random.Random(1)
    for _, patch in presets[::7]:
        for _ in range(20):
            assert space.problem(space.mutate(patch, rng, rate=1.0, scale=2.0)) is None


def test_real_engine_renders_audible_repeatable_audio(space, renderer):
    assert renderer.sample_rate == 44100
    _, patch = space.preset_patches()[0]
    first = renderer.render(patch, SHORT)
    assert first.shape == (44100,) and first.dtype == np.float32
    assert render_problem(first) is None
    assert np.array_equal(first, renderer.render(patch, SHORT))  # fresh instance per render: no carried state
    assert float(np.abs(first[: 44100 // 4]).max()) > 0.01 and np.abs(first).max() <= 1.0


def test_patch_parameters_and_presets_change_the_real_sound(space, renderer):
    presets = dict(space.preset_patches())
    base = presets["DIGITAL / RHODES"]
    plain = renderer.render(base, SHORT)
    attack = next(b for b in space.tunable(base["engine"]) if b.name == "ATK")
    slow = {**base, "parameters": {**base["parameters"], str(attack.index): attack.hi}}
    slow_audio = renderer.render(slow, SHORT)
    early = slice(0, 2000)
    assert np.abs(slow_audio[early]).max() < 0.5 * np.abs(plain[early]).max()  # a long attack starts quieter
    other = renderer.render(presets["FM6 / GLASS BELL"], SHORT)
    assert not np.allclose(plain, other)


def test_every_engine_renders_a_usable_first_preset(space, renderer):
    seen = set()
    for label, patch in space.preset_patches():
        if patch["engine"] in seen:
            continue
        seen.add(patch["engine"])
        assert render_problem(renderer.render(patch, SHORT)) is None, label
    assert len(seen) == 12


def test_research_job_on_real_engine_audio(space, renderer):
    """Real renders, mock embedder: checks the pipeline end to end, not the ranking."""
    backend = ResearchBackend(space, renderer, MockEmbedder(), recipe=SHORT, budget=16)
    service = ResearchService(backend)
    messages = []
    port = service.port(messages.append)
    port.start("job", "electric piano")
    port.join(120)
    assert messages[-1]["status"] == "complete", messages[-1].get("error")
    assert backend.corpus is not None and len(backend.corpus.entries) + backend.corpus.rejected == 153
    for message in messages:
        validate("ServerMessage", message)
    for candidate in messages[-1]["candidates"]:
        assert space.problem(candidate["patch"]) is None
        assert "SLOOP WASM offline" in candidate["provenance"] and "MOCK" in candidate["provenance"]
        token = candidate["previewUrl"].rsplit("/", 1)[1][:-4]
        assert service.preview(token)[:4] == b"RIFF"
