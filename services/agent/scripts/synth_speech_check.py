"""Synthesized-speech check: real EnergySegmenter + Connection + local faster-whisper (base.en).

Builds takes from Windows SAPI phrase WAVs (16 kHz mono) with room noise and pauses, streams them
in 20 ms speech-audio chunks through Connection, and transcribes with the real recognizer
synchronously. Synthesized speech is not human/microphone evidence.
Usage (from services/agent): PYTHONPATH=. python scripts/synth_speech_check.py <dir of 16 kHz mono phrase WAVs>
Phrase WAVs (stop, tempo_a, tempo_b, erase, key, long) can be made with Windows System.Speech; none are committed.
"""
import base64
import os
import sys
import wave

import numpy as np

os.environ.setdefault("GROOVE_STT", "faster-whisper")
os.environ.setdefault("GROOVE_STT_MODEL", "base.en")
from groove_agent.connection import Connection  # noqa: E402
from groove_agent.contracts import load_fixture  # noqa: E402
from groove_agent.stt import transcriber_from_env  # noqa: E402

RATE, CTX = 16000, 44100
TTS = sys.argv[1]
transcriber = transcriber_from_env()


def load(name):
    with wave.open(os.path.join(TTS, name + ".wav")) as w:
        assert w.getframerate() == RATE
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768


def sung(seconds, hz=220.0):
    """A held sung-like vowel (harmonics with gentle vibrato), standing in for singing."""
    t = np.arange(int(seconds * RATE)) / RATE
    f = hz * (1 + 0.01 * np.sin(2 * np.pi * 5 * t))
    phase = 2 * np.pi * np.cumsum(f) / RATE
    return (0.15 * sum(np.sin(k * phase) / k for k in range(1, 6))).astype(np.float32)


def take(parts):
    rng = np.random.default_rng(1)
    out = []
    for part in parts:
        if isinstance(part, tuple):
            out.append(sung(*part))
        else:
            out.append(np.zeros(int(part * RATE), np.float32) if isinstance(part, float) else load(part))
    audio = np.concatenate(out)
    audio = audio + 0.0005 * rng.standard_normal(len(audio)).astype(np.float32)
    return (np.clip(audio, -1, 1) * 32767).astype("<i2")


class SyncWorker:
    name = "faster-whisper (synchronous check)"
    supports_probe = True

    def __init__(self):
        self.jobs = []

    def submit(self, job):
        self.jobs.append(job)


def run(label, parts, recording):
    worker = SyncWorker()
    connection = Connection(speech=worker)
    start = 352800
    transport = {"clockId": "ctx", "sampleRate": CTX, "currentFrame": start, "loopStartFrame": start,
                 "playing": True, "recording": recording, "pendingCommandIds": []}
    if recording:
        transport.update(recordingState="recording", recordingStartFrame=start,
                         recordingTarget={"trackId": "synth-1"})
    connection.handle({"type": "session", "session": load_fixture("SessionState")}, 0)
    connection.handle({"type": "transport", "transport": transport}, 0)
    pcm = take(parts)
    replies, transcripts = [], []
    for seq, i in enumerate(range(0, len(pcm) - 319, 320)):
        chunk = pcm[i:i + 320]
        message = {"type": "speech-audio", "streamId": "s", "seq": seq, "clockId": "ctx",
                   "startFrame": start + seq * 882, "endFrame": start + (seq + 1) * 882, "sampleRate": RATE,
                   "encoding": "pcm-s16le", "data": base64.b64encode(chunk.tobytes()).decode()}
        replies += connection.handle(message, 0)
        while worker.jobs:
            job = worker.jobs.pop(0)
            transcribe = getattr(transcriber, "transcribe_timed", transcriber.transcribe)
            text = transcribe(job.segment.recognition_samples, RATE)
            transcripts.append(("probe: " if job.probe else "") + getattr(text, "text", text))
            replies += connection.speech_result(job, text, None, 0)
    result = [(r["type"], r.get("command", {}).get("operation") or r.get("operation") or r.get("message"))
              for r in replies if r["type"] in ("command", "error", "browser-action")]
    first = next((r for r in replies if r["type"] == "command"), None)
    span = next((r for r in replies if r["type"] == "command-span"), None)
    if first is not None and span is not None:
        result.append(("span seconds", round((span["startFrame"] - start) / CTX, 2), round((span["endFrame"] - start) / CTX, 2)))
    print(f"{label}\n  segments: {transcripts}\n  result:   {result}")


run("Groove stop during a take", [1.0, "stop", 2.5], True)
run("Groove stop, singing resumes 0.35 s later (take)", [1.0, "stop", 0.35, (2.0,), 1.5], True)
run("Tempo sentence with a 0.9 s pause", [1.0, "tempo_a", 0.9, "tempo_b", 2.5], False)
run("Erase during a take", [1.0, "erase", 2.5], True)
run("Key phrase", [1.0, "key", 2.5], False)
run("Long (>4 s) sentence, parser only", [1.0, "long", 2.5], False)
