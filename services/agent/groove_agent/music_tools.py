"""Groove music tools: whole-song edits computed from the current session (2026-11-15 plan).

Each tool reads the browser's latest SessionState and returns ordinary operations from the shared
contract (edit-pattern, set-pitch-snap), so every result is validated by the engine and is undoable
like a hand edit. No new wire messages. Tools never invent audio or patches.

- tidy_timing: snap notes/hits to a beat grid and resolve overlaps ("fix up the timing", "clean up").
- drum_fill: write a regular pattern on one drum lane ("fill in every other hi-hat").
- transpose: move melodic notes by semitones.
- change_key: move melodic notes into another key/scale by scale degree, and set key snapping.
"""
from __future__ import annotations

import copy
import math
from typing import Any, Iterable, Mapping, Optional, Sequence

GRID_CELLS = {"sixteenth": 1, "eighth": 2, "quarter": 4}
MELODIC = ("synth-1", "synth-2", "synth-3")
LANES = ("kick", "snare", "closed-hat")
SCALES = {"major": (0, 2, 4, 5, 7, 9, 11), "minor": (0, 2, 3, 5, 7, 8, 10)}
NOTE_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")


class ToolRefusal(ValueError):
    """The request cannot be done on this session; the message says why (shown to the user)."""


def _track(session: Mapping[str, Any], track_id: str) -> dict:
    return next(t for t in session["tracks"] if t["id"] == track_id)


def _edit(track: Mapping[str, Any], notes: list, hits: list) -> dict:
    return {"type": "edit-pattern", "trackId": track["id"], "notes": notes, "hits": hits}


def _changed(track: Mapping[str, Any], notes: list, hits: list) -> bool:
    key = lambda items: sorted((sorted(i.items()) for i in items), key=str)
    return key(notes) != key(track["notes"]) or key(hits) != key(track["hits"])


def _half_up(value: float) -> int:
    """Nearest integer with halves rounded up: a note exactly between two grid lines moves later,
    consistently (Python's round() would alternate between even neighbours)."""
    return int(math.floor(value + 0.5))


def _snap(step: int, cells: int) -> int:
    return (_half_up(step / cells) * cells) % 64


def tidy_timing(session: Mapping[str, Any], track_ids: Optional[Iterable[str]] = None,
                grid: Optional[str] = None) -> list[dict]:
    """Snap note starts/lengths and drum hits to `grid` (default: the session's rhythm snap, else
    eighth notes) and resolve overlaps, on the given tracks (default: every track with content)."""
    cells = GRID_CELLS[grid or (session.get("rhythmSnap") if session.get("rhythmSnap") in ("eighth", "quarter") else "eighth")]
    ids = list(track_ids) if track_ids is not None else [t["id"] for t in session["tracks"] if t["notes"] or t["hits"]]
    operations = []
    for track_id in ids:
        track = _track(session, track_id)
        notes = []
        for note in sorted(track["notes"], key=lambda n: (n["step"], -n["duration"])):
            snapped = dict(note, step=_snap(note["step"], cells),
                           duration=max(cells, min(64, _half_up(note["duration"] / cells) * cells)))
            if notes and notes[-1]["step"] == snapped["step"]:
                continue  # two notes now start together: keep the earlier/longer one
            notes.append(snapped)
        notes.sort(key=lambda n: n["step"])
        for index, note in enumerate(notes):  # trim so no note runs into the next (wrap-aware)
            if len(notes) > 1:
                following = notes[(index + 1) % len(notes)]["step"]
                gap = (following - note["step"]) % 64 or 64
                note["duration"] = max(1, min(note["duration"], gap))
        hits: dict[tuple, dict] = {}
        for hit in track["hits"]:
            snapped = dict(hit, step=_snap(hit["step"], cells))
            key = (snapped["lane"], snapped["step"])
            if key not in hits or snapped["velocity"] > hits[key]["velocity"]:
                hits[key] = snapped
        new_hits = sorted(hits.values(), key=lambda h: (h["step"], h["lane"]))
        if _changed(track, notes, new_hits):
            operations.append(_edit(track, notes, new_hits))
    if not operations:
        raise ToolRefusal("everything is already on the beat grid; nothing to tidy")
    return operations


