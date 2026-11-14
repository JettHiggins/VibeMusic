"""LAION CLAP embedder (PLAN.md milestone 4), run locally. No API key or provider call.

Optional: needs `requirements-research.txt` (torch, transformers, scipy) and
downloads the model weights from the Hugging Face hub into the user's cache on
first use. Weights are never stored in the repository.

Model choice: PLAN.md names the CLAP *music* checkpoint. Its Hugging Face port
(`laion/larger_clap_music`) loaded without errors here but produced degenerate
embeddings (every text identical, audio-text similarity near zero) with
transformers 5.23, so the default is the general checkpoint
`laion/clap-htsat-unfused`, which gave sensible audio-text similarities on real
SLOOP renders. `GROOVE_CLAP_MODEL` selects another model; a degenerate one is
refused at start-up rather than allowed to rank patches at random.
"""
from __future__ import annotations

import os
from math import gcd

import numpy as np

DEFAULT_MODEL = "laion/clap-htsat-unfused"
CLAP_RATE = 48000


class DegenerateModel(RuntimeError):
    pass


class ClapEmbedder:
    def __init__(self, model_id: str = "") -> None:
        import torch
        from transformers import ClapModel, ClapProcessor

        self._torch = torch
        model_id = model_id or os.environ.get("GROOVE_CLAP_MODEL", DEFAULT_MODEL)
        self.name = f"LAION CLAP ({model_id})"
        self._processor = ClapProcessor.from_pretrained(model_id)
        # Safetensors only: never unpickle downloaded weights.
        self._model = ClapModel.from_pretrained(model_id, use_safetensors=True).eval()
        a, b = (self.embed_text(text) for text in ("a church organ", "wind and rain noise"))
        similarity = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))
        if similarity > 0.95:
            raise DegenerateModel(f"{model_id} gives the same embedding for unrelated texts ({similarity:.3f}); "
                                  "its weights are not usable with this transformers version")

    @staticmethod
    def _vector(output) -> np.ndarray:
        tensor = output if hasattr(output, "detach") else output.pooler_output  # projected joint-space embedding
        return tensor.detach().cpu().numpy()[0].astype(np.float64)

    def embed_audio(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        if sample_rate != CLAP_RATE:
            from scipy.signal import resample_poly
            divisor = gcd(CLAP_RATE, sample_rate)
            audio = resample_poly(audio.astype(np.float64), CLAP_RATE // divisor, sample_rate // divisor)
        inputs = self._processor(audio=np.asarray(audio, dtype=np.float32), sampling_rate=CLAP_RATE, return_tensors="pt")
        with self._torch.no_grad():
            return self._vector(self._model.get_audio_features(**inputs))

    def embed_text(self, text: str) -> np.ndarray:
        inputs = self._processor(text=[text], return_tensors="pt", padding=True)
        with self._torch.no_grad():
            return self._vector(self._model.get_text_features(**inputs))
