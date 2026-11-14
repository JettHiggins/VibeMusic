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
    # Playtest repair (docs/PLAYTEST-REPAIR-CONTRACT.md): both are immediate-only.
    "metronome": "immediate",
    "erase-event": "immediate",
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
class CancelSearch:
    pass


Interpretation = Union[Command, Ignored, NotUnderstood, SoundSearch, AcceptCandidate, CancelSearch]


def tokenize(text: str) -> list[str]:
    text = text.lower().replace("-", " ").replace("'", "")
    return re.findall(r"\d+\.\d+|[a-z0-9]+", text)


def _contains(tokens: Sequence[str], phrase: str) -> bool:
    words = phrase.split()
    return any(list(tokens[i:i + len(words)]) == words for i in range(len(tokens) - len(words) + 1))


def _selected(session: Mapping[str, Any]) -> dict:
    return dict(session["selected"])


# Recognizers in noisy rooms turn "synth two" into "sent two", "since three", "syn two"...
# These count as "synth" only when a track number follows, so ordinary words keep their meaning.
_SYNTH_WORDS = frozenset({"synth", "synthesizer", "track", "melody"})
_SYNTH_MISHEARINGS = frozenset({"synths", "syn", "sin", "sent", "send", "cent", "since", "sense", "scent"})
_TRACK_NUMBERS = {**_ORDINALS, "tree": 3}


# Number words that only ever mean a number. "to"/"too"/"for"/"won" count as numbers only
# right after a synth word ("synth to"), so "switch to synth two" keeps its "to".
_PLAIN_NUMBERS = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
                  "eight": 8, "nine": 9, "ten": 10}
_UNRESOLVED_TARGET = "didn't catch which track; say synth one, two or three, or kick, snare or hats"
_INVALID_SYNTH = "there are only synths one, two and three"
_SEVERAL_TARGETS = "say one track at a time"


def _number(token: str, after_synth: bool = False) -> Optional[int]:
    if token.isdigit():
        return int(token)
    if token in _PLAIN_NUMBERS:
        return _PLAIN_NUMBERS[token]
    return _TRACK_NUMBERS.get(token) if after_synth else None


@dataclass(frozen=True)
class TargetResolution:
    target: Optional[dict]  # None: nothing track-like was said (callers may use the selection)
    problem: Optional[str] = None  # set: invalid, conflicting or unresolved; never mutate
    used: frozenset = frozenset()  # token indices that named the target


def resolve_target(tokens: Sequence[str], session: Mapping[str, Any], ignore: frozenset = frozenset()) -> TargetResolution:
    """Every track mention in `tokens` (except indices in `ignore`), checked together.

    Invalid numbered synths ("synth four"), two different targets ("kick and snare", "synth two
    and synth three") and leftover numbers are problems, so the caller refuses instead of
    falling back to the selection. A bare "synth"/"melody" still means the current synth.
    """
    used: set[int] = set(ignore)
    found: list[dict] = []
    for lane, phrases in _LANE_PHRASES:
        for phrase in phrases:  # longest first within a lane
            words = phrase.split()
            for i in range(len(tokens) - len(words) + 1):
                span = set(range(i, i + len(words)))
                if list(tokens[i:i + len(words)]) == words and not span & used:
                    used |= span
                    found.append({"trackId": "drums", "lane": lane})
    for i, token in enumerate(tokens):
        if i in used:
            continue
        following = tokens[i + 1] if i + 1 < len(tokens) and i + 1 not in used else None
        if token in _SYNTH_WORDS | _SYNTH_MISHEARINGS and following is not None:
            number = _number(following, after_synth=True)
            if number is not None:
                if number not in (1, 2, 3):
                    return TargetResolution(None, _INVALID_SYNTH, frozenset(used))
                used |= {i, i + 1}
                found.append({"trackId": f"synth-{number}"})
                continue
        if token in ("first", "second", "third") and following in _SYNTH_WORDS:  # "the second synth"
            used |= {i, i + 1}
            found.append({"trackId": f"synth-{_ORDINALS[token]}"})
    for i, token in enumerate(tokens):
        if i not in used and (token == "drums" or (token == "drum" and list(tokens[i + 1:i + 2]) == ["track"])):
            used.add(i)
            found.append({"trackId": "drums"})
    if any("lane" in target for target in found):
        # "the snare on the drums" is one target: drop only the redundant generic drums target,
        # never an explicit synth ("clear kick and synth two" must refuse, not clear the kick).
        found = [target for target in found if target != {"trackId": "drums"}]
    distinct = list({tuple(sorted(t.items())): t for t in found}.values())
    if len(distinct) > 1:
        return TargetResolution(None, _SEVERAL_TARGETS, frozenset(used))
    leftover = [t for i, t in enumerate(tokens) if i not in used]
    if any(_number(token) is not None for token in leftover):
        return TargetResolution(None, _UNRESOLVED_TARGET, frozenset(used))  # "record synth two three"
    if distinct:
        if "melody" in leftover or "synth" in leftover:
            # A bare "synth" means the current synth, so beside another target it is a second
            # target ("clear kick and synth"): refuse rather than drop either one.
            return TargetResolution(None, _SEVERAL_TARGETS, frozenset(used))
        return TargetResolution(dict(distinct[0]), None, frozenset(used))
    if any(token in _SYNTH_MISHEARINGS for token in leftover):
        return TargetResolution(None, _UNRESOLVED_TARGET, frozenset(used))  # "record sent"
    if "melody" in leftover or "synth" in leftover:
        current = session["selected"]["trackId"]
        return TargetResolution({"trackId": current if current in MELODIC_TRACKS else "synth-1"}, None,
                                frozenset(used))
    return TargetResolution(None, None, frozenset(used))


