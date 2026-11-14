# Local faster-whisper review evidence

PR #21 head b6b2d090a3bc69eb1b7ed3cb75d28df5fa4bd02a, isolated checkout.

A clean Python 3.13.18 ARM64 environment installed only requirements-dev.txt and requirements-speech.txt. pip check passed but scipy was absent. To exercise the actual adapter path without downloading a model, construct FasterWhisperTranscriber via object.__new__, assign a dummy _model and threading.Lock to _lock, then call transcribe(np.zeros(4410, dtype=np.float32), 44100). It raises ModuleNotFoundError: scipy before decoding. The optional speech requirements must cover the normal browser-rate path, and a clean install must test it.

After manually adding SciPy to that isolated environment (a workaround, not a source fix), the real faster-whisper 1.2.1 base.en model ran CPU/int8 with four threads. espeak-ng generated Groove, stop into /tmp, never from a person's microphone. Direct actual-adapter results:

| Payload rate | Transcript | Decode time |
| --- | --- | --- |
| 16000 | Groove, stop. | ~0.46 s |
| 44100 | Groove, stop. | ~0.44 s |

Observed constructor time was ~6.07 s; no cold/warm-cache guarantee is claimed. The synthetic waveform was also converted to 16 kHz and supplied to the PR's opt-in test_stt.py. It passed: actual threaded model/Connection proposed stop-recording, produced the measured span before the command and scoped coverage afterward. Reported proposal time ~0.49 s after rapid streaming began; this is not real-time end-of-utterance latency because the fixture streams faster than wall time.

Base tests: 136 passed/three optional skips; opt-in real-model test: one passed. Model weights remain in the user cache, synthetic audio in /tmp, neither in Git. No credentials or cloud inference were used. These checks do not resolve #15's delayed transport-context issue, test accents/noise/human singing, establish p95 latency, or complete microphone acceptance.
