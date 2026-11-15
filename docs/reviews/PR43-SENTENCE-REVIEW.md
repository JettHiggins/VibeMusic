# PR 43 sentence review — valid sound-request prefixes

Reviewed endpointing head 5c0fe273e4242371234d726d7069caf9bb59c215, including 6d639b3. This report does not reject the independent protocol and provider-cooldown commits 366f07e/4132702, which WS1 is validating separately.

## Reproduced early research start

Feed a five-second utterance through the actual EnergySegmenter and Connection, with a scripted transcriber returning `Groove make it sound like a warm piano` for the forced four-second cut, followed by `with a soft attack`. The first part is already a valid SoundSearch. The service emits research-context and calls the research port before the utterance ends, losing the unfinished characteristics as part of that request. `_unfinished` checks NotUnderstood only and does not honor `job.segment.cut` for a valid interpretation. This directly affects Jett's top-priority spoken instrument request.

Run the supplied focused reproduction from the PR head:

```sh
PYTHONPATH=services/agent:services/agent/tests GROOVE_LLM= OPENROUTER_API_KEY= GROOVE_STT= GROOVE_VOICE_RESEARCH=0 python -m pytest docs/reviews/PR43-valid-prefix-reproduction.py -q
```

Observed: one failing test; a real research-context was emitted before the final speech segment. The worker transcript and research port are scripted to isolate orchestration. This is not CLAP quality, acoustic recognition or live-provider evidence.

## Required follow-up

A parser-valid prefix is not proof a forced-cut sentence is finished. Hold explicitly unfinished segments from both side effects and model calls, bind the eventual complete request to real measured frames, and retain an explicitly tested priority stop path. Also address/document the ordinary valid-prefix pause case (the handoff lists `Groove record` before `synth two` as still executing early). Do not mark premature sentence handling closed by unrecognized-prefix-only regressions.

Check the frontend's actual coverage limit: SpeechSession fails an eight-second verification stall, while the new backend allows a held sentence up to twelve seconds before recognition/join delay. Supply a real browser/stream integration case proving the advertised long sentence completes without an artificial watermark or a stream reset; do not silently raise limits or verify unclassified audio just to pass. Coordinate any frontend integration requirement with WS1, who owns the input/controller seam this round.

The handoff's statement that a stale service is the likely unsupported-browser-status cause is not established. The tested base's Connection.handle actually lacked those published message handlers. Verify process/source/schema versions and report both possibilities honestly.

Top product completion still needs actual spoken describe -> configured real research/progress/results -> audible preview -> accept/Undo. Earlier typed research checks and this protocol review do not establish that. Continue the concrete real search/configuration trace before expanding general timeline tooling. Existing models/keys stay local; provider-error regression tests need no live quota.
