"""Speak into your microphone and see what the speech pipeline hears. Nothing is saved.

    python services/agent/scripts/voice_check.py [--seconds 10] [--model base.en] [--device N] [--list]

Records from the default microphone (or --device), then runs the service's own pieces on it:
20 ms energy segmentation (with the wake-word pause handling), local faster-whisper, and the
command interpreter. It prints, per spoken segment, when it was said, what was heard, how long
decoding took, and which command it would become during a take ("Groove, ..." required) and
outside one. Audio stays in memory only; no recording is written to disk (AGENTS.md).

Needs requirements-speech.txt plus `sounddevice` (pip install sounddevice). This checks recognition
of your voice and mic, not browser capture timing or the full app.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from groove_agent.connection import WAKE_JOIN_SECONDS, _bare_wake, split_commands  # noqa: E402
from groove_agent.contracts import load_fixture  # noqa: E402
from groove_agent.intents import Command, interpret  # noqa: E402
from groove_agent.speech import Chunk  # noqa: E402
from groove_agent.speech_pipeline import EnergySegmenter  # noqa: E402

RATE = 16000
CHUNK = 320  # 20 ms


def describe(result) -> str:
    if isinstance(result, Command):
        return f"{result.operation} ({result.boundary})"
    reason = getattr(result, "reason", "")
    return f"{type(result).__name__}{': ' + reason if reason else ''}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--seconds", type=float, default=10.0)
    parser.add_argument("--model", default="")
    parser.add_argument("--device", type=int, default=None, help="input device index (see --list)")
    parser.add_argument("--list", action="store_true", help="list audio input devices and exit")
    args = parser.parse_args()
    import sounddevice as sd

    if args.list:
        for index, device in enumerate(sd.query_devices()):
            if device["max_input_channels"] > 0:
                print(f"{index:3d}  {device['name']}")
        return
    from groove_agent.stt import FasterWhisperTranscriber

    print("Loading the recognizer...", flush=True)
    stt = FasterWhisperTranscriber(model=args.model)
    device = sd.query_devices(args.device, kind="input")
    print(f"Recognizer: {stt.name}\nMicrophone: {device['name']}\n")
    print("Try, with short pauses between them:  \"Groove, record kick\"  ...  \"Groove, stop\"  ...  \"tempo one forty\"")
    for n in (3, 2, 1):
        print(f"  recording in {n}...", flush=True)
        time.sleep(1)
    print(f"  RECORDING {args.seconds:g} s - speak now", flush=True)
    audio = sd.rec(int(args.seconds * RATE), samplerate=RATE, channels=1, dtype="int16", device=args.device)
    sd.wait()
    audio = audio[:, 0]
    print("  done.\n")

    peak = float(np.abs(audio).max()) / 32768 if audio.size else 0.0
    rms = float(np.sqrt(np.mean((audio.astype(np.float64) / 32768) ** 2))) if audio.size else 0.0
    print(f"Mic level: peak {20 * np.log10(max(peak, 1e-6)):.1f} dBFS, average {20 * np.log10(max(rms, 1e-6)):.1f} dBFS"
          + ("   <- very quiet: move closer or raise the input level" if peak < 0.05 else ""))

    segmenter = EnergySegmenter(RATE)
    segments = []
    for start in range(0, len(audio) - CHUNK + 1, CHUNK):
        chunk = Chunk("check", start // CHUNK, "mic", start, start + CHUNK, RATE, audio[start:start + CHUNK])
        segments += segmenter.feed(chunk)
    silence = np.zeros(int(1.0 * RATE), dtype=np.int16)  # flush a segment still open at the end
    offset = len(audio) - len(audio) % CHUNK
    for start in range(0, len(silence), CHUNK):
        segments += segmenter.feed(Chunk("check", 0, "mic", offset + start, offset + start + CHUNK, RATE,
                                         silence[start:start + CHUNK]))
    if not segments:
        print("\nNo speech segments found. Speak louder or closer, or pick another mic with --list / --device.")
        return

    session = load_fixture("SessionState")
    print(f"\n{len(segments)} speech segment(s):")
    heard = []
    for segment in segments:
        t0 = time.perf_counter()
        text = stt.transcribe(segment.samples, RATE)
        decode = time.perf_counter() - t0
        heard.append((segment, text))
        print(f"  {segment.start_frame / RATE:5.2f}-{segment.last_frame / RATE:5.2f} s  decode {decode:4.2f} s  "
              f"heard {text!r}")
    # Same wake-word joining as the service: a bare "Groove" joins the next segment within the window.
    print("\nAs commands:")
    i = 0
    while i < len(heard):
        segment, text = heard[i]
        if _bare_wake(text) and i + 1 < len(heard) and \
                heard[i + 1][0].start_frame - segment.last_frame <= WAKE_JOIN_SECONDS * RATE:
            text = f"{text} {heard[i + 1][1]}"
            i += 1
        i += 1
        if not text.strip():
            continue
        armed = False
        for command in split_commands(text):
            outside = interpret(command, session, False, take_armed=armed)
            print(f"  {command!r}\n      during a take:   {describe(interpret(command, session, True))}\n"
                  f"      outside a take:  {describe(outside)}")
            if isinstance(outside, Command):
                if outside.operation["type"] == "record":
                    armed = True
                elif outside.operation["type"] == "stop-recording":
                    armed = False


if __name__ == "__main__":
    main()
