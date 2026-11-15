# Browser speech pipeline

The browser consumer and local service are integrated on engine-integration. Wire shapes and timing invariants are in CONTRACTS.md; backend settings in services/agent/README.md. Physical microphone and full hands-free acceptance remain open in STATUS.md.

## Capture and classification

The capture worklet copies/stamps a separate speech path without encoding/inference in the audio callback. A worker emits100ms PCM16 little-endian/base64 chunks, silence included, at the shared context rate. The recognizer resamples; browser speech and performance use the same latency-corrected frame mapping. Negative startup trim removes corresponding PCM rather than clamping headers over unchanged samples.

SpeechSession validates stream/clock-scoped availability and classified coverage against actually sent frames. Socket connectivity does not prove recognition. command-span exclusions arrive before speech-verified watermarks; unfinished utterances hold coverage. Live piano-roll estimates are view-only until finalization/classification/engine application. Neither previews nor transport progress verify speech.

Gaps, unavailable recognition, stream/socket backlog or disconnect fail the stream, discard pending unverified capture and stop the take while preserving committed music/playback. Recovery requires explicit Retry and a fresh take; manual fallback is explicit. Device/calibration/clock changes invalidate old streams; old workers/results must not replay. Keep bounded queues and guards intact.

## Research

Configured voice research binds context before progress and adopts only the current request/job/track. Preview uses exact current candidate IDs and actual started/ended/rejected browser acknowledgments; it does not apply a patch or alter musical Undo history. See VOICE-RESEARCH.md for lifecycle/stale-intent rules. Full acoustic describe -> candidates -> preview -> accept/Undo remains intermittent despite synthetic successes.

## Reproducible checks

Use SETUP.md for app/service/engine prerequisites. Browser probes in tests/browser cover PCM/capture, unavailable/stalled recognition, verified loops, local STT melody, live notes/edits and research preview. The scripted_speech_server.py fixture is test-only, not a recognizer. services/agent/scripts/browser contains synthesized acoustic end-to-end gates; read their setup/options before running. Optional model tests require explicit local dependencies and flags; ordinary regression checks make no provider calls.

Current unresolved false-wake guard: `PYTHONPATH=services/agent python -m pytest tests/diagnostics/melody-speech-protection.py`. It supplies scripted transcripts to the real Connection/parser, not recorded microphone audio;3 musical-only cases currently emit exclusions/model jobs, while2 controls pass. It is an intentionally failing diagnostic outside normal CI, not a passing acceptance claim.