def find_target(tokens: Sequence[str], session: Mapping[str, Any]) -> Optional[dict]:
    """Return the Target named in tokens, or None when none (or no single valid one) is named."""
    return resolve_target(tokens, session).target


def names_unresolved_target(tokens: Sequence[str]) -> bool:
    """Track-like words are present but name no single valid track."""
    return resolve_target(tokens, {"selected": {"trackId": "synth-1"}}).problem is not None


def _target_or_selected(rest: Sequence[str], session: Mapping[str, Any]) -> tuple:
    """(target, None), or (None, reason) when what was said is invalid, conflicting or unclear.
    The selection is used only when nothing track-like was said at all."""
    resolution = resolve_target(rest, session)
    if resolution.problem is not None:
        return None, resolution.problem
    return (resolution.target or _selected(session)), None


_METRONOME_WORDS = frozenset({"metronome", "click", "clicks", "metronomes"})
_ON_WORDS = frozenset({"on", "enable", "unmute", "start", "resume"})
_OFF_WORDS = frozenset({"off", "disable", "mute", "stop", "silence", "kill"})


def _metronome(tokens: Sequence[str]) -> Optional[Interpretation]:
    """"metronome on/off", "turn the click off", "mute the metronome"; never a toggle guess."""
    if not any(token in _METRONOME_WORDS for token in tokens):
        return None
    on, off = any(t in _ON_WORDS for t in tokens), any(t in _OFF_WORDS for t in tokens)
    if on == off:  # neither, or contradictory ("unmute ... off")
        return NotUnderstood("say metronome on or metronome off")
    return _command({"type": "metronome", "enabled": on})


_ERASE_VERBS = frozenset({"erase", "delete", "remove", "clear", "wipe"})
_POSITION_WORDS = {"bar": "bar", "bars": "bar", "measure": "bar", "beat": "beat", "beats": "beat",
                   "subdivision": "subdivision", "sixteenth": "subdivision", "sub": "subdivision"}
_POSITION_NUMBERS = {"1": 1, "one": 1, "won": 1, "first": 1, "2": 2, "two": 2, "to": 2, "too": 2, "second": 2,
                     "3": 3, "three": 3, "tree": 3, "third": 3, "4": 4, "four": 4, "for": 4, "fore": 4, "fourth": 4}
_ERASE_HELP = "say erase, then bar and beat 1 to 4 (optionally subdivision 1 to 4), for example: erase bar 2 beat 3"


