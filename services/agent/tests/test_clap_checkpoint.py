"""No model downloads or Torch dependency: validate attention split and source-key coverage."""
import numpy as np
import pytest
from groove_agent.research.clap_checkpoint import convert_weights


def test_music_keys_and_attention_are_converted_without_reordering_weights():
    qkv = np.arange(18).reshape(6, 3)
    embedding = np.arange(6).reshape(2, 3)
    result = convert_weights({
        'module.audio_branch.layers.0.blocks.0.attn.qkv.weight': qkv,
        'module.text_branch.embeddings.word_embeddings.weight': embedding,
        'module.text_projection.0.weight': embedding,
        'module.text_projection.2.weight': embedding,
        'module.audio_branch.layers.0.blocks.0.mlp.fc1.weight': embedding,
        'module.audio_branch.layers.0.blocks.0.norm1.weight': embedding,
        'module.audio_branch.bn0.weight': embedding,
        'module.audio_branch.spectrogram_extractor.stft.conv_real.weight': embedding,
        'module.audio_branch.layers.0.blocks.1.attn_mask': embedding,
        'module.audio_transform.sequential.0.weight': embedding,
        'module.audio_branch.head.weight': embedding,
    })
    for i, part in enumerate(('query', 'key', 'value')):
        np.testing.assert_equal(result[f'audio_model.audio_encoder.layers.0.blocks.0.attention.self.{part}.weight'], qkv[i*2:i*2+2])
    assert result['text_model.embeddings.word_embeddings.weight'] is embedding
    assert result['text_projection.linear1.weight'] is embedding
    assert result['text_projection.linear2.weight'] is embedding
    assert result['audio_model.audio_encoder.layers.0.blocks.0.intermediate.dense.weight'] is embedding
    assert result['audio_model.audio_encoder.layers.0.blocks.0.layernorm_before.weight'] is embedding
    assert len(result) == 9


def test_unknown_keys_are_retained_for_strict_loader_validation_and_duplicates_fail():
    value = np.ones(3)
    assert 'unknown' in convert_weights({'unknown': value})
    with pytest.raises(ValueError, match='duplicate'):
        convert_weights({'module.text_branch.a': value, 'text_branch.a': value})
    with pytest.raises(ValueError, match='attention tensor'):
        convert_weights({'audio_branch.attn.qkv.weight': np.ones((4, 2))})
