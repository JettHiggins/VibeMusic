"""Engine-owned implementation of Workstream 3's research.audio.Renderer protocol.

Uses the real browser WASM and its validation; no toy synth, normalization, or API calls.
Run from the repository root with Node 22+, npm ci, and built engine assets.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from groove_agent.research.audio import RenderRecipe

ENGINE_REVISION = 'bac9c05ea7627449405aa10e48da21d75b6c8c56'
ROOT = Path(__file__).resolve().parents[1]


class SloopRenderer:
    engine_revision = ENGINE_REVISION
    sample_rate = 44100

    def __init__(self, assets: Path | None = None, node: str = 'node', timeout: float = 30.0):
        self.assets = (assets or ROOT / 'apps/web/public/engine').resolve()
        self.node = node
        self.timeout = timeout
        wasm = self.assets / 'voicesynth.wasm'
        if not wasm.is_file():
            raise FileNotFoundError('Build SLOOP assets: python3 scripts/build-engine.py --docker --test')
        digest = hashlib.sha256(wasm.read_bytes() + (self.assets / 'metadata.json').read_bytes()).hexdigest()
        self.name = f'SLOOP WASM {self.engine_revision}; artifact sha256:{digest}'

    def render(self, patch: dict, recipe: RenderRecipe) -> np.ndarray:
        request = json.dumps({'patch': patch, 'recipe': recipe.to_json()}, allow_nan=False).encode('utf8')
        env = {**os.environ, 'GROOVE_ENGINE_ASSETS': str(self.assets)}
        result = subprocess.run([self.node, '--import', 'tsx', 'tools/render-patch.ts'], cwd=ROOT,
                                input=request, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=self.timeout, env=env, check=False)
        if result.returncode:
            raise ValueError('SLOOP render failed: ' + result.stderr.decode('utf8', errors='replace')[:2000])
        expected = round(recipe.seconds * self.sample_rate)
        if len(result.stdout) != expected * 4:
            raise ValueError('SLOOP renderer returned an unexpected frame count')
        audio = np.frombuffer(result.stdout, dtype='<f4').copy()
        if not np.all(np.isfinite(audio)):
            raise ValueError('SLOOP renderer returned non-finite samples')
        return audio
