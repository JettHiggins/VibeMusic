# Local CLAP music checkpoint

Sound research is enabled explicitly with `GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap`. No inference API or key is used. Install base and optional research requirements in an isolated environment; see services/agent/README.md. The initial original checkpoint download is approximately 2.35 GB and stays in the model cache.

## Source and compatibility

[LAION's release documentation](https://github.com/LAION-AI/CLAP#pretrained-models) identifies `music_audioset_epoch_15_esc_90.14.pt` as its music checkpoint. We pin that file from `lukewys/laion_clap` at revision `b3708341862f581175dba5c356a4ebf74a9b6651`, plus the architecture/processor from `laion/larger_clap_music` at `a0b4534a14f58e20944452dff00a22a06ce629d1`.

The public converted music weights loaded completely but produced cosine similarity about 0.999 for “a church organ” versus “wind and rain noise.” Inspecting the original release showed different text weights. Mapping the original weights to the Transformers architecture produced about 0.533 for those unrelated descriptions and 0.837 for two descriptions of a church organ. This isolates a difference between the published weight sets; it does not establish why that difference exists.

`clap_checkpoint.py` maps projection, attention and encoder names using the architecture described by [Transformers' official conversion script](https://github.com/huggingface/transformers/blob/main/src/transformers/models/clap/convert_clap_original_pytorch_to_hf.py). The loader rejects missing learned weights and unexpected tensors. It omits original training-only heads, frontend tensors replaced by the processor, and deterministic masks/indexing buffers. Loading stays `weights_only=True`; the source checkpoint's NumPy scalar metadata is narrowly allowlisted. Memory mapping avoids allocating its optimizer tensors. Loading without memory mapping exceeded the development environment's memory limit.

Corpus identity includes both source/config revisions, conversion version, and inference-library versions, so corpora from the previous converted weights are not reused. The general `laion/clap-htsat-unfused` checkpoint remains an explicit comparison option via `GROOVE_CLAP_MODEL`.

## Verification and limits

```sh
GROOVE_TEST_CLAP=1 python -m pytest services/agent/tests/test_clap.py
python -m pytest services/agent/tests/test_clap_checkpoint.py services/agent/tests/test_clap_validation.py
```

The opt-in tests load the actual music weights and check text distinction/paraphrase similarity, deterministic audio features, nondegenerate audio features, and shared finite audio/text dimensions. Pure tests cover key mapping, packed attention splitting, invalid tensors, duplicates and degeneracy rejection without downloading models.

These checks establish inference compatibility. They do not establish subjective patch quality, superiority over factory presets, or parity with the native LAION runtime on a reference dataset. The three-person blind listening comparison in PLAN.md remains required. Generate listening artifacts with the evaluation command in services/agent/README.md; keep answer keys separate from listeners.

A local actual-engine run embedded all 153 factory patches and searched 128 variations for “80s electric piano,” with zero render rejections. Warm retrieval took 0.1 seconds and total search 78.21 seconds; similarity changed from 0.4213 to 0.4606. The top factory match was labeled `PHYS / TIMPANI`, which underlines the need for listening rather than score-based signoff. A single-prompt blind pair and sheet were written under ignored `artifacts/evaluation-music-original-electric-piano`; the full fixed-prompt three-listener evaluation remains open.
