"""Compare an utterance with the parser and, only with --live, the configured free model.

No model request by default. This reports individual measurements; it does not claim
WS4 corpus acceptance or human STT quality. Never prints credentials/provider exceptions.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from groove_agent.contracts import load_fixture
from groove_agent.intents import interpret
from groove_agent.language import LanguageJob, language_from_env, load_backend_env, safe_language_error


def describe(result):
    return {"outcome": type(result).__name__, **asdict(result)}


async def run(args):
    session = load_fixture("SessionState")
    session["selected"] = {"trackId": args.track}
    if args.track == "drums":
        session["selected"]["lane"] = args.lane
    started = time.perf_counter()
    baseline = interpret(args.text, session, args.recording, take_armed=args.armed)
    report = {"parser": describe(baseline), "parserMs": round((time.perf_counter() - started) * 1000, 2),
              "liveRequested": args.live}
    if args.live:
        load_backend_env()
        language = language_from_env()
        if language is None:
            raise ValueError("set backend GROOVE_LLM=openrouter and OPENROUTER_API_KEY before using --live")
        started = time.perf_counter()
        try:
            result = await language.infer(LanguageJob("evaluation", args.text, session, args.recording, args.armed))
            report["language"] = describe(result)
            report["agreesWithParser"] = describe(result) == describe(baseline)
        except Exception as error:
            report["error"] = safe_language_error(error)
        report["languageMs"] = round((time.perf_counter() - started) * 1000, 2)
        report["model"] = language.config.model
    print(json.dumps(report, indent=2))
    return 1 if "error" in report else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text")
    parser.add_argument("--recording", action="store_true")
    parser.add_argument("--armed", action="store_true")
    parser.add_argument("--track", choices=["drums", "synth-1", "synth-2", "synth-3"], default="synth-1")
    parser.add_argument("--lane", choices=["kick", "snare", "closed-hat"], default="kick")
    parser.add_argument("--live", action="store_true", help="explicitly send this text/snapshot to configured OpenRouter")
    try:
        raise SystemExit(asyncio.run(run(parser.parse_args())))
    except ValueError as error:
        parser.exit(2, str(error) + "\n")
