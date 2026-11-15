# Browser voice research and preview handoff

WS1 capability branch: ws1/voice-research-browser, based on approved contract e3966d6 and coordination b1670cf. Review/integration is pending. New backend emission must remain disabled until the integrator lands both sides of docs/VOICE-RESEARCH.md. This branch is the consumer, not a substitute backend/recognizer/model.

## Behavior

ResearchController adopts research-context on an idle/current panel, binds the original synth/description and accepts only matching progress. Duplicate/retired contexts cannot reset results; superseded progress is ignored. A newer UI request awaiting its first matching response rejects/cancels buffered voice contexts and never adopts them later. Backend must still reject physically older delayed STT/model research after that UI response, as the contract requires; the browser has no capture timestamp in research-context to infer that ordering itself. Job history is bounded at 256 per connection; further jobs reject until reconnect rather than evict history and revive old IDs.

Voice-started jobs reveal the existing Agent disclosure automatically. Actual description/results are shown. Root integration temporarily owns this consumer; Leo should continue physical input/timing/loading diagnosis rather than duplicate research wiring.

One CandidatePreviewPlayer handles manual and voice playback. Server requests bind exact job/candidate IDs and look up the displayed previewUrl; no URL/patch comes from candidate-preview. Audio must be enabled. The player confirms started only after the still-current HTMLAudioElement.play() resolves, ended only on natural completion, and rejected on blocked/error/timeout/cancellation. Five-second start and 120-second running deadlines are client grace limits, not measured network latency. The producer must allow these client limits plus local delivery margin before its own timeout. Exact request/binding/last-ack history is bounded at 256 per connection; repeated IDs cannot restart audio and conflicting bindings reject.

Manual Preview/Stop buttons use the same lifecycle; controls no longer create independent per-candidate audio players. Replacing job/candidate/patch/URL, a new preview, disabling audio, disconnect, unmount or disposal stops/rejects the previous preview. Pending old play promises and ended events cannot acknowledge or resume it. Pause/remove-src/load releases the element's media resource; replacement uses a different element so a stale promise cannot pause the new preview. Preview never dispatches an engine operation or changes revision/Undo/capture state.

prepareCommand + observational receipt routing track voice patch acceptance before dispatch and retain authoritative ack status. New jobs cannot hide a pending patch change. Synchronous pre-submission rejection releases this gate; submission receipts never prove application. A failing receipt observer reports an error without falsely rejecting an already submitted musical command.

## Validation

- Shared TypeScript/Python/schema checks and build passed.
- Node suite: **177 passed / one optional integration skip**. Tests cover original track binding, duplicate/retired/ignored context, newer pending UI request, queued patch acknowledgments, synchronous rejection, exact candidate lookup, no musical mutation, manual/voice exclusivity, rejected playback, stale play/end callbacks, changed candidate data, disconnect/disposal, start/finish deadlines and observer failure after engine submission.
- Explicit live-service/WebSocket/WASM scenario passed. Real-renderer/MOCK-embedder research acceptance/Undo scenario passed (~78 s). That research test uses deliberately meaningless ranking; it is not sound-quality evidence.
- Actual Chromium app test tests/browser/voice-research-preview.js passed with a SCRIPTED WebSocket peer supplied through Playwright routing. A voice context automatically populated/revealed the real panel; actual HTMLAudioElement play/end produced started/ended; stale job rejected; manual Stop worked; duplicate ID did not replay; replacement bound synth-2. SessionState remained byte-for-byte identical and real SLOOP groove playback continued. Test browser was closed afterward. No backend, STT, LLM or human hearing/quality result is claimed by that fixture.

Browser reproduction (from the repository root with Vite on 5173 and playwright-cli installed):

```sh
espeak-ng -v en-us -s 140 -w apps/web/public/engine/synthetic-groove-stop.wav 'Groove, stop.'
playwright-cli -s=voice-preview open http://127.0.0.1:5173
playwright-cli -s=voice-preview run-code --filename=tests/browser/voice-research-preview.js
playwright-cli -s=voice-preview close
```

The WAV is an ignored audio-playback fixture, not a researched sound or human recording. The test routes its own browser's WebSocket; it does not replace the running service or send provider requests. Other users' browser connections and local credential files are untouched.

## Next integration

WS3: open/review this branch against engine-integration; inspect pending patch/preview acknowledgment seams. Implement the approved default-off producer/tools, exact acknowledgment correlation and bounded timeouts, older STT/model-versus-newer-UI intent rejection, then combine with this consumer. Full browser gate requires actual recognized describe -> candidates -> audition -> refine -> audition -> accept -> Undo with existing music preserved. Human microphone/loading/near-grid timing, listening comparison and ten-minute audible playback remain open.
