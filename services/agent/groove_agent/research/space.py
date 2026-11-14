"""Patch parameter space read from the engine's exported firmware metadata.

Input is the `metadata.json` that Workstream 1's `scripts/build-engine.py`
stages (shape: `FirmwareMetadata` in apps/web/src/engine/metadata.ts). Patch
parameter keys are firmware parameter IDs as decimal strings with native values
(docs/CONTRACTS.md), so parameter ID == index into a preset's parameter array.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence

# Track-level parameters that shape tone, chosen by (label, occurrence) because
# firmware labels repeat. Level, trim, arp, sequencer, scale, pan, mute and voice
# parameters are left alone so a variation never changes notes or loudness staging.
DEFAULT_TONE_LABELS: tuple[tuple[str, int], ...] = (
    ("ATK", 0), ("DEC", 0), ("SUS", 0), ("REL", 0), ("FLT", 0), ("SHP", 0),
    ("DST", 0), ("CHO", 0), ("DLY", 0), ("REV", 0), ("DTUNE", 0), ("FILT", 0),
)


class MetadataError(ValueError):
    """Engine metadata is missing or not shaped like the firmware export."""


@dataclass(frozen=True)
class Bound:
    index: int
    name: str
    lo: int
    hi: int


def _bound(index: int, descriptor: Mapping[str, Any]) -> Bound:
    try:
        lo, hi = int(descriptor["min"]), int(descriptor["max"])
        name = str(descriptor["name"])
    except (KeyError, TypeError, ValueError) as error:
        raise MetadataError(f"bad parameter descriptor at {index}: {descriptor!r}") from error
    if lo > hi:
        raise MetadataError(f"parameter {index} has min > max")
    return Bound(index, name, lo, hi)


class ParameterSpace:
    def __init__(self, metadata: Mapping[str, Any], engine_revision: str,
                 tone_labels: Sequence[tuple[str, int]] = DEFAULT_TONE_LABELS) -> None:
        try:
            offset = int(metadata["engineParamOffset"])
            common = [_bound(i, d) for i, d in enumerate(metadata["parameters"])]
            engines = list(metadata["engines"])
        except (KeyError, TypeError, ValueError) as error:
            raise MetadataError(f"engine metadata is incomplete: {error}") from error
        if len(common) != offset or not engines:
            raise MetadataError("engine metadata parameter count does not match engineParamOffset")
        self.engine_revision = engine_revision
        self.offset = offset
        self._common = common
        self._engines: list[dict] = []
        for number, engine in enumerate(engines):
            edit = [_bound(offset + i, d) for i, d in enumerate(engine["parameters"])]
            presets = []
            for preset in engine["presets"]:
                values = [int(v) for v in preset["parameters"]]
                if len(values) != offset + len(edit):
                    raise MetadataError(f"preset {preset.get('name')!r} of engine {number} has the wrong length")
                presets.append({"name": str(preset["name"]), "values": values})
            self._engines.append({"name": str(engine["name"]), "edit": edit, "presets": presets})
        seen: dict[str, int] = {}
        wanted = set(tone_labels)
        self._tone: list[Bound] = []
        for bound in common:
            occurrence = seen.get(bound.name, 0)
            seen[bound.name] = occurrence + 1
            if (bound.name, occurrence) in wanted and bound.lo < bound.hi:
                self._tone.append(bound)

    @property
    def engine_count(self) -> int:
        return len(self._engines)

    def engine_name(self, engine: int) -> str:
        return self._engines[engine]["name"]

    def bounds(self, engine: int) -> list[Bound]:
        """Bounds of every parameter of a patch on this engine, in parameter-ID order."""
        return self._common + self._engines[engine]["edit"]

    def tunable(self, engine: int) -> list[Bound]:
        """Parameters the search may vary: tone-shaping track parameters and the engine's own."""
        return self._tone + [b for b in self._engines[engine]["edit"] if b.lo < b.hi]

    def preset_patches(self) -> list[tuple[str, dict]]:
        """Every factory preset as (label, complete Patch)."""
        out = []
        for number, engine in enumerate(self._engines):
            for index, preset in enumerate(engine["presets"]):
                patch = {"engine": number, "preset": index, "engineRevision": self.engine_revision,
                         "parameters": {str(i): v for i, v in enumerate(preset["values"])}}
                out.append((f"{engine['name']} / {preset['name']}", patch))
        return out

    def problem(self, patch: Mapping[str, Any]) -> Optional[str]:
        """Why a patch is not valid for this engine build, or None."""
        if patch.get("engineRevision") != self.engine_revision:
            return "patch was made for a different engine revision"
        engine = patch.get("engine")
        if not isinstance(engine, int) or not 0 <= engine < len(self._engines):
            return "unknown engine"
        if not 0 <= patch.get("preset", -1) < len(self._engines[engine]["presets"]):
            return "unknown preset"
        bounds = self.bounds(engine)
        for key, value in patch.get("parameters", {}).items():
            if not key.isdigit() or int(key) >= len(bounds):
                return f"unknown parameter {key}"
            bound = bounds[int(key)]
            if not bound.lo <= value <= bound.hi:
                return f"parameter {key} ({bound.name}) outside {bound.lo}..{bound.hi}"
        return None

    def mutate(self, patch: Mapping[str, Any], rng: random.Random, rate: float = 0.35, scale: float = 0.12) -> dict:
        """Bounded integer variation of a patch. Engine, preset origin and untunable parameters are kept."""
        parameters = dict(patch["parameters"])
        tunable = self.tunable(patch["engine"])
        changed = False
        for bound in tunable:
            if rng.random() >= rate:
                continue
            key = str(bound.index)
            span = bound.hi - bound.lo
            step = round(rng.gauss(0.0, max(1.0, span * scale))) or rng.choice((-1, 1))
            value = min(bound.hi, max(bound.lo, int(parameters.get(key, bound.lo)) + step))
            changed = changed or value != parameters.get(key)
            parameters[key] = value
        if not changed and tunable:  # always return a real variation when one is possible
            bound = rng.choice(tunable)
            key = str(bound.index)
            current = int(parameters.get(key, bound.lo))
            parameters[key] = current + 1 if current < bound.hi else current - 1
        return {"engine": patch["engine"], "preset": patch["preset"],
                "engineRevision": patch["engineRevision"], "parameters": parameters}
