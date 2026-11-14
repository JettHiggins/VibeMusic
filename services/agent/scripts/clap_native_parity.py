"""Compare our Transformers-mapped music CLAP with LAION's native model code, on the same weights.

Not part of the service or CI: it needs LAION's model source and torchlibrosa/librosa,
which the service does not depend on. Keep them out of the project virtualenv:

    pip download --no-deps laion_clap==1.1.6 -d <tmp>/dl
    python -m zipfile -e <tmp>/dl/laion_clap-1.1.6-py3-none-any.whl <tmp>/laion_src
    pip install --target <tmp>/laion_deps librosa==0.11.0 torchlibrosa==0.1.0
    # then delete numpy*/scipy* from <tmp>/laion_deps so the virtualenv's copies are used
    python services/agent/scripts/clap_native_parity.py <tmp>/laion_src <tmp>/laion_deps <dir of corpus WAVs>

Native preprocessing follows laion_clap.hook.get_audio_embedding_from_data (int16
round trip, repeatpad to 10 s). The native RoBERTa text tower is created from its
config instead of downloading roberta-base, because the checkpoint overwrites it.
Training-only imports (h5py, torchvision, ...) are stubbed. Run with the venv python.
"""
from __future__ import annotations

import importlib
import json
import sys
import types
import wave
from math import gcd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def main(laion_src: Path, laion_deps: Path, wav_dir: Path, limit: int = 12) -> None:
    sys.path[:0] = [str(ROOT / "services" / "agent"), str(laion_deps)]
    import numpy as np
    import torch
    import torch.nn.functional as F
    from huggingface_hub import hf_hub_download
    from scipy.signal import resample_poly
    from transformers import RobertaConfig, RobertaModel

    for name in ("h5py", "torchvision", "torchvision.ops", "torchvision.ops.misc", "timm", "wget", "ftfy"):
        sys.modules.setdefault(name, types.ModuleType(name))
    sys.modules["torchvision.ops.misc"].FrozenBatchNorm2d = torch.nn.Module
    package = types.ModuleType("clap_module")
    package.__path__ = [str(laion_src / "laion_clap" / "clap_module")]
    sys.modules["clap_module"] = package
    native_model = importlib.import_module("clap_module.model")
    native_model.RobertaModel.from_pretrained = classmethod(lambda cls, name: RobertaModel(RobertaConfig(
        vocab_size=50265, hidden_size=768, num_hidden_layers=12, num_attention_heads=12, intermediate_size=3072,
        max_position_embeddings=514, type_vocab_size=1, layer_norm_eps=1e-5, pad_token_id=1, bos_token_id=0,
        eos_token_id=2)))

    from groove_agent.research.clap import CLAP_RATE, ClapEmbedder, quantize_int16
    from groove_agent.research.clap_checkpoint import MUSIC_FILENAME, MUSIC_SOURCE, MUSIC_SOURCE_REVISION

    ours = ClapEmbedder()
    config = json.loads((laion_src / "laion_clap" / "clap_module" / "model_configs" / "HTSAT-base.json").read_text())
    config["text_cfg"]["model_type"] = "roberta"
    native = native_model.CLAP(**config, enable_fusion=False, fusion_type="None").eval()
    path = hf_hub_download(MUSIC_SOURCE, MUSIC_FILENAME, revision=MUSIC_SOURCE_REVISION)
    with torch.serialization.safe_globals([(np._core.multiarray.scalar, "numpy.core.multiarray.scalar"), np.dtype,
                                           np.dtypes.Float64DType]):
        checkpoint = torch.load(path, map_location="cpu", weights_only=True, mmap=True)
    result = native.load_state_dict({k.removeprefix("module."): v for k, v in checkpoint["state_dict"].items()},
                                    strict=False)
    # Only the deterministic text position-id buffer differs between transformers versions.
    assert not result.missing_keys and set(result.unexpected_keys) <= {"text_branch.embeddings.position_ids"}, result
    unit = lambda v: np.asarray(v, np.float64) / np.linalg.norm(v)

    def native_audio(x48):
        audio = torch.from_numpy(quantize_int16(x48)).float()
        repeats = int(480000 / len(audio))
        audio = F.pad(audio.repeat(repeats), (0, 480000 - len(audio) * repeats))
        with torch.no_grad():
            return native.get_audio_embedding([{"waveform": audio, "longer": torch.tensor(False)}])[0].numpy()

    def ours_audio(x48):
        # The model input after our preprocessing (loudness normalization is a retrieval choice
        # applied before this point; it is not part of the native comparison).
        inputs = ours._processor(audio=quantize_int16(x48), sampling_rate=CLAP_RATE, return_tensors="pt")
        with torch.no_grad():
            return ClapEmbedder._vector(ours._model.get_audio_features(**inputs))

    worst = 1.0
    for wav in sorted(wav_dir.glob("*.wav"))[:limit]:
        with wave.open(str(wav)) as handle:
            rate = handle.getframerate()
            x = np.frombuffer(handle.readframes(handle.getnframes()), "<i2").astype(np.float64) / 32767.0
        divisor = gcd(CLAP_RATE, rate)
        x48 = resample_poly(x, CLAP_RATE // divisor, rate // divisor)
        cosine = float(unit(ours_audio(x48)) @ unit(native_audio(x48)))
        worst = min(worst, cosine)
        print(f"audio {wav.stem:24s} cosine {cosine:.6f}")
    for text in ("80s electric piano", "a church organ", "deep sub bass", "breathy choir"):
        tokens = ours._processor.tokenizer(text, padding="max_length", truncation=True, max_length=77, return_tensors="pt")
        with torch.no_grad():
            reference = native.get_text_embedding(dict(tokens))[0].numpy()
        cosine = float(unit(ours.embed_text(text)) @ unit(reference))
        worst = min(worst, cosine)
        print(f"text  {text:24s} cosine {cosine:.6f}")
    print(f"worst cosine {worst:.6f}")
    if worst < 0.9999:
        raise SystemExit("parity check failed")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*(Path(arg) for arg in sys.argv[1:]))