def drum_fill(session: Mapping[str, Any], lane: str, every: int, offset: int = 0, velocity: float = 0.8,
              replace: bool = True) -> list[dict]:
    """Hits on `lane` every `every` sixteenth cells starting at `offset` over the 4-bar loop.
    every=2 is eighth notes ("every other hi-hat"), 4 is every beat, offset=2 with every=4 is off-beats."""
    if lane not in LANES:
        raise ToolRefusal("say kick, snare or hats")
    if not 1 <= every <= 16 or not 0 <= offset < every:
        raise ToolRefusal("pattern spacing must be 1 to 16 sixteenths")
    drums = _track(session, "drums")
    kept = [h for h in drums["hits"] if h["lane"] != lane] if replace else list(drums["hits"])
    taken = {h["step"] for h in kept if h["lane"] == lane}
    new = [{"id": f"fill-{lane}-{step}", "step": step, "lane": lane, "velocity": round(min(1.0, max(0.05, velocity)), 3)}
           for step in range(offset, 64, every) if step not in taken]
    hits = sorted(kept + new, key=lambda h: (h["step"], h["lane"]))
    if not _changed(drums, drums["notes"], hits):
        raise ToolRefusal("that pattern is already there")
    return [_edit(drums, drums["notes"], hits)]


def _melodic_ids(session: Mapping[str, Any], track_ids: Optional[Iterable[str]]) -> list[str]:
    ids = [t for t in (track_ids if track_ids is not None else MELODIC) if t in MELODIC]
    ids = [t for t in ids if _track(session, t)["notes"]]
    if not ids:
        raise ToolRefusal("there are no melody notes to move yet")
    return ids


def transpose(session: Mapping[str, Any], semitones: int, track_ids: Optional[Iterable[str]] = None) -> list[dict]:
    if not -24 <= semitones <= 24 or semitones == 0:
        raise ToolRefusal("transpose by 1 to 24 semitones up or down")
    operations = []
    for track_id in _melodic_ids(session, track_ids):
        track = _track(session, track_id)
        notes = []
        for note in track["notes"]:
            moved = dict(note, midi=min(127, max(0, note["midi"] + semitones)))
            if note.get("chord"):
                moved["chord"] = [min(127, max(0, p + semitones)) for p in note["chord"]]
            notes.append(moved)
        operations.append(_edit(track, notes, track["hits"]))
    return operations


def estimate_key(session: Mapping[str, Any]) -> tuple[int, str]:
    """The key whose scale contains the most (duration-weighted) melodic pitches; ties prefer major
    and lower roots. Used only when no key is set and notes must be moved to a new key."""
    weights = [0.0] * 12
    for track_id in MELODIC:
        for note in _track(session, track_id)["notes"]:
            for pitch in [note["midi"], *(note.get("chord") or [])]:
                weights[pitch % 12] += note["duration"]
    best = max(((sum(weights[(root + i) % 12] for i in SCALES[scale]), scale == "major", -root, root, scale)
                for root in range(12) for scale in ("major", "minor")))
    return best[3], best[4]


def _map_pitch(midi: int, source: tuple[int, str], target: tuple[int, str]) -> int:
    """Same scale degree and octave in the target key; off-scale pitches keep their offset from the
    nearest lower degree. Then the octave is chosen to stay closest to the original pitch."""
    src_root, src_scale = source
    dst_root, dst_scale = target
    relative = (midi - src_root) % 12
    degrees = SCALES[src_scale]
    degree = max(i for i, interval in enumerate(degrees) if interval <= relative)
    bend = relative - degrees[degree]
    pitch_class = (dst_root + SCALES[dst_scale][degree] + bend) % 12
    lower = midi - ((midi - pitch_class) % 12)  # nearest pitch of that class at or below the original
    candidates = [c for c in (lower, lower + 12) if 0 <= c <= 127]
    return min(candidates, key=lambda c: (abs(c - midi), c)) if candidates else midi


