"""Checkpoint guards tested without installing/downloading torch or model weights."""
import numpy as np
import pytest
from groove_agent.research.clap import ClapEmbedder, DegenerateModel


@pytest.mark.parametrize('vector', [[], [0, 0], [float('nan'), 1], [float('inf'), 1], [[1, 2]]])
def test_invalid_model_features_are_rejected(vector):
    with pytest.raises(DegenerateModel):
        ClapEmbedder._checked_vector(vector)


def test_unrelated_texts_cannot_share_one_feature_vector():
    with pytest.raises(DegenerateModel, match='indistinguishable'):
        ClapEmbedder._check_text_space([1, 2], [2, 4], 'test')
    ClapEmbedder._check_text_space([1, 0], [0, 1], 'test')


def test_audio_is_rounded_through_int16_like_native_laion():
    # laion_clap.hook: int16_to_float32(float32_to_int16(x)) = (clip(x) * 32767).astype(int16) / 32767
    from groove_agent.research.clap import quantize_int16
    x = np.array([0.0, 1e-6, 0.5, -0.5, 1.5, -1.5, 0.123456789], dtype=np.float64)
    expected = (np.clip(x, -1, 1) * 32767.0).astype(np.int16).astype(np.float32) / 32767.0
    out = quantize_int16(x)
    assert out.dtype == np.float32 and np.array_equal(out, expected)
    assert out[1] == 0.0 and out[4] == 1.0 and out[5] == -1.0
