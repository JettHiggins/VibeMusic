"""Real WASM adapter tests: build engine assets and npm ci first."""
from pathlib import Path
import numpy as np
import pytest
from groove_agent.research.audio import DEFAULT_RECIPE, RenderRecipe, render_problem
from groove_agent.research.space import ParameterSpace
from tools.sloop_renderer import SloopRenderer, ENGINE_REVISION, ROOT
import json

pytestmark = pytest.mark.skipif(not (ROOT / 'apps/web/public/engine/voicesynth.wasm').is_file(), reason='build engine assets first')


def test_actual_renderer_implements_research_protocol_and_complete_patch():
    renderer = SloopRenderer()
    metadata = json.loads((renderer.assets / 'metadata.json').read_text())
    space = ParameterSpace(metadata, ENGINE_REVISION)
    label, patch = next((label, patch) for label, patch in space.preset_patches() if patch['engine'] == 1)
    recipe = RenderRecipe('adapter-test', 0.5, ((0.0, 0.25, 60, 0.8),))
    audio = renderer.render(patch, recipe)
    assert audio.shape == (22050,)
    assert renderer.sample_rate == 44100
    assert 'sha256:' in renderer.name and 'MOCK' not in renderer.name
    assert render_problem(audio) is None
    assert np.array_equal(audio, renderer.render(patch, recipe))


def test_invalid_patch_fails_without_fake_or_partial_audio():
    patch = {'engine': 1, 'preset': 0, 'engineRevision': 'wrong', 'parameters': {}}
    with pytest.raises(ValueError, match='revision'):
        SloopRenderer().render(patch, DEFAULT_RECIPE)