def change_key(session: Mapping[str, Any], root: int, scale: str, move_notes: bool = True,
               track_ids: Optional[Iterable[str]] = None) -> list[dict]:
    """Set key snapping to root/scale and (by default) move existing melody notes into it by scale degree."""
    if scale not in SCALES or not 0 <= root <= 11:
        raise ToolRefusal("say a key with major or minor, for example: put it in D minor")
    operations: list[dict] = [{"type": "set-pitch-snap", "settings": {"root": root, "scale": scale}}]
    if not move_notes:
        return operations
    current = session.get("pitchSnap")
    source = (current["root"], current["scale"]) if current else estimate_key(session)
    if source == (root, scale) and current:
        raise ToolRefusal(f"the song is already in {NOTE_NAMES[root]} {scale}")
    try:
        ids = _melodic_ids(session, track_ids)
    except ToolRefusal:
        return operations  # no notes yet: just set the key for what is sung next
    for track_id in ids:
        track = _track(session, track_id)
        notes = []
        for note in track["notes"]:
            moved = dict(note, midi=_map_pitch(note["midi"], source, (root, scale)))
            if note.get("chord"):
                moved["chord"] = [_map_pitch(p, source, (root, scale)) for p in note["chord"]]
            notes.append(moved)
        operations.append(_edit(track, notes, track["hits"]))
    return operations


def key_name(root: int, scale: str) -> str:
    return f"{NOTE_NAMES[root]} {scale}"


def copy_session(session: Mapping[str, Any]) -> dict:
    return copy.deepcopy(dict(session))


# -- spoken phrases (deterministic, no model) ----------------------------------------------------

_ROOTS = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
_DRUM_LANES = {"hat": "closed-hat", "hats": "closed-hat", "hihat": "closed-hat", "hihats": "closed-hat",
               "kick": "kick", "kicks": "kick", "snare": "snare", "snares": "snare"}
_SCOPE_ALL = frozenset({"everything", "all", "whole", "entire", "beat", "song", "track", "tracks"})


def parse_key(words: Sequence[str]) -> Optional[tuple[int, str]]:
    """'d minor', 'f sharp major', 'b flat minor' -> (root, scale); None if not exactly one key."""
    roots, scales = [], {w for w in words if w in SCALES}
    for i, word in enumerate(words):
        if word in _ROOTS and (i + 1 < len(words) and (words[i + 1] in SCALES or words[i + 1] in ("sharp", "flat"))):
            shift = {"sharp": 1, "flat": -1}.get(words[i + 1], 0) if i + 1 < len(words) else 0
            roots.append((_ROOTS[word] + shift) % 12)
    return (roots[0], scales.pop()) if len(set(roots)) == 1 and len(scales) == 1 else None


