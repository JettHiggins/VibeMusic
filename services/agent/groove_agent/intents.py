"""Deterministic transcript -> SessionCommand operation mapping for the first voice slice.

No model or network call happens here, so ordinary commands are acknowledged
without waiting on a language provider. A Deep Agents interpreter can replace
`interpret` later behind the same signature; anything it proposes still goes
through `validate_operation` and the browser's own validation.

Rules follow PLAN.md: normal speech outside recording; during recording a
command must begin with the wake word "Groove". "Groove, stop" stops recording;
"Groove, stop playback" stops the transport.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Sequence, Union

from .spoken_numbers import find_number

WAKE_WORDS = frozenset({"groove", "grove"})  # "grove" is a common recognizer spelling
TEMPO_MIN, TEMPO_MAX, TEMPO_NUDGE = 40, 240, 10
MELODIC_TRACKS = ("synth-1", "synth-2", "synth-3")

# Boundaries follow docs/CONTRACTS.md "Command lifecycle" as amended by RECORDING-USABILITY.md
# (PR #12): Record arms at the next beat (one-bar count-in from stopped); Clear and Undo apply
# immediately, also during playback/capture. Tempo and apply-patch stay next-loop.
BOUNDARY = {
    "select": "immediate",
    "stop-recording": "immediate",
    "mute": "immediate",
    "play": "immediate",
    "record": "next-beat",
    "tempo": "next-loop",
    "clear": "immediate",
    "undo": "immediate",
    "apply-patch": "next-loop",
}

_LANE_PHRASES = (
    ("closed-hat", ("closed hi hats", "closed hi hat", "closed hats", "closed hat", "hi hats", "hi hat",
                    "high hats", "high hat", "hihats", "hihat", "hats", "hat")),
    ("kick", ("kick drum", "bass drum", "kick")),
    ("snare", ("snare drum", "snare")),
)
_ORDINALS = {"1": 1, "one": 1, "won": 1, "first": 1, "2": 2, "two": 2, "too": 2, "to": 2, "second": 2,
             "3": 3, "three": 3, "third": 3}
_POLITE = frozenset({"please", "hey", "ok", "okay", "now", "the", "a", "an", "my", "can", "could", "you", "lets", "let", "us"})
_STOP_PLAYBACK_WORDS = frozenset({"playback", "playing", "play", "transport", "music", "everything", "loop"})


@dataclass(frozen=True)
class Command:
    """A recognized command, ready to be wrapped in a SessionCommand."""
    operation: dict
    boundary: str


@dataclass(frozen=True)
class Ignored:
    """Speech during recording without the wake word: treated as performance, not a command."""


@dataclass(frozen=True)
class NotUnderstood:
    reason: str


@dataclass(frozen=True)
class SoundSearch:
    """A spoken sound description. `refine` builds on the candidates of the previous search."""
    description: str
    refine: bool = False


@dataclass(frozen=True)
class AcceptCandidate:
    index: int  # 1-based position in the latest candidate list


@dataclass(frozen=True)
class AuditionCandidate:
    index: int  # 1-based, resolved to an exact ID by the connection


@dataclass(frozen=True)
class CancelSearch:
    pass


Interpretation = Union[Command, Ignored, NotUnderstood, SoundSearch, AcceptCandidate, AuditionCandidate, CancelSearch]


def tokenize(text: str) -> list[str]:
    text = text.lower().replace("-", " ").replace("'", "")
    return re.findall(r"\d+\.\d+|[a-z0-9]+", text)


def _contains(tokens: Sequence[str], phrase: str) -> bool:
    words = phrase.split()
    return any(list(tokens[i:i + len(words)]) == words for i in range(len(tokens) - len(words) + 1))


def _selected(session: Mapping[str, Any]) -> dict:
    return dict(session["selected"])


def find_target(tokens: Sequence[str], session: Mapping[str, Any]) -> Optional[dict]:
    """Return the Target named in tokens, or None when no target is named."""
    for lane, phrases in _LANE_PHRASES:
        if any(_contains(tokens, phrase) for phrase in phrases):
            return {"trackId": "drums", "lane": lane}
    for index, token in enumerate(tokens[:-1]):
        if token in ("synth", "synthesizer", "track", "melody") and tokens[index + 1] in _ORDINALS:
            return {"trackId": f"synth-{_ORDINALS[tokens[index + 1]]}"}
    if "drums" in tokens or _contains(tokens, "drum track"):
        return {"trackId": "drums"}
    if "melody" in tokens or "synth" in tokens:
        current = session["selected"]["trackId"]
        return {"trackId": current if current in MELODIC_TRACKS else "synth-1"}
    return None


def _needs_lane(target: Mapping[str, Any]) -> Optional[str]:
    if target["trackId"] == "drums" and "lane" not in target:
        return "say which drum: kick, snare, or hats"
    return None


def _command(operation: dict) -> Command:
    return Command(operation, BOUNDARY[operation["type"]])


def _tempo(tokens: Sequence[str], session: Mapping[str, Any]) -> Interpretation:
    current = float(session["tempo"])
    if any(word in tokens for word in ("faster", "quicker")) or _contains(tokens, "speed up"):
        bpm: Optional[float] = min(TEMPO_MAX, current + TEMPO_NUDGE)
    elif "slower" in tokens or _contains(tokens, "slow down"):
        bpm = max(TEMPO_MIN, current - TEMPO_NUDGE)
    else:
        bpm = find_number(tokens)
        if bpm is None:
            return NotUnderstood("say a tempo, for example: tempo 120")
        if not TEMPO_MIN <= bpm <= TEMPO_MAX:
            return NotUnderstood(f"tempo must be between {TEMPO_MIN} and {TEMPO_MAX} BPM")
    if bpm == current:
        return NotUnderstood(f"tempo is already {bpm:g} BPM")
    return _command({"type": "tempo", "bpm": int(bpm) if float(bpm).is_integer() else bpm})


def interpret(text: str, session: Mapping[str, Any], during_recording: bool, take_armed: bool = False) -> Interpretation:
    """Map one utterance transcript to a command, using the browser's latest session snapshot.

    `take_armed`: a Record is counting in (not yet capturing). "Stop recording" then cancels
    the armed take with stop-recording, which keeps playback (RECORDING-USABILITY.md, Issue #3 e).
    """
    tokens = tokenize(text)
    while tokens and tokens[0] in _POLITE:
        tokens = tokens[1:]
    has_wake = bool(tokens) and tokens[0] in WAKE_WORDS
    if has_wake:
        tokens = tokens[1:]
    elif during_recording:
        return Ignored()
    while tokens and tokens[0] in _POLITE:
        tokens = tokens[1:]
    while tokens and tokens[-1] in _POLITE:
        tokens = tokens[:-1]
    if not tokens:
        return NotUnderstood("no command heard")
    verb, rest = tokens[0], tokens[1:]

    if verb == "undo":
        return _command({"type": "undo"})

    if verb in ("stop", "end", "finish", "pause"):
        if any(word in _STOP_PLAYBACK_WORDS for word in rest):
            return _command({"type": "play", "playing": False})
        if "recording" in rest or "record" in rest:
            if not (during_recording or take_armed):
                return NotUnderstood("not recording")
            return _command({"type": "stop-recording"})
        if rest:
            return NotUnderstood("say stop, stop recording, or stop playback")
        if during_recording or take_armed:
            return _command({"type": "stop-recording"})
        return _command({"type": "play", "playing": False})

    if verb == "record" or (verb in ("start", "begin") and ("recording" in rest or "record" in rest)):
        target = find_target(rest, session) or _selected(session)
        problem = _needs_lane(target)
        return NotUnderstood(problem) if problem else _command({"type": "record", "target": target})

    if verb in ("play", "start", "resume") and (not rest or rest in (["playback"], ["playing"], ["music"], ["it"])):
        return _command({"type": "play", "playing": True})

    if ("tempo" in tokens or "bpm" in tokens or verb in ("faster", "slower", "quicker")
            or _contains(tokens, "speed up") or _contains(tokens, "slow down")
            or (verb in ("make", "go") and any(word in rest for word in ("faster", "slower", "quicker")))):
        return _tempo(tokens, session)

    if verb in ("clear", "erase", "delete", "wipe"):
        return _command({"type": "clear", "target": find_target(rest, session) or _selected(session)})

    if verb in ("mute", "unmute", "silence"):
        target = find_target(rest, session) or {"trackId": session["selected"]["trackId"]}
        if "lane" in target and rest:
            return NotUnderstood("single drums cannot be muted; say mute drums")
        return _command({"type": "mute", "trackId": target["trackId"], "muted": verb != "unmute"})

    if verb in ("select", "choose", "pick") or (verb in ("switch", "go", "change") and rest[:1] == ["to"]):
        target = find_target(rest, session)
        if target is None:
            return NotUnderstood("say what to select: kick, snare, hats, or synth one, two, or three")
        problem = _needs_lane(target)
        return NotUnderstood(problem) if problem else _command({"type": "select", "target": target})

    return _sound_intent(verb, rest) or NotUnderstood("command not recognized")


_CANDIDATE_ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5}
_DESCRIPTION_LEADS = (("make", "it", "sound", "like"), ("make", "this", "sound", "like"), ("sound", "like"),
                      ("sounds", "like"), ("i", "want"), ("i", "need"), ("id", "like"), ("give", "me"),
                      ("find", "me"), ("find",), ("search", "for"), ("look", "for"))


def _describe(tokens: Sequence[str]) -> str:
    words = list(tokens)
    while words and words[0] in ("a", "an", "the", "some", "something", "like"):
        words = words[1:]
    while words and words[-1] in ("sound", "sounds", "patch", "tone"):
        words = words[:-1]
    return " ".join(words)


def _sound_intent(verb: str, rest: Sequence[str]) -> Optional[Interpretation]:
    tokens = [verb, *rest]
    if verb in ("audition", "preview", "hear", "listen"):
        for token in rest:
            if token in _CANDIDATE_ORDINALS:
                return AuditionCandidate(_CANDIDATE_ORDINALS[token])
        number = find_number(rest)
        if number is not None:
            return (AuditionCandidate(int(number)) if float(number).is_integer() and 1 <= number <= 5
                    else NotUnderstood("say candidate one through five to audition"))
        if not rest or all(word in {"to", "it", "this", "that", "one", "candidate", "sound"} for word in rest):
            return AuditionCandidate(1)
        return NotUnderstood("say audition candidate two, for example")
    if verb == "cancel":
        return CancelSearch()
    if verb in ("accept", "keep", "use", "take", "apply"):
        for token in rest:
            if token in _CANDIDATE_ORDINALS:
                return AcceptCandidate(_CANDIDATE_ORDINALS[token])
        number = find_number(rest)
        if number is not None and (number < 1 or not float(number).is_integer()):
            return NotUnderstood("say which candidate, for example: use number two")
        return AcceptCandidate(int(number) if number is not None else 1)
    for lead in _DESCRIPTION_LEADS:
        if tuple(tokens[:len(lead)]) == lead:
            description = _describe(tokens[len(lead):])
            return SoundSearch(description) if description else NotUnderstood("describe the sound you want")
    if verb == "refine" or (verb == "make" and list(rest[:1]) in (["it"], ["this"], ["that"])):
        description = _describe(rest if verb == "refine" else rest[1:])
        return SoundSearch(description, refine=True) if description else NotUnderstood("say how to change the sound")
    if verb in ("more", "less", "brighter", "darker", "warmer", "softer", "harder", "punchier"):
        return SoundSearch(" ".join(tokens), refine=True)
    return None


def validate_operation(operation: Mapping[str, Any]) -> Optional[str]:
    """Semantic rules the structural schema cannot express. Returns a reason, or None when acceptable.

    Applied to every proposed operation regardless of which interpreter produced it.
    """
    kind = operation.get("type")
    if kind not in BOUNDARY:
        return f"unknown operation {kind!r}"
    target = operation.get("target")
    if kind in ("select", "record") and target is not None:
        if target["trackId"] == "drums" and "lane" not in target:
            return "drum selection and recording require a lane"
    if target is not None and target["trackId"] != "drums" and "lane" in target:
        return "melodic targets must not have a lane"
    return None
