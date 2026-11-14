"""Load LAION's original music weights into Transformers' CLAP inference architecture.

The public converted music repository currently fails the text-space sanity check.
Use the original release listed by LAION, with immutable model/config revisions.
Mapping follows Transformers' CLAP conversion names; unused training heads are omitted.
"""
from __future__ import annotations

import re
from pathlib import Path

MUSIC_MODEL = 'laion/larger_clap_music'
MUSIC_CONFIG_REVISION = 'a0b4534a14f58e20944452dff00a22a06ce629d1'
MUSIC_SOURCE = 'lukewys/laion_clap'
MUSIC_SOURCE_REVISION = 'b3708341862f581175dba5c356a4ebf74a9b6651'
MUSIC_FILENAME = 'music_audioset_epoch_15_esc_90.14.pt'
CONVERSION_VERSION = 1


def convert_weights(state: dict) -> dict:
    """Pure tensor-name conversion; accepts tensor-like arrays for inexpensive tests."""
    converted = {}
    for original, value in state.items():
        name = original.removeprefix('module.')
        if (name.startswith(('audio_branch.spectrogram_extractor.', 'audio_branch.logmel_extractor.',
                             'audio_branch.tscam_conv.', 'audio_branch.head.', 'text_transform.', 'audio_transform.'))
                or name.endswith(('.position_ids', '.attn_mask'))):
            continue
        for before, after in (
            ('text_branch', 'text_model'), ('audio_branch', 'audio_model.audio_encoder'),
            ('attn', 'attention.self'), ('self.proj', 'output.dense'),
            ('mlp.fc1', 'intermediate.dense'), ('mlp.fc2', 'output.dense'),
            ('norm1', 'layernorm_before'), ('norm2', 'layernorm_after'), ('bn0', 'batch_norm'),
        ):
            name = name.replace(before, after)
        name = re.sub(r'_projection\.(0|2)\.', lambda m: f'_projection.linear{1 if m[1] == "0" else 2}.', name)
        pieces = [(name, value)]
        if 'qkv' in name:
            if value.shape[0] % 3:
                raise ValueError(f'invalid attention tensor: {original}')
            size = value.shape[0] // 3
            pieces = [(name.replace('qkv', part), value[i * size:(i + 1) * size])
                      for i, part in enumerate(('query', 'key', 'value'))]
        for key, tensor in pieces:
            if key in converted:
                raise ValueError(f'duplicate converted tensor: {key}')
            converted[key] = tensor
    return converted


def load_music_model(torch, config, model_class):
    """Restricted, memory-mapped loading avoids materializing the 2.35 GB optimizer state."""
    import numpy as np
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(MUSIC_SOURCE, MUSIC_FILENAME, revision=MUSIC_SOURCE_REVISION)
    if Path(path).parent.name != MUSIC_SOURCE_REVISION:
        raise RuntimeError('original music checkpoint revision could not be verified')
    # The training checkpoint includes a NumPy numeric scalar in its optimizer metadata.
    # Keep weights_only=True; allow only the concrete numeric types present in this release.
    with torch.serialization.safe_globals([
        (np._core.multiarray.scalar, 'numpy.core.multiarray.scalar'), np.dtype, np.dtypes.Float64DType,
    ]):
        checkpoint = torch.load(path, map_location='cpu', weights_only=True, mmap=True)
    weights = convert_weights(checkpoint['state_dict'])
    with torch.device('meta'):
        model = model_class(config)
    result = model.load_state_dict(weights, strict=False, assign=True)
    expected_buffers = {'text_model.embeddings.position_ids', 'text_model.embeddings.token_type_ids'}
    if set(result.missing_keys) != expected_buffers or result.unexpected_keys:
        raise RuntimeError(f'original music checkpoint does not match CLAP architecture: {result}')
    # These deterministic indexing buffers are not learned weights in the source model.
    for name, buffer in list(model.named_buffers()):
        if not buffer.is_meta:
            continue
        if name not in expected_buffers:
            raise RuntimeError(f'uninitialized music-model buffer: {name}')
        value = (torch.arange(buffer.shape[-1]).expand(buffer.shape) if name.endswith('.position_ids')
                 else torch.zeros(buffer.shape, dtype=buffer.dtype))
        parent, attribute = name.rsplit('.', 1)
        model.get_submodule(parent).register_buffer(attribute, value, persistent=False)
    if any(parameter.is_meta for parameter in model.parameters()):
        raise RuntimeError('original music model has uninitialized learned weights')
    return model
