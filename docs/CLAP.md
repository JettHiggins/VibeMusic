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

A local actual-engine run embedded all 153 factory patches and searched 128 variations for “80s electric piano,” with zero render rejections. Warm retrieval took 0.1 seconds and total search 78.21 seconds; similarity changed from 0.4213 to 0.4606. The top factory match was labeled `PHYS / TIMPANI`, which underlines the need for listening rather than score-based signoff. The diagnosis and fix follow.

## Native parity

`services/agent/scripts/clap_native_parity.py` runs LAION's own model code (laion_clap 1.1.6 `clap_module`, torchlibrosa frontend) on the same pinned checkpoint and compares embeddings. Results on Windows CPU, torch 2.15, transformers 5.23:

- Text: cosine 1.000000 for every prompt; the tensor conversion is exact.
- Audio, before: cosine 0.955–0.9999 (worst `LOFI / CHIP NOISE`). Feeding native log-mels into our encoder reproduced the same gap, the mel frontends agree within 0.007 dB, and each patch embedding gives identical output on identical input; so the difference was not the conversion.
- Cause: native LAION rounds waveforms through int16 (`float32_to_int16`/`int16_to_float32`) in `get_audio_embedding_from_data` and in its training loader. Quiet tails change visibly in dB-scale mels. With the same rounding, audio cosine is 1.000000 for every tested render.

`clap.py` now applies that rounding (preprocessing `rms-20dBFS+int16-repeatpad-v1`, part of corpus identity, so older corpora rebuild).

## Why “80s electric piano” returned PHYS / TIMPANI

Parity alone barely moved it (first electric piano 26th → 24th of 153). The timpani preset is not a general hub (79th of 153 by mean similarity to generic instrument words) and the text “timpani” does not retrieve it. Played with the fixed C-major render phrase, it is a quiet, sustained, mellow pitched tone (spectral centroid about 615 Hz, half-decay 0.41 s, peak 0.17), and its nearest renders by audio embedding are `FM6 / DRAWBARS`, `WHEEL / CHAPEL` and `FM6 / TINE EP`. Single-prompt CLAP cosine also varied a lot with wording: “an electric piano” put the first electric piano 4th, “rhodes electric piano” 14th, and “80s electric piano” 24th.

## Ranking change

`research/retrieval.py` (version `templates-7+csls-10+names-0.75/v1`) ranks with:

1. RMS loudness normalization of the embedding input (-20 dBFS), so preset level does not steer timbre; previews keep their level.
2. A seven-template prompt ensemble.
3. Hub correction (CSLS) against a fixed 39-word instrument vocabulary disjoint from all benchmark prompts.
4. A preset-name prior: CLAP text similarity between the description and the spelled-out factory name, z-scored, weight 0.75 against z-scored audio. Variations keep their factory preset and inherit its name; refinement still changes only sound.

`python -m groove_agent.research.benchmark` measures instrument-family retrieval on factory presets: for each prompt, the rank of the first preset whose name identifies the requested family. Relevance sets were written from preset names before scoring. The weight was chosen on the 8 tuning prompts (the blind-evaluation prompts); 12 held-out prompts were not used for any choice. Caveat: relevance comes from names and the prior uses names, so name-based gains are partly by construction. The benchmark detects gross family mismatches only.

| ranking (music checkpoint, 153 factory presets) | tuning top-1 | tuning relevant in top 5 | tuning MRR | held-out top-1 | held-out relevant in top 5 | held-out MRR | “80s electric piano” first relevant rank |
|---|---|---|---|---|---|---|---|
| 0c1c996: single prompt, no int16 rounding | 62% | 62% | 0.652 | 17% | 33% | 0.298 | 26 |
| single prompt, native-parity + loudness preprocessing | 62% | 62% | 0.649 | 33% | 50% | 0.448 | 25 |
| `templates-7+csls-10+names-0.75/v1` | 88% | 100% | 0.938 | 67% | 100% | 0.785 | 2 |

The new top five for “80s electric piano” is `SAMPLE / GRAND PNO`, `DIGITAL / WURLI`, `SAMPLE / DUSTY PNO`, `DIGITAL / RHODES`, `WHEEL / JAZZ ORGAN`. A piano above the Rhodes remains a family-adjacent miss. Regressions: “wooden marimba” 1 → 2 (KALIMBA first) and “vibraphone” 1 → 4 (TINE EP first). Without the name prior, no audio-only variant tested (templates, CSLS, centering, loudness, the general checkpoint, or a two-checkpoint ensemble) put an electric piano in the top three. The general checkpoint was better on tuning prompts with templates but worse on held-out prompts. Twenty prompts is a small sample.

The first ranking after a corpus rebuild embeds about 1,300 fixed texts (about 16 s on two threads); `text-embeddings.npz` beside the corpus makes later restarts about 0.1 s. A ranked query takes about 90 ms versus 20 ms before.

These checks do not establish that candidates sound right or that search beats preset-only picking. The fixed-prompt three-listener blind comparison remains required; generate kits with `evaluate` (see services/agent/README.md).
