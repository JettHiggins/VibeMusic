# Approved voice research and preview contract

WS1 approval of WS3 proposal #28. Schema source: packages/contracts/src/index.ts; generated ClientMessage/ServerMessage JSON Schema is authoritative. VoiceResearch.json supplies synthetic/example messages and a nonexistent fixture URL, not actual research/audio. This publishes interfaces only; production adoption, playback and human acceptance remain unfinished.

## Rollout and ownership

Use a coordinated browser/service rollout on the same reviewed engine-integration baseline. New consumers still work with old producers via the existing UI sound-request path. Old strict clients reject unknown ServerMessage types, so new producers MUST stay disabled until the matching browser consumer lands and the integrator enables the capability. WS3 may use a default-off feature flag while developing; do not automatically enable it on schema availability alone. Restart service (cached schemas), restart Vite if needed and reload browser together at rollout. No capability handshake or new protocol version is implied, and no bidirectional old-client compatibility is claimed.

WS1 publishes/reviews schemas and owns browser research integration/preview orchestration for this capability. WS3 owns backend producers, research lifecycle and parser/Deep Agents tools. Leo retains input/UI diagnosis; do not duplicate this integration consumer. Propose wire amendments before use. The backend remains non-authoritative for music and never schedules audio by inference arrival time.

## Voice job adoption

ServerMessage research-context:

```json
{"type":"research-context","requestId":"voice-42","jobId":"voice-42:job","trackId":"synth-1","description":"warmer 80s electric piano","origin":"voice"}
```

IDs/description are nonempty. Track is synth-1/2/3, never drums. requestId identifies the initiating utterance/language request; jobId identifies this particular search/refinement. The service emits context synchronously on its socket event loop, once it has accepted the job, BEFORE any research progress/candidates/errors for that new job. Workers never invent contexts. Context is connection-local, not persisted/replayed on reconnect and not success evidence. Existing research progress shape is unchanged.

Browser binds the job to its original track/description, starts normal running state with no candidates, then consumes matching progress. Selection changes cannot retarget the job. Refine receives a new job/context, cancelling superseded running work. Same-context duplicates do not reset progress or candidates; older/superseded job progress or contexts cannot revive the old job. Track/job binding must not change on a reused ID. Keep bounded per-connection retired/seen IDs.

A newer local UI request wins over a buffered older voice context: while waiting for that UI request's first matching progress/error, ignore voice contexts and do not queue them for later adoption. Reject/cancel ignored voice work where necessary using existing cancel-job. Server must also prevent delayed STT/model results for older intents from superseding a newer accepted UI search; browser filtering alone is insufficient after the initial UI reply. Use capture-time intent context and existing stale-result guards, not transcript arrival time as intent time. Add this regression before claiming ordering safe.

Starting another job while a patch acceptance is queued must not lose its authoritative acceptance acknowledgment; reject/defer the new request explicitly until that musical command settles, matching existing UI behavior. Context/progress never implies patch acceptance. Disconnect cancels connection-owned jobs, fails pending UI requests, clears context/preview connection state and prevents replay. Accepted patches/notes remain unchanged.

## Non-mutating audition

ServerMessage candidate-preview:

```json
{"type":"candidate-preview","id":"voice-43:preview","jobId":"voice-42:job","candidateId":"patch-1"}
```

Resolve an ordinal to an exact current candidate on the backend before sending. No model-provided URL, patch, boundary or musical command is accepted in this message. The browser checks current job and candidate, finds its existing previewUrl and calls preview playback. It must reject absent/stale/superseded candidates, unavailable URL, disconnected/disabled audio or blocked/failed play. Duplicate IDs with the same binding never start a second playback; conflicting ID reuse is rejected. Bound request history per connection.

One preview plays at a time. Starting another preview, replacing/clearing its candidate/job, disconnecting, disposing/unmounting the preview consumer stops the old preview and invalidates pending play promises. Stale async play completion cannot acknowledge or restart old playback. Manual controls use the same one-preview lifecycle. A start is confirmed only after play() resolves for the still-current request; then ended comes from actual natural playback completion. Replacement/disconnect/playback failure may terminate a started preview with rejected plus a reason; do not report natural ended when it was cancelled. Rejection never changes music.

ClientMessage preview-ack (separate from SessionCommand ack):

```json
{"type":"preview-ack","id":"voice-43:preview","jobId":"voice-42:job","candidateId":"patch-1","status":"started"}
```

status is started, ended or rejected; reason is optional nonempty text (producers include it on rejection). Schema validates structure, not current candidate membership, ID deduplication or lifecycle. Browser/service must enforce those semantics. Backend matches the complete id/jobId/candidateId tuple to an outstanding request on that socket; invalid/stale/duplicate terminal acknowledgments cannot affect another preview. A bounded start/finish timeout reports explicit error and cleans outstanding state. Sending candidate-preview or invoking a tool is not an audition success. Even a started acknowledgment does not prove a human heard it.

Audition never changes SessionState, revision, notes, patch, capture epoch or Undo history. Accept remains the existing validated next-loop apply-patch; Undo restores the accepted patch. Never implement audition as apply-patch followed by Undo. Groove stop retains its existing recording/transport meaning. A separate preview-stop operation is deferred; replacement and lifecycle teardown still stop previews as above. Preview doesn't block speech classification or sample timing. Recognized Groove preview speech is excluded before coverage even if playback is rejected.

## Required producer/consumer evidence

Schema checks: valid messages, missing/empty IDs, wrong direction, extra URL/patch/revision fields, drums context and invalid statuses; existing fixtures stay valid. Runtime PRs must additionally cover stale/duplicate context, candidate replacement, newer UI intent winning over delayed voice, pending patch acceptance, supersession/cancel/reconnect and no replay.

Preview tests: exact current candidate lookup, no arbitrary URL, same-ID deduplication, conflicting IDs, blocked/rejected play(), stale pending play promise, natural end versus cancellation, replacement/disconnect/unmount cleanup, complete acknowledgment correlation/timeouts and unchanged musical state. Test recognized Groove exclusion before error/coverage.

Combined browser acceptance: recognized sound description populates the panel on the correct synth; audition candidate two without mutating music; refine and audition again; accept at a musical boundary; Undo restores the original patch; existing notes/playback survive. Label scripted/synthetic versus actual recognizer/model evidence. Full human listening/performance and ten-minute audible playback remain separate completion gates.
