"""Synthetic engine metadata shaped like the firmware export. Test data only: not real SLOOP presets."""
from groove_agent.research.mock import MockEmbedder, MockRenderer
from groove_agent.research.service import ResearchBackend
from groove_agent.research.space import ParameterSpace

REVISION = "test-revision"
COMMON = [("LVL", 0, 127, 104), ("ATK", 0, 127, 10), ("DEC", 0, 127, 70), ("SUS", 0, 127, 90), ("REL", 0, 127, 60),
          ("FLT", -64, 63, 0), ("PIT", -64, 63, 0), ("MODE", 0, 3, 0), ("PIT", -64, 63, 0), ("FLT", -64, 63, 0),
          ("DST", 0, 127, 0), ("MUTE", 0, 1, 0)]


def descriptor(name, lo, hi, default):
    return {"name": name, "min": lo, "max": hi, "default": default}


def metadata(engines=3, presets=4):
    common_defaults = [d for _, _, _, d in COMMON]
    out = {"sampleRate": 44100, "blockFrames": 64, "steps": 64, "engineParamOffset": len(COMMON),
           "parameters": [descriptor(*c) for c in COMMON], "globals": [], "engines": []}
    for e in range(engines):
        edit = [descriptor(f"E{i}", 0, 127, 64) for i in range(7)] + [descriptor("FIXED", 5, 5, 5)]
        out["engines"].append({"name": f"ENGINE{e}", "parameters": edit, "presets": [
            {"name": f"PRESET{e}.{p}",
             "parameters": common_defaults + [(17 * e + 29 * p + 11 * i) % 128 for i in range(7)] + [5]}
            for p in range(presets)]})
    return out


def space():
    return ParameterSpace(metadata(), REVISION)


def backend(budget=32, **kwargs):
    s = space()
    return ResearchBackend(s, MockRenderer(s, sample_rate=8000), MockEmbedder(), budget=budget, **kwargs)
