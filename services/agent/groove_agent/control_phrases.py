"""Exact spoken key and browser-input phrases (MUSICAL-CONTROL-CONTRACT.md).

Deterministic and provider-free, so they keep working while a language provider is rate
limited. Ambiguous roots, scales or tracks refuse instead of guessing. Browser input actions
are returned as `InputAction`; the connection checks the browser's advertised status and
sends a `browser-action` (never a SessionCommand), then waits for its real acknowledgment.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence

from .spoken_numbers import find_number

_ROOTS = {"c": 0, "see": 0, "sea": 0, "d": 2, "dee": 2, "e": 4, "f": 5, "eff": 5, "g": 7, "gee": 7,
          "a": 9, "b": 11, "bee": 11}
_FLAT_ROOTS = {"bb": 10, "eb": 3, "ab": 8, "db": 1, "gb": 6}  # "Bb major" as recognizers write it
_SCALES = {"major": "major", "minor": "minor"}
_SNAP_WORDS = frozenset({"snapping", "snap", "scale", "key"})
_OFF = frozenset({"off", "disable", "disabled", "none"})
_KEY_HELP = "say a key with major or minor, for example: key D minor"


@dataclass(frozen=True)
class InputAction:
    """A browser-local input operation (BrowserOperation). `cancel-input-action` is completed with
    the browser's current active action ID by the connection."""
    operation: dict


def _root(tokens: Sequence[str]) -> tuple[Optional[int], Optional[str]]:
    found: list[int] = []
    for index, token in enumerate(tokens):
        value = _FLAT_ROOTS.get(token)
        if value is None and token in _ROOTS:
            value = _ROOTS[token]
            following = tokens[index + 1] if index + 1 < len(tokens) else ""
            if following == "sharp":
                value += 1
            elif following == "flat":
                value -= 1
        if value is not None:
            found.append(value % 12)
    if len(set(found)) > 1:
        return None, "say one key root at a time"
    return (found[0], None) if found else (None, _KEY_HELP)


def key_phrase(verb: str, rest: Sequence[str], session: Mapping[str, Any], target) -> Optional[Any]:
    """`set-pitch-snap` / `snap-notes` as (operation, None) or (None, refusal); None if not a key phrase."""
    tokens = [verb, *rest]
    if verb in ("snap", "quantize", "quantise") and any(word in rest for word in ("notes", "note", "existing", "melody", "track")):
        resolved = target(list(rest))
        if resolved is None or resolved.get("trackId") not in ("synth-1", "synth-2", "synth-3"):
            selected = session.get("selected") or {}
            explicit = any(word in rest for word in ("synth", "drums", "kick", "snare", "hats", "hat"))
            if explicit or selected.get("trackId") not in ("synth-1", "synth-2", "synth-3"):
                return None, "say which synth to snap, for example: snap the existing notes on synth two"
            resolved = {"trackId": selected["trackId"]}
        if not session.get("pitchSnap"):
            return None, "choose a key first, for example: key D minor"
        return {"type": "snap-notes", "trackId": resolved["trackId"]}, None
    if not any(word in tokens for word in _SNAP_WORDS):
        return None
    words = [w for w in tokens if w not in ("turn", "set", "the", "to", "change", "use", "please", "in", "on")]
    if any(word in words for word in _OFF) and not any(w in words for w in _SCALES):
        if not words or words[0] not in ("key", "snapping", "snap", "scale", "pitch"):
            return None
        return {"type": "set-pitch-snap", "settings": None}, None
    if words[:1] != ["key"] and words[:2] != ["scale", "key"]:
        return None
    scales = {_SCALES[w] for w in words if w in _SCALES}
    root, problem = _root(words[1:])
    if root is None:
        return None, problem
    if len(scales) != 1:
        return None, _KEY_HELP
    return {"type": "set-pitch-snap", "settings": {"root": root, "scale": scales.pop()}}, None


_CALIBRATION_WORDS = frozenset({"calibrate", "calibration", "calibrating", "recalibrate"})
_NOISE_WORDS = frozenset({"noise", "silence", "room", "quiet", "floor"})
_TIMING_WORDS = frozenset({"timing", "latency", "delay", "offset"})
_FULL_FILLER = frozenset({"the", "input", "microphone", "mic", "everything", "all", "my", "both", "again", "and"})


def input_phrase(verb: str, rest: Sequence[str]) -> Optional[Any]:
    """BrowserOperation as (InputAction, None) or (None, refusal); None if not an input phrase."""
    tokens = [verb, *rest]
    if verb in ("cancel", "stop", "abort", "end") and any(w in _CALIBRATION_WORDS or w == "input" for w in rest):
        return InputAction({"type": "cancel-input-action"}), None
    if verb in ("check", "test", "verify") and any(w in _TIMING_WORDS for w in rest):
        return InputAction({"type": "calibrate-input", "mode": "check-timing"}), None
    measuring = verb in ("measure", "remeasure") or verb in _CALIBRATION_WORDS
    if measuring:
        noise = any(w in _NOISE_WORDS for w in rest)
        timing = any(w in _TIMING_WORDS for w in rest)
        if noise != timing:
            return InputAction({"type": "calibrate-input", "mode": "noise" if noise else "timing"}), None
        if verb not in _CALIBRATION_WORDS:
            return None
        if not noise and any(w not in _FULL_FILLER for w in rest):
            return None, "say calibrate, calibrate noise, or calibrate timing"
        return InputAction({"type": "calibrate-input", "mode": "full"}), None
    if "profile" in tokens or "mode" in tokens or verb in ("switch", "use"):
        profile = ("noisy-room" if "noisy" in tokens or ("noise" in tokens and "room" in tokens) else
                   "music" if "music" in tokens or "studio" in tokens else None)
        if profile is not None and ("profile" in tokens or "mode" in tokens or "room" in tokens):
            return InputAction({"type": "set-input-profile", "profile": profile}), None
        if "profile" in tokens:
            return None, "say noisy room profile or music profile"
        return None
    if "offset" in tokens and verb in ("set", "offset", "trim", "adjust", "change"):
        number = find_number(tokens)
        if number is None or not float(number).is_integer():
            return None, "say an offset in whole milliseconds, for example: set offset to minus 20 milliseconds"
        value = int(number)
        if any(w in tokens for w in ("minus", "negative", "earlier")):
            value = -abs(value)
        if not -150 <= value <= 150:
            return None, "offset must be between minus 150 and 150 milliseconds"
        return InputAction({"type": "set-input-offset", "milliseconds": value}), None
    return None
