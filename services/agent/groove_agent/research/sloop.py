"""Offline renderer that runs the pinned SLOOP engine: the same WASM the browser loads.

It needs the engine assets staged by `scripts/build-engine.py` (voicesynth.wasm
and metadata.json in apps/web/public/engine/). Track setup mirrors
`firmwareSnapshot` in apps/web/src/engine/snapshot.ts so a patch sounds here the
way it will in the browser: session-owned parameters are forced to the same
values, and the FM6 voice is loaded from the factory bank by its slot parameter.

Each render uses a fresh engine instance, so renders are independent and
repeatable. Notes are played through the engine's live note input at its fixed
input velocity; recipe velocities are not applied.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

import numpy as np

from .audio import RenderRecipe

SESSION_VOLUME = 0.7  # createSession() default in packages/contracts
SETTLE_BLOCKS = 8     # lets a requested engine change take effect before the first note


class SloopRenderer:
    name = "SLOOP WASM offline"

    def __init__(self, wasm_path: Path, metadata: Mapping[str, Any], engine_revision: str, track: int = 0) -> None:
        import wasmtime  # imported here so the rest of the service works without the optional dependency

        self._wasmtime = wasmtime
        self._engine = wasmtime.Engine()
        self._module = wasmtime.Module.from_file(self._engine, str(wasm_path))
        if self._module.imports:
            raise ValueError("engine WASM has unexpected imports; it must be the standalone DSP build")
        self._metadata = metadata
        self._offset = int(metadata["engineParamOffset"])
        self.engine_revision = engine_revision
        self.sample_rate = int(metadata["sampleRate"])
        self._track = track

    @classmethod
    def from_directory(cls, directory: Path, engine_revision: str) -> "SloopRenderer":
        metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
        return cls(directory / "voicesynth.wasm", metadata, engine_revision)

    def _parameters(self, patch: Mapping[str, Any]) -> list[int]:
        engine = self._metadata["engines"][patch["engine"]]
        values = [int(v) for v in engine["presets"][patch["preset"]]["parameters"]]
        for key, value in patch["parameters"].items():
            values[int(key)] = int(value)
        # Session-owned parameters, exactly as firmwareSnapshot sets them.
        values[0] = round(SESSION_VOLUME * 127)
        values[17], values[29], values[30], values[31], values[32], values[40] = 0, 64, 2, 0, 127, 0
        return values

    def render(self, patch: dict, recipe: RenderRecipe) -> np.ndarray:
        if patch["engineRevision"] != self.engine_revision:
            raise ValueError("patch was made for a different engine revision")
        wasmtime = self._wasmtime
        store = wasmtime.Store(self._engine)
        exports = wasmtime.Instance(store, self._module, []).exports(store)

        def call(name: str, *args: int) -> Any:
            return exports[name](store, *args)

        if "_initialize" in exports:
            call("_initialize")
        call("preview_init")
        memory = exports["memory"]
        frames = call("preview_frames")
        if call("preview_rate") != self.sample_rate:
            raise ValueError("engine sample rate does not match its metadata")

        defaults = [int(g["default"]) for g in self._metadata["globals"]]
        defaults[0], defaults[1], defaults[2], defaults[13] = 120, 0, 0, 0  # tempo, no swing, no click, as the browser
        for index, value in enumerate(defaults):
            call("preview_global", index, value)
        call("preview_select", self._track, 0)

        values = self._parameters(patch)
        call("preview_track", self._track, patch["engine"], patch["preset"])
        for index, value in enumerate(values):
            call("preview_param", self._track, index, value)
        factory = self._metadata.get("fm6Factory") or []
        if factory:
            slot = values[self._offset + 7]
            voice = bytes(factory[slot] if 0 <= slot < len(factory) else factory[0])
            memory.write(store, voice, call("preview_buffer"))
            call("preview_fm6", self._track)

        total = int(recipe.seconds * self.sample_rate)
        events = sorted([(int(start * self.sample_rate), 1, midi) for start, _, midi, _ in recipe.notes]
                        + [(int((start + length) * self.sample_rate), 0, midi) for start, length, midi, _ in recipe.notes])
        for _ in range(SETTLE_BLOCKS):
            call("preview_render")
        out = np.zeros(total + frames, dtype=np.float32)
        position = 0
        while position < total:
            while events and events[0][0] <= position:
                _, on, midi = events.pop(0)
                call("preview_note", self._track, midi, on)
            pointer = call("preview_render")
            block = np.frombuffer(memory.read(store, pointer, pointer + frames * 8), dtype="<f4")
            out[position:position + frames] = (block[0::2] + block[1::2]) * 0.5
            position += frames
        return out[:total]
