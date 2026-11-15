"""Live evaluation of the Groove agent: hard spoken requests -> resulting song, scored by outcome.

Runs each request through the real Deep Agents graph with the configured provider (services/agent/.env),
turns the decision into operations with the same music tools the service uses, applies them to a copy of
a test song and checks the result (not the wording). Costs real API calls (about $0.0003-0.002 each).

Usage (from services/agent): PYTHONPATH=. python scripts/agent_eval.py [model ...]
"""
import asyncio
import json
import os
import sys
import time

from groove_agent.contracts import load_fixture
from groove_agent.control_phrases import InputAction
from groove_agent.intents import Command, MusicTool, NotUnderstood, Plan, SoundSearch
from groove_agent.language import LanguageJob, language_from_env, load_backend_env
from groove_agent.music_tools import ToolRefusal, apply_operations, run_tool


def song():
    session = load_fixture("SessionState")
    session["selected"] = {"trackId": "synth-1"}
    session["tracks"][0]["notes"] = [
        {"id": "n1", "step": 1, "duration": 3, "midi": 60, "velocity": 0.8},
        {"id": "n2", "step": 5, "duration": 2, "midi": 64, "velocity": 0.8},
        {"id": "n3", "step": 9, "duration": 4, "midi": 67, "velocity": 0.8},
        {"id": "n4", "step": 18, "duration": 6, "midi": 65, "velocity": 0.8},
    ]
    hits = [{"id": f"k{s}", "step": s, "lane": "kick", "velocity": 0.9} for s in range(0, 64, 4)]
    hits += [{"id": f"s{s}", "step": s, "lane": "snare", "velocity": 0.8} for s in range(4, 64, 8)]
    hits += [{"id": f"h{s}", "step": s, "lane": "closed-hat", "velocity": 0.5} for s in range(0, 64, 2)]
    session["tracks"][3]["hits"] = hits
    return session


def lane(session, name):
    return sorted(h["step"] for h in session["tracks"][3]["hits"] if h["lane"] == name)


def track(session, track_id):
    return next(t for t in session["tracks"] if t["id"] == track_id)


CASES = [
    ("Groove, put a snare every other bar", lambda s, r: lane(s, "snare") and all(x < 16 or 32 <= x < 48 for x in lane(s, "snare"))),
    ("Groove, delete every third snare", lambda s, r: lane(s, "snare") == [4, 12, 28, 36, 52, 60]),
    ("Groove, kick on beats one and three only", lambda s, r: lane(s, "kick") == list(range(0, 64, 8))),
    ("Groove, remove the kick in the last bar", lambda s, r: [x for x in lane(s, "kick") if x >= 48] == [] and len(lane(s, "kick")) == 12),
    ("Groove, give me a four on the floor disco beat", lambda s, r: lane(s, "kick") == list(range(0, 64, 4))),
    ("Groove, make the drums a bit quieter", lambda s, r: track(s, "drums")["volume"] < 0.7),
    ("Groove, balance the mix", lambda s, r: sum(1 for t in s["tracks"] if t["volume"] != 0.7) >= 2),
    ("Groove, make synth one brighter and add some reverb",
     lambda s, r: int(track(s, "synth-1")["patch"]["parameters"].get("5", 0)) > 0 and int(track(s, "synth-1")["patch"]["parameters"].get("36", 0)) > 0),
    ("Groove, make this song sound sad", lambda s, r: (s.get("pitchSnap") or {}).get("scale") == "minor"),
    ("Groove, clean up the timing of the whole beat", lambda s, r: all(n["step"] % 2 == 0 for n in track(s, "synth-1")["notes"])),
    ("Groove, move the melody up an octave", lambda s, r: sorted(n["midi"] for n in track(s, "synth-1")["notes"]) == [72, 76, 77, 79]),
    ("Groove, we want like a bright disco synth for our beat",
     lambda s, r: any(isinstance(x, SoundSearch) and "disco" in x.description.lower() for x in r)),
    ("Groove, can you calibrate my microphone", lambda s, r: any(isinstance(x, InputAction) for x in r)),
    ("Groove, hi-hats on the off beats and a snare on two and four",
     lambda s, r: lane(s, "closed-hat")[:4] == [2, 6, 10, 14] and lane(s, "snare")[:2] == [4, 12]),
    ("Groove, what's the weather like today", lambda s, r: all(isinstance(x, NotUnderstood) for x in r)),
]


def apply(session, result):
    steps = list(result.steps) if isinstance(result, Plan) else [result]
    for step in steps:
        if isinstance(step, MusicTool):
            try:
                operations, _ = run_tool(step.name, step.args, session)
            except ToolRefusal:
                continue  # like the service: a step that is already true is skipped, the rest still apply
            session = apply_operations(session, operations)
        elif isinstance(step, Command):
            session = apply_operations(session, [step.operation])
    return session, steps


async def evaluate(model):
    if model:
        os.environ["GROOVE_LLM_MODEL"] = model
    language = language_from_env()
    passed, times = 0, []
    print(f"\n== {language.config.label}")
    for text, check in CASES:
        started = time.monotonic()
        try:
            result = await language.infer(LanguageJob("eval", text, song(), False, False, {}))
            elapsed = time.monotonic() - started
            after, steps = apply(song(), result)
            ok = bool(check(after, steps))
            summary = "; ".join(f"{type(s).__name__}:{getattr(s, 'name', '') or getattr(s, 'description', '') or getattr(s, 'operation', {}).get('type', '')}"
                                for s in steps)
        except Exception as error:  # a failed request is a failed case
            elapsed, ok, summary = time.monotonic() - started, False, f"ERROR {type(error).__name__}: {str(error)[:80]}"
        times.append(elapsed)
        passed += ok
        print(f"{'PASS' if ok else 'FAIL'} {elapsed:4.1f}s  {text}  ->  {summary}")
    print(f"SCORE {passed}/{len(CASES)}  mean {sum(times) / len(times):.1f}s  max {max(times):.1f}s")
    return passed


def main():
    load_backend_env()
    models = sys.argv[1:] or [None]
    for model in models:
        asyncio.run(evaluate(model))


if __name__ == "__main__":
    main()