def music_phrase(tokens: Sequence[str], session: Mapping[str, Any]) -> Optional[tuple[str, dict]]:
    """(tool name, args) for exact whole-song requests, or None. The connection runs the tool."""
    words = list(tokens)
    text = " ".join(words)
    if any(p in text for p in ("clean up", "cleanup", "tidy", "tighten")) or ("fix" in words and any(
            w in words for w in ("timing", "rhythm", "time"))) or ("quantize" in words or "quantise" in words):
        scope = "all" if any(w in _SCOPE_ALL for w in words) or "clean" in words else "selected"
        grid = next((g for g in GRID_CELLS if g in words or g + "s" in words), None)
        return "tidy_timing", {"scope": scope, "grid": grid}
    offbeat = "offbeat" in words or "offbeats" in words or ("off" in words and "beat" in words)
    if ("every" in words or "fill" in words or offbeat) and any(w in _DRUM_LANES for w in words):
        lane = next(_DRUM_LANES[w] for w in words if w in _DRUM_LANES)
        if "every" in words and "other" in words:
            return "drum_pattern", {"lane": lane, "every": 2, "offset": 0}
        if offbeat:
            return "drum_pattern", {"lane": lane, "every": 4, "offset": 2}
        for word, every in (("sixteenth", 1), ("sixteenths", 1), ("eighth", 2), ("eighths", 2), ("beat", 4), ("quarter", 4)):
            if word in words:
                return "drum_pattern", {"lane": lane, "every": every, "offset": 0}
        return None
    if "transpose" in words or (("up" in words or "down" in words) and any(w in words for w in ("semitone", "semitones", "octave"))):
        from .spoken_numbers import find_number
        amount = 12 if "octave" in words else find_number(words)
        if amount is None:
            return None
        return "transpose", {"semitones": int(-amount if "down" in words else amount), "scope": "all"}
    if any(w in words for w in ("put", "move", "change", "switch", "transpose", "shift")) and any(
            w in words for w in ("into", "to", "in")) and any(w in words for w in ("song", "beat", "it", "melody", "notes", "everything", "key")):
        key = parse_key(words)
        if key is not None and not (words[:1] == ["key"]):
            return "change_key", {"root": key[0], "scale": key[1], "move_notes": True}
    return None


def run_tool(name: str, args: Mapping[str, Any], session: Mapping[str, Any]) -> tuple[list[dict], str]:
    """Operations and a short label for one music tool on the given session. Raises ToolRefusal."""
    selected = session["selected"]["trackId"]
    scope = args.get("scope", "selected")
    if name == "tidy_timing":
        grid = args.get("grid")
        if grid is not None and grid not in GRID_CELLS:
            raise ToolRefusal("say sixteenth, eighth or quarter notes")
        ids = None if scope == "all" else [scope if scope in (*MELODIC, "drums") else selected]
        operations = tidy_timing(session, ids, grid)
        return operations, f"tidied timing on {len(operations)} track{'s' if len(operations) != 1 else ''}"
    if name == "drum_pattern":
        lane, every, offset = args.get("lane"), int(args.get("every", 2)), int(args.get("offset", 0))
        return drum_fill(session, lane, every, offset), f"{lane} every {every} sixteenths" + (f" from {offset}" if offset else "")
    if name == "transpose":
        semitones = int(args.get("semitones", 0))
        ids = None if scope == "all" else [scope if scope in MELODIC else selected]
        return transpose(session, semitones, ids), f"transposed {semitones:+d} semitones"
    if name == "drum_steps":
        lane, mode = args.get("lane"), args.get("mode", "replace")
        steps = list(args.get("steps") or [])
        return drum_steps(session, lane, steps, mode), f"{lane}: {mode} {len(steps)} hits"
    if name == "set_volume":
        track = args.get("track") or session["selected"]["trackId"]
        return set_volume(session, track, args.get("level"), args.get("change")), f"{track} volume"
    if name == "adjust_sound":
        track = args.get("track") or session["selected"]["trackId"]
        changes = dict(args.get("changes") or {})
        return adjust_sound(session, track, changes, bool(args.get("absolute", False))), f"{track}: " + ", ".join(changes)
    if name == "change_key":
        root, scale = int(args.get("root", -1)), args.get("scale")
        operations = change_key(session, root, scale, bool(args.get("move_notes", True)))
        return operations, f"key {key_name(root, scale)}" + (" (notes moved)" if len(operations) > 1 else "")
    raise ToolRefusal("unknown music tool")


