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

## Updated review: a9ae8a84aa430d05b5858ecf5808f9c886b5e546

The original five-second valid-prefix reproduction now passes, including the soft-attack continuation. This is a real improvement. Backend suite plus that external reproduction: **432 passed /12 optional skips** in an isolated service checkout with providers disabled (some asset/model opt-ins absent).

Two additional focused regressions still fail at this exact head; run `docs/reviews/PR43-followup-reproduction.py` with the same PYTHONPATH/provider-disabled command above:

1. Extend continuous connected speech from t1 to t9.5, with scripted transcriptions `Groove make it sound like a warm piano`, `with a soft attack and a mellow tone`, then `and a little chorus`. At t7.52 the service emits a research-context for only `warm piano`, before the sentence ends. `_advance_speech` deliberately executes a held valid prefix when HOLD_LAG_BUDGET_SECONDS is exceeded; it does so even with the continuation open/pending. The browser coverage bound is legitimate, but executing the unfinished command is the reported product failure. On reaching an explicit bound, a truthful bounded refusal/retry prompt can be acceptable; executing an unfinished musical/research mutation or faking classified coverage is not. Preserve whole-sentence semantics for the supported interval and report limits truthfully.
2. A completed early-stop probe with an error returns before clearing `state.probing`. Subsequent 0.3 s dips inside the same still-open segment cannot launch a fresh probe. The reproduction receives only one probe instead of a second that would recognize Groove stop. Clear only the matching completed probe's in-flight slot even on failure/irrelevant result, without allowing stale results to clear a newer job or bypassing normal final recognition. A segment closure currently clears it eventually; this is not a claim that the whole connection is permanently stuck.

Both reproductions use the real EnergySegmenter/Connection with scripted transcriber/research ports to isolate state/timing. They make no acoustic recognition, real CLAP or external-provider claim. The actual spoken instrument availability/visible-error finding in VOICE-INSTRUMENT-REQUEST-TRACE.md remains separate and open until its actual path is corrected and exercised. These follow-ups do not undo the already-integrated protocol/cooldown improvements.

## Review of latest evidence head107ba8c873ac34d4c86d8e09cb917e42f11f3666

Re-ran both follow-ups against this exact service head: **2 failed / original5s case1 passed**. They reproduce the same partial research at t7.52 and retained failed-probe slot. The new commit adds diagnostic/browser evidence but does not change those production paths.

The reported Windows acoustic stop/paused-sentence results are useful additional evidence, and predecoding generated speech clips before capture is a sensible harness correction. Keep their scope precise: executor_research_e2e uses typed transcripts and fetch/decode of a preview, not acoustic sound-description recognition or actual preview-playback acknowledgments. spoken_stream_e2e uses synthetic audio for the tempo and stop, with a typed command to start the take. Neither replaces the failing long-valid-prefix or failed-probe cases.

Before treating those scripts as enforced pass/fail gates, add actual assertions: they currently mostly print results, and catch several timeouts. In particular the recording-state wait subscribes and immediately unsubscribes inside waitForFunction, so its local `rec` stays false with asynchronous engine events; the timeout is swallowed. Subscribe once and retain the latest transport or await the actual event, assert recording began before injecting stop, and assert speech readiness/current frontend speech state, command/ack, playback continuing, exact candidate patch and Undo. Looking only for server error text misses frontend capture/coverage failure reasons. These are owned WS3 test follow-ups, not a request to redefine the shared protocol.
