"""Playtest repair: speech classification in a noisy room (synthetic, deterministic).

Room noise above the old fixed -40 dBFS energy threshold made every 20 ms window "speech":
segments ran to the 4 s maximum, coverage stalled for seconds and noise was transcribed.
These fixtures model steady room noise (fans, crowd hum) at several levels with beatboxed
hits and one louder spoken command. SCRIPTED worker: timing and coverage only, not
recognition; real-room microphone behaviour still needs the playtest.
"""
import base64

import numpy as np
import pytest

from test_speech_harness import (CONTEXT_RATE, PAYLOAD_RATE, TAKE_START, WINDOW_FRAMES, ScriptedWorker, connect, flat,
                                 frame_at, marks, stream)

CHUNK = 320
CHUNK_FRAMES = 882


def room_take(noise_dbfs, speech=(2.0, 2.7), hits=(0.5, 1.0, 1.5), seconds=4.5, seed=11, voice_dbfs=-14.0):
    rng = np.random.default_rng(seed)
    n = int(seconds * PAYLOAD_RATE)
    white = rng.standard_normal(n)
    hum = np.convolve(white, np.ones(8) / 8, mode="same")  # duller than white noise, like room tone
    audio = hum / np.sqrt(np.mean(hum ** 2)) * 10 ** (noise_dbfs / 20)
    for start in hits:
        i, k = int(start * PAYLOAD_RATE), int(0.06 * PAYLOAD_RATE)
        audio[i:i + k] += 0.6 * rng.standard_normal(k) * np.exp(-np.arange(k) / (0.015 * PAYLOAD_RATE))
    if speech:
        a, b = (int(x * PAYLOAD_RATE) for x in speech)
        t = np.arange(b - a) / PAYLOAD_RATE
        voiced = (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t)) * sum(np.sin(2 * np.pi * 140 * k * t) / k for k in range(1, 6))
        audio[a:b] += voiced / np.sqrt(np.mean(voiced ** 2)) * 10 ** (voice_dbfs / 20)
    return (np.clip(audio, -1, 1) * 32767).astype("<i2")


def chunks(pcm, stream_id="take-1", start_frame=TAKE_START, clock="ctx"):
    for seq, offset in enumerate(range(0, len(pcm) - CHUNK + 1, CHUNK)):
        begin = start_frame + seq * CHUNK_FRAMES
        yield {"type": "speech-audio", "streamId": stream_id, "seq": seq, "clockId": clock, "startFrame": begin,
               "endFrame": begin + CHUNK_FRAMES, "sampleRate": PAYLOAD_RATE, "encoding": "pcm-s16le",
               "data": base64.b64encode(pcm[offset:offset + CHUNK].tobytes()).decode()}


def max_lag_outside_speech(log, speech, after=0.0):
    """Largest gap between received audio and coverage, ignoring the speech and its decision time
    (and anything before `after` seconds into the take)."""
    worst, latest = 0, -1
    for chunk, replies in log:
        for mark in marks(replies):
            latest = max(latest, mark["throughFrame"])
        received = chunk["endFrame"] - 1
        if frame_at(speech[0]) <= received <= frame_at(speech[1] + 1.0) or received < frame_at(after):
            continue
        worst = max(worst, received - latest)
    return worst / CONTEXT_RATE


@pytest.mark.parametrize("noise_dbfs", [-60.0, -40.0, -35.0, -30.0])
def test_room_noise_never_stalls_coverage_or_reaches_the_recognizer(noise_dbfs):
    worker = ScriptedWorker()
    log = stream(connect(worker), worker, chunks(room_take(noise_dbfs, speech=None)))
    assert worker.transcribed == [], f"noise at {noise_dbfs} dBFS was sent for transcription"
    assert max_lag_outside_speech(log, (99, 99)) < 0.5, f"coverage stalled in {noise_dbfs} dBFS noise"


@pytest.mark.parametrize("noise_dbfs", [-60.0, -35.0, -30.0])
def test_a_spoken_command_over_room_noise_gets_a_tight_span_and_prompt_coverage(noise_dbfs):
    worker = ScriptedWorker(["Groove, stop"])
    log = stream(connect(worker), worker, chunks(room_take(noise_dbfs)))
    replies = flat(log)
    spans = [r for r in replies if r["type"] == "command-span"]
    assert len(worker.transcribed) == 1 and len(spans) == 1, noise_dbfs
    assert abs(spans[0]["startFrame"] - frame_at(2.0)) <= 3 * WINDOW_FRAMES  # does not swallow earlier music
    assert abs(spans[0]["endFrame"] - frame_at(2.7)) <= 3 * WINDOW_FRAMES
    assert [r["command"]["operation"] for r in replies if r["type"] == "command"] == [{"type": "stop-recording"}]
    assert max_lag_outside_speech(log, (2.0, 2.7)) < 0.5


def test_noise_that_starts_mid_take_does_not_stall_after_the_floor_adapts():
    quiet = room_take(-60.0, speech=None, hits=(), seconds=2.0, seed=1)
    loud = room_take(-30.0, speech=None, hits=(), seconds=4.0, seed=2)
    worker = ScriptedWorker()
    log = stream(connect(worker), worker, chunks(np.concatenate([quiet, loud])))
    assert worker.transcribed == [] or all(job.segment.last_frame - job.segment.start_frame < 2.5 * CONTEXT_RATE
                                           for job in worker.transcribed)
    assert max_lag_outside_speech(log, (99, 99), after=4.0) < 0.5  # two seconds after the noise began
