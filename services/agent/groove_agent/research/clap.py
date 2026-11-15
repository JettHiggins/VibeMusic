"""LAION CLAP embedder (PLAN.md milestone 4), run locally. No inference API calls; initial weights download uses the public model hub.

Optional: needs `requirements-research.txt` (torch, transformers, scipy) and
downloads the model weights from the Hugging Face hub into the user's cache on
first use. Weights are never stored in the repository.

Model choice: the original LAION music checkpoint is the default. The public
converted music weights failed the text-space check, so the original weights
are mapped to the Transformers architecture with strict coverage checks. The
general checkpoint is an explicit experimental comparison. Source/config
revisions, conversion and inference-library versions identify each corpus.
"""
from __future__ import annotations

import os
from math import gcd
from importlib.metadata import version
from pathlib import Path
import re

import numpy as np

from .clap_checkpoint import (MUSIC_MODEL, MUSIC_CONFIG_REVISION, MUSIC_SOURCE, MUSIC_SOURCE_REVISION,
                              MUSIC_FILENAME, CONVERSION_VERSION, load_music_model)

DEFAULT_MODEL = MUSIC_MODEL
CLAP_RATE = 48000
# Native LAION (laion_clap.hook and its training loader) rounds waveforms through int16
# before the mel frontend. Matching it gives cosine 1.000000 parity with the native model;
# skipping it shifted quiet/noisy renders by up to 0.045 cosine. Before that, renders are
# RMS-normalized so preset output level (peaks 0.17-0.55 across factory presets) does not
# drive timbre retrieval; previews keep their real level. Part of corpus identity.
PREPROCESSING = "rms-20dBFS+int16-repeatpad-v1"
TARGET_RMS_DB = -20.0


def loudness_normalize(audio: np.ndarray, target_db: float = TARGET_RMS_DB) -> np.ndarray:
    """Scale to a fixed RMS, limited so the peak stays below full scale. Silence is returned unchanged."""
    audio = np.asarray(audio, dtype=np.float64)
    rms = float(np.sqrt(np.mean(audio ** 2))) if audio.size else 0.0
    if rms <= 1e-9:
        return audio
    scaled = audio * (10 ** (target_db / 20) / rms)
    peak = float(np.abs(scaled).max())
    return scaled * (0.99 / peak) if peak > 0.99 else scaled


def quantize_int16(audio: np.ndarray) -> np.ndarray:
    """Same round trip as laion_clap's float32_to_int16/int16_to_float32."""
    audio = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    return (audio * 32767.0).astype(np.int16).astype(np.float32) / 32767.0


class DegenerateModel(RuntimeError):
    pass


class ClapEmbedder:
    def __init__(self, model_id: str = "") -> None:
        import torch
        from transformers import ClapConfig, ClapModel, ClapProcessor
        from huggingface_hub import hf_hub_download

        self._torch = torch
        model_id = model_id or os.environ.get("GROOVE_CLAP_MODEL", DEFAULT_MODEL)
        torch.set_num_threads(int(os.environ.get("GROOVE_CLAP_THREADS", "2")))
        # Pin config/tokenizer together; original music weights have their own immutable source.
        config_path = hf_hub_download(model_id, 'config.json', revision=os.environ.get("GROOVE_CLAP_REVISION", MUSIC_CONFIG_REVISION if model_id == MUSIC_MODEL else "main"))
        revision = Path(config_path).parent.name
        if not re.fullmatch(r'[0-9a-f]{40}', revision):
            raise RuntimeError('cannot identify the immutable Hugging Face model snapshot')
        config = ClapConfig.from_pretrained(model_id, revision=revision)
        self.name = (f"LAION CLAP ({model_id}@{revision or 'unversioned'}; "
                     f"transformers {version('transformers')}; torch {torch.__version__}; scipy {version('scipy')}; "
                     f"preprocessing {PREPROCESSING})")
        self._processor = ClapProcessor.from_pretrained(model_id, revision=revision)
        if model_id == MUSIC_MODEL:
            self._model = load_music_model(torch, config, ClapModel)
            self.name += (f"; original {MUSIC_SOURCE}@{MUSIC_SOURCE_REVISION}/{MUSIC_FILENAME}; "
                          f"conversion {CONVERSION_VERSION}")
        else:
            # Explicit restricted tensor loading avoids automatic conversion/PR creation.
            self._model, info = ClapModel.from_pretrained(model_id, config=config, revision=revision,
                use_safetensors=False, weights_only=True, output_loading_info=True)
            if any(info.get(key) for key in ("missing_keys", "mismatched_keys", "error_msgs")):
                raise DegenerateModel(f"{model_id} did not load a complete compatible checkpoint: {info}")
        self._model.eval()
        a, b = (self.embed_text(text) for text in ("a church organ", "wind and rain noise"))
        self._check_text_space(a, b, model_id)

    @staticmethod
    def _vector(output) -> np.ndarray:
        tensor = output if hasattr(output, "detach") else output.pooler_output  # projected joint-space embedding
        return ClapEmbedder._checked_vector(tensor.detach().cpu().numpy()[0])

    @staticmethod
    def _checked_vector(value) -> np.ndarray:
        vector = np.asarray(value, dtype=np.float64)
        if vector.ndim != 1 or vector.size == 0 or not np.all(np.isfinite(vector)) or np.linalg.norm(vector) == 0:
            raise DegenerateModel("model returned an empty, non-finite, or zero embedding")
        return vector

    @staticmethod
    def _check_text_space(a, b, model_id: str) -> None:
        a, b = (ClapEmbedder._checked_vector(value) for value in (a, b))
        if a.shape != b.shape:
            raise DegenerateModel("text embeddings have inconsistent dimensions")
        similarity = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))
        if similarity > 0.95:
            raise DegenerateModel(f"{model_id} gives indistinguishable embeddings for unrelated texts ({similarity:.3f})")

    def embed_audio(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        audio = loudness_normalize(audio)
        if sample_rate != CLAP_RATE:
            from scipy.signal import resample_poly
            divisor = gcd(CLAP_RATE, sample_rate)
            audio = resample_poly(audio.astype(np.float64), CLAP_RATE // divisor, sample_rate // divisor)
        inputs = self._processor(audio=quantize_int16(audio), sampling_rate=CLAP_RATE, return_tensors="pt")
        with self._torch.no_grad():
            return self._vector(self._model.get_audio_features(**inputs))

    def embed_text(self, text: str) -> np.ndarray:
        return self.embed_texts([text])[0]

    def embed_texts(self, texts: list[str], batch: int = 64) -> list[np.ndarray]:
        """Padded batches with attention masks give the same features as one text at a time."""
        out = []
        for start in range(0, len(texts), batch):
            inputs = self._processor(text=texts[start:start + batch], return_tensors="pt", padding=True)
            with self._torch.no_grad():
                features = self._model.get_text_features(**inputs)
            tensor = features if hasattr(features, "detach") else features.pooler_output
            out.extend(self._checked_vector(row) for row in tensor.detach().cpu().numpy())
        return out
