"""Spoken sound search on the real stack, without a browser: synthesized speech -> EnergySegmenter ->
local faster-whisper -> Connection (voice research on) -> configured SLOOP/CLAP ResearchService.

Then spoken accept and undo go through the same path. It checks that the spoken request is announced
(research-context), reaches the real research port, streams progress and candidates with preview
WAVs, and that accept/undo become apply-patch/undo commands. Synthesized speech is not microphone or
human listening evidence; preview audibility and Undo in the engine need the browser.

Usage (from services/agent, with GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap):
  python scripts/spoken_search_check.py <dir with piano.wav accept.wav undo.wav (16 kHz mono)>
The first run after an engine change rebuilds the CLAP corpus (minutes) and saves it: a prewarm.
"""
import base64
import os
import queue
import sys
import time
import wave
from pathlib import Path

import numpy as np

os.environ.setdefault("GROOVE_STT", "faster-whisper")
os.environ.setdefault("GROOVE_STT_MODEL", "base.en")
from groove_agent.connection import Connection  # noqa: E402
from groove_agent.contracts import contracts_dir, load_fixture, validate  # noqa: E402
from groove_agent.research.service import ResearchService, backend_from_env  # noqa: E402
from groove_agent.stt import transcriber_from_env  # noqa: E402

RATE, CTX, START = 16000, 44100, 352800
TTS = Path(sys.argv[1])


def pcm(name, lead=0.6, tail=2.8):
    with wave.open(str(TTS / f"{name}.wav")) as w:
        voice = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768
    audio = np.concatenate([np.zeros(int(lead * RATE), np.float32), voice, np.zeros(int(tail * RATE), np.float32)])
    audio += 0.0005 * np.random.default_rng(3).standard_normal(len(audio)).astype(np.float32)
    return (np.clip(audio, -1, 1) * 32767).astype("<i2")


class SyncWorker:
    name = "faster-whisper (synchronous check)"
    supports_probe = True

    def __init__(self):
        self.jobs = []

    def submit(self, job):
        self.jobs.append(job)


def main():
    backend = backend_from_env(contracts_dir().parents[1])
    if backend is None:
        sys.exit("set GROOVE_RESEARCH=sloop GROOVE_EMBEDDER=clap")
    service = ResearchService(backend)
    inbox: "queue.Queue[dict]" = queue.Queue()
    worker, transcriber = SyncWorker(), transcriber_from_env()
    connection = Connection(research=service.port(inbox.put), speech=worker, voice_research=True)
    session = load_fixture("SessionState")
    session["selected"] = {"trackId": "synth-2"}
    connection.handle({"type": "session", "session": session}, 0)
    connection.handle({"type": "transport", "transport": {
        "clockId": "ctx", "sampleRate": CTX, "currentFrame": START, "loopStartFrame": START, "playing": True,
        "recording": False, "pendingCommandIds": []}}, 0)
    frame = [START]
    seq = [0]

    def say(name):
        out, heard = [], []
        samples = pcm(name)
        for i in range(0, len(samples) - 319, 320):
            message = {"type": "speech-audio", "streamId": "s", "seq": seq[0], "clockId": "ctx",
                       "startFrame": frame[0], "endFrame": frame[0] + 882, "sampleRate": RATE,
                       "encoding": "pcm-s16le", "data": base64.b64encode(samples[i:i + 320].tobytes()).decode()}
            seq[0] += 1
            frame[0] += 882
            out += connection.handle(message, time.monotonic())
            while worker.jobs:
                job = worker.jobs.pop(0)
                text = getattr(transcriber, "transcribe_timed", transcriber.transcribe)(job.segment.recognition_samples, RATE)
                heard.append(("probe: " if job.probe else "") + getattr(text, "text", text))
                out += connection.speech_result(job, text, None, time.monotonic())
        for message in out:
            validate("ServerMessage", message)
        return heard, [m for m in out if m["type"] not in ("speech-verified", "speech-status")]

    began = time.monotonic()
    heard, replies = say("piano")
    print("heard:", heard)
    print("replies:", [(m["type"], m.get("description") or m.get("message") or m.get("jobId")) for m in replies])
    context = next(m for m in replies if m["type"] == "research-context")
    final, updates = None, 0
    while final is None:
        message = inbox.get(timeout=900)
        validate("ServerMessage", message)
        if message["type"] != "research" or message["jobId"] != context["jobId"]:
            continue
        connection.observe_research(message)
        updates += 1
        if message["status"] in ("complete", "failed", "cancelled"):
            final = message
    print(f"research {final['status']} after {time.monotonic() - began:.1f} s, {updates} updates, error={final.get('error')}")
    for candidate in final["candidates"]:
        token = candidate.get("previewUrl", "").rsplit("/", 1)[-1].removesuffix(".wav")
        audio = service.preview(token) if token else None
        print(f"  candidate {candidate['id']}: preview {len(audio) if audio else 0} bytes, provenance={candidate.get('provenance')}")
    heard, replies = say("accept")
    print("heard:", heard, "->", [(m["type"], m.get("command", {}).get("operation", {}).get("type") or m.get("message"))
                                  for m in replies])
    accept = next(m["command"] for m in replies if m["type"] == "command")
    connection.handle({"type": "ack", "commandId": accept["id"], "status": "applied", "revision": 1}, time.monotonic())
    heard, replies = say("undo")
    print("heard:", heard, "->", [(m["type"], m.get("command", {}).get("operation")) for m in replies])


if __name__ == "__main__":
    main()
