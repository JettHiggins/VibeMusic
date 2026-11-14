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