def drum_steps(session: Mapping[str, Any], lane: str, steps: Sequence[int], mode: str = "replace",
               velocity: float = 0.8) -> list[dict]:
    """Exact drum edit on one lane: replace the lane with `steps`, add them, or remove them.
    Steps are sixteenth positions 0..63 over the 4-bar loop: (bar-1)*16 + (beat-1)*4 + (sixteenth-1)."""
    if lane not in LANES:
        raise ToolRefusal("say kick, snare or hats")
    if mode not in ("replace", "add", "remove"):
        raise ToolRefusal("drum edit must replace, add or remove")
    wanted = sorted({int(step) for step in steps})
    if any(not 0 <= step <= 63 for step in wanted):
        raise ToolRefusal("drum positions must be inside the 4-bar loop")
    drums = _track(session, "drums")
    others = [h for h in drums["hits"] if h["lane"] != lane]
    current = {h["step"]: h for h in drums["hits"] if h["lane"] == lane}
    if mode == "remove":
        lane_hits = [h for step, h in current.items() if step not in wanted]
    else:
        keep = current if mode == "add" else {s: h for s, h in current.items() if s in wanted}
        lane_hits = list(keep.values()) + [
            {"id": f"edit-{lane}-{step}", "step": step, "lane": lane, "velocity": round(min(1.0, max(0.05, velocity)), 3)}
            for step in wanted if step not in keep]
    hits = sorted(others + lane_hits, key=lambda h: (h["step"], h["lane"]))
    if not _changed(drums, drums["notes"], hits):
        raise ToolRefusal("the drums already look like that")
    return [_edit(drums, drums["notes"], hits)]


def apply_operations(session: Mapping[str, Any], operations: Sequence[Mapping[str, Any]]) -> dict:
    """The session after the given edit-pattern / set-pitch-snap operations, so several tools in one
    request build on each other instead of overwriting each other."""
    result = copy.deepcopy(dict(session))
    for operation in operations:
        if operation["type"] == "edit-pattern":
            track = _track(result, operation["trackId"])
            track["notes"], track["hits"] = copy.deepcopy(operation["notes"]), copy.deepcopy(operation["hits"])
        elif operation["type"] == "set-pitch-snap":
            result["pitchSnap"] = copy.deepcopy(operation["settings"])
        elif operation["type"] == "volume":
            _track(result, operation["trackId"])["volume"] = operation["volume"]
        elif operation["type"] == "apply-patch":
            _track(result, operation["trackId"])["patch"] = copy.deepcopy(operation["patch"])
    return result


def merge_operations(operations: Sequence[dict]) -> list[dict]:
    """Keep only the final edit-pattern per track (each carries the whole track), in first-seen order."""
    last: dict[tuple, int] = {}
    merged = ("edit-pattern", "volume", "apply-patch")  # each carries the whole value for its track
    for index, operation in enumerate(operations):
        if operation["type"] in merged:
            last[(operation["type"], operation["trackId"])] = index
    return [op for index, op in enumerate(operations)
            if op["type"] not in merged or last[(op["type"], op["trackId"])] == index]


_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")


def pitch_name(midi: int) -> str:
    return f"{_NAMES[midi % 12]}{midi // 12 - 1}"


def song_summary(session: Mapping[str, Any]) -> dict:
    """Compact view of the whole song for the language model: every drum hit and note, key and settings."""
    if not session.get("tracks"):
        return {"grid": "4 bars x 4 beats x 4 sixteenths = steps 0..63", "empty": True}
    key = session.get("pitchSnap")
    melody = {}
    for track_id in MELODIC:
        track = _track(session, track_id)
        melody[track_id] = [{"step": n["step"], "len": n["duration"], "note": pitch_name(n["midi"]),
                             **({"chord": [pitch_name(p) for p in n["chord"]]} if n.get("chord") else {})}
                            for n in sorted(track["notes"], key=lambda n: n["step"])]
    drums = _track(session, "drums")
    return {
        "grid": "4 bars x 4 beats x 4 sixteenths = steps 0..63; step = (bar-1)*16 + (beat-1)*4 + (sixteenth-1)",
        "tempo": session.get("tempo"), "key": key_name(key["root"], key["scale"]) if key else None,
        "rhythmSnap": session.get("rhythmSnap", "sixteenth"), "chordMode": session.get("chordMode", "off"),
        "selected": session.get("selected"),
        "tracks": [{"id": t["id"], "muted": t["muted"], "volume": t["volume"],
                    "sound": {"engine": t["patch"]["engine"], "preset": t["patch"]["preset"]}} for t in session["tracks"]],
        "drums": {lane: sorted(h["step"] for h in drums["hits"] if h["lane"] == lane) for lane in LANES},
        "melody": melody,
    }