def _erase_event(rest: Sequence[str], session: Mapping[str, Any],
                 recording_target: Optional[Mapping[str, Any]]) -> Interpretation:
    """erase-event at one-based bar/beat/subdivision: step = (bar-1)*16 + (beat-1)*4 + (subdivision-1).

    Numbers follow their word ("bar 2 beat 3") or an ordinal precedes it ("the third beat of the
    second bar"). Anything missing, repeated, out of 1..4 or left over is refused: an ambiguous
    erase never mutates and never falls through to the language model.
    """
    found: dict[str, int] = {}
    used: set[int] = set()
    for index, token in enumerate(rest):
        kind = _POSITION_WORDS.get(token)
        if kind is None:
            continue
        value = None
        after = rest[index + 1] if index + 1 < len(rest) else None
        before = rest[index - 1] if index > 0 else None
        if after is not None and (after.isdigit() or after in _POSITION_NUMBERS):
            value, position = _POSITION_NUMBERS.get(after), index + 1
            if value is None:
                return NotUnderstood(f"{kind} must be 1 to 4; {_ERASE_HELP}")
        elif before in ("first", "second", "third", "fourth"):
            value, position = _POSITION_NUMBERS[before], index - 1
        if value is None or kind in found:
            return NotUnderstood(_ERASE_HELP)
        found[kind] = value
        used |= {index, position}
    if "bar" not in found or "beat" not in found:
        return NotUnderstood(_ERASE_HELP)
    # The track part goes through the shared resolver with the position words already used:
    # an invalid synth ("synth four"), two targets ("kick and snare") or a leftover number
    # ("beat two and three") is refused, never resolved to the first or selected candidate.
    resolution = resolve_target(rest, session, ignore=frozenset(used))
    if resolution.problem is not None:
        leftover_numbers = any(index not in resolution.used and _number(token) is not None
                               for index, token in enumerate(rest))
        return NotUnderstood(_ERASE_HELP if leftover_numbers else resolution.problem)
    target = resolution.target
    if target is None:
        target = dict(recording_target) if recording_target else _selected(session)
    if target["trackId"] == "drums" and "lane" not in target:
        return NotUnderstood("say which drum to erase: kick, snare, or hats")
    step = (found["bar"] - 1) * 16 + (found["beat"] - 1) * 4 + (found.get("subdivision", 1) - 1)
    return _command({"type": "erase-event", "target": target, "step": step})


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


def interpret(text: str, session: Mapping[str, Any], during_recording: bool, take_armed: bool = False,
              recording_target: Optional[Mapping[str, Any]] = None) -> Interpretation:
    """Map one utterance transcript to a command, using the browser's latest session snapshot.

    `take_armed`: a Record is counting in (not yet capturing). "Stop recording" then cancels
    the armed take with stop-recording, which keeps playback (RECORDING-USABILITY.md, Issue #3 e).
    `recording_target`: the take that was capturing when this was said; erase defaults to it
    before the ordinary selection (PLAYTEST-REPAIR-CONTRACT.md).
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

    # Deterministic, no model: checked before stop/mute so "stop the metronome" or "mute the
    # click" never reaches the transport or track mute.
    metronome = _metronome(tokens)
    if metronome is not None:
        return metronome

    if verb in _ERASE_VERBS and any(token in _POSITION_WORDS for token in rest):
        return _erase_event(rest, session, recording_target)

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
        target, refusal = _target_or_selected(rest, session)
        if target is None:
            return NotUnderstood(refusal)
        problem = _needs_lane(target)
        return NotUnderstood(problem) if problem else _command({"type": "record", "target": target})

    if verb in ("play", "start", "resume") and (not rest or rest in (["playback"], ["playing"], ["music"], ["it"])):
        return _command({"type": "play", "playing": True})

    if ("tempo" in tokens or "bpm" in tokens or verb in ("faster", "slower", "quicker")
            or _contains(tokens, "speed up") or _contains(tokens, "slow down")
            or (verb in ("make", "go") and any(word in rest for word in ("faster", "slower", "quicker")))):
        return _tempo(tokens, session)

    if verb in ("clear", "erase", "delete", "wipe"):
        target, refusal = _target_or_selected(rest, session)
        if target is None:
            return NotUnderstood(refusal)  # never erase a guessed track
        return _command({"type": "clear", "target": target})

    if verb in ("mute", "unmute", "silence"):
        target, refusal = _target_or_selected(rest, session)
        if target is None:
            return NotUnderstood(refusal)
        if "lane" in target and rest:
            return NotUnderstood("single drums cannot be muted; say mute drums")
        return _command({"type": "mute", "trackId": target["trackId"], "muted": verb != "unmute"})

    if verb in ("select", "choose", "pick") or (verb in ("switch", "go", "change") and rest[:1] == ["to"]):
        resolution = resolve_target(rest, session)
        target = resolution.target
        if target is None:
            return NotUnderstood(resolution.problem or "say what to select: kick, snare, hats, or synth one, two, or three")
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
    if kind == "erase-event":
        if target["trackId"] == "drums" and "lane" not in target:
            return "drum erasure requires a lane"
        if not 0 <= operation.get("step", -1) <= 63:
            return "erase step must be 0..63"
    return None
