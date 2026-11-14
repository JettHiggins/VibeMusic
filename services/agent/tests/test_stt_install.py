"""Clean-install guards for the optional local speech requirements (no model download).

WS1 found stt.py importing SciPy on the 44.1 kHz browser path while requirements-speech.txt
did not declare it, so a speech-only install crashed. These tests fail on that class of gap.
"""
import ast
import re
from pathlib import Path

import numpy as np
import pytest

AGENT = Path(__file__).resolve().parents[1]
DISTRIBUTIONS = {"faster_whisper": "faster-whisper", "scipy": "scipy", "numpy": "numpy"}


def declared(*names):
    found = set()
    for name in names:
        for line in (AGENT / name).read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if line.startswith("-r "):
                found |= declared(line[3:].strip())
            elif line:
                found.add(re.split(r"[<>=!~;\[ ]", line, maxsplit=1)[0].lower())
    return found


def test_every_third_party_import_in_stt_is_declared_for_a_speech_install():
    tree = ast.parse((AGENT / "groove_agent" / "stt.py").read_text(encoding="utf-8"))
    modules = {alias.name.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    modules |= {node.module.split(".")[0] for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.level == 0}
    third_party = modules - {"__future__", "os", "threading", "importlib", "math"}
    install = declared("requirements-dev.txt", "requirements-speech.txt")
    missing = {m for m in third_party if DISTRIBUTIONS.get(m, m) not in install}
    assert not missing, f"stt.py imports {sorted(missing)} but a speech-only install does not declare them"


def test_browser_rate_audio_resamples_to_16khz_without_a_model():
    pytest.importorskip("scipy")  # declared in requirements-speech.txt; CI's base install omits it
    from groove_agent.stt import to_whisper_rate
    t = np.arange(44100) / 44100
    tone = np.sin(2 * np.pi * 440 * t).astype(np.float32)
    out = to_whisper_rate(tone, 44100)
    assert out.dtype == np.float32 and len(out) == 16000
    spectrum = np.abs(np.fft.rfft(out))
    assert abs(np.argmax(spectrum) * 16000 / len(out) - 440) < 2  # same pitch after resampling
    assert to_whisper_rate(tone[:16000], 16000) is not None and len(to_whisper_rate(tone[:16000], 16000)) == 16000