# -- mixing and sound shaping ("mastering" by voice) ---------------------------------------------

# Friendly name -> engine parameter id (apps/web/public/engine/metadata.json). Level/mute/pattern ids are
# session-owned (track volume/mute), so loudness uses set_volume instead.
SOUND_CONTROLS = {"brightness": 5, "attack": 1, "decay": 2, "sustain": 3, "release": 4, "drive": 33,
                  "chorus": 34, "delay": 35, "reverb": 36, "pan": 39, "glide": 38}
TRACKS = (*MELODIC, "drums")
_METADATA: Optional[dict] = None


def engine_metadata() -> dict:
    global _METADATA
    if _METADATA is None:
        import json
        from .contracts import contracts_dir
        path = contracts_dir().parents[1] / "apps" / "web" / "public" / "engine" / "metadata.json"
        if not path.is_file():
            raise ToolRefusal("sound controls need the engine build in apps/web/public/engine")
        _METADATA = json.loads(path.read_text(encoding="utf-8"))
    return _METADATA


def set_volume(session: Mapping[str, Any], track: str, level: Optional[float] = None,
               change: Optional[float] = None) -> list[dict]:
    """Track volume as percent: an absolute level 0..100, or a change -100..100 from the current level.
    Immediate, so it works while playing or recording."""
    if track not in TRACKS:
        raise ToolRefusal("say synth one, two or three, or drums")
    current = float(_track(session, track)["volume"])
    if level is not None:
        target = float(level) / 100
    elif change is not None:
        target = current + float(change) / 100
    else:
        raise ToolRefusal("say how loud, for example: drums to 80 percent")
    target = round(min(1.0, max(0.0, target)), 3)
    if abs(target - current) < 0.005:
        raise ToolRefusal(f"{track} is already at {round(current * 100)} percent")
    return [{"type": "volume", "trackId": track, "volume": target}]


def adjust_sound(session: Mapping[str, Any], track: str, changes: Mapping[str, float], absolute: bool = False) -> list[dict]:
    """Shape a synth track's current sound. Each change is percent of that control's range: relative
    -100..100 (default) or an absolute 0..100 position. Keeps the sound otherwise unchanged (apply-patch)."""
    if track not in MELODIC:
        raise ToolRefusal("sound shaping works on the three synth tracks; use volume for the drums")
    unknown = [name for name in changes if name not in SOUND_CONTROLS]
    if unknown or not changes:
        raise ToolRefusal("sound controls are " + ", ".join(SOUND_CONTROLS))
    metadata = engine_metadata()
    patch = copy.deepcopy(_track(session, track)["patch"])
    preset = metadata["engines"][patch["engine"]]["presets"][patch["preset"]]["parameters"]
    parameters = dict(patch.get("parameters") or {})
    for name, amount in changes.items():
        index = SOUND_CONTROLS[name]
        descriptor = metadata["parameters"][index]
        low, high = descriptor["min"], descriptor["max"]
        current = parameters.get(str(index), preset[index] if index < len(preset) else descriptor["default"])
        span = high - low
        value = low + float(amount) / 100 * span if absolute else current + float(amount) / 100 * span
        parameters[str(index)] = int(round(min(high, max(low, value))))
    if parameters == dict(patch.get("parameters") or {}):
        raise ToolRefusal("that control is already at its limit")
    patch["parameters"] = parameters
    return [{"type": "apply-patch", "trackId": track, "patch": patch}]
