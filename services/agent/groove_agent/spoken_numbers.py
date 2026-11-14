"""Parse numbers from speech transcripts ("140", "one forty", "one hundred and twenty")."""
from __future__ import annotations

from typing import Optional, Sequence

_UNITS = {
    "zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9,
}
_TEENS = {
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
}
NUMBER_WORDS = frozenset(_UNITS) | frozenset(_TEENS) | frozenset(_TENS) | {"hundred", "and"}


def _below_hundred(words: Sequence[str]) -> Optional[int]:
    """Value of a 0-99 phrase such as ["forty", "two"], ["oh", "five"] or ["twelve"]."""
    if len(words) == 1:
        word = words[0]
        for table in (_UNITS, _TEENS, _TENS):
            if word in table:
                return table[word]
        return None
    if len(words) == 2:
        first, second = words
        if first in _TENS and second in _UNITS and _UNITS[second] > 0:
            return _TENS[first] + _UNITS[second]
        if first in ("oh", "zero") and second in _UNITS:
            return _UNITS[second]
    return None


def _from_words(words: Sequence[str]) -> Optional[int]:
    words = [w for w in words if w != "and"]
    if not words:
        return None
    if "hundred" in words:
        index = words.index("hundred")
        head, tail = words[:index], words[index + 1:]
        if len(head) != 1 or head[0] not in _UNITS or _UNITS[head[0]] == 0:
            return None
        rest = _below_hundred(tail) if tail else 0
        return None if rest is None else _UNITS[head[0]] * 100 + rest
    value = _below_hundred(words)
    if value is not None:
        return value
    # Colloquial hundreds: "one forty" = 140, "one oh five" = 105, "two ten" = 210.
    if len(words) >= 2 and words[0] in _UNITS and _UNITS[words[0]] > 0:
        rest = _below_hundred(words[1:])
        if rest is not None and (len(words) > 2 or words[1] not in _UNITS):
            return _UNITS[words[0]] * 100 + rest
    return None


def find_number(tokens: Sequence[str]) -> Optional[float]:
    """Return the first number in tokens, written as digits or as words."""
    for token in tokens:
        try:
            return float(token)
        except ValueError:
            continue
    run: list[str] = []
    for token in list(tokens) + [""]:
        if token in NUMBER_WORDS:
            run.append(token)
            continue
        if run:
            value = _from_words(run)
            if value is not None:
                return float(value)
            run = []
    return None
