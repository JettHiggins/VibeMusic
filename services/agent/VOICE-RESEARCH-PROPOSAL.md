# Proposal: voice research context and non-mutating candidate audition

Status: WS1 approved the shared interface; see docs/VOICE-RESEARCH.md and generated schemas for the final rollout/lifecycle decisions. Producers and consumers are not yet implemented. WS1 owns approval/shared schemas; WS2 owns the browser consumer (or WS1 by explicit temporary assignment); WS3 owns producers and typed language tools. No production code may send these messages until the agreed schemas and examples are published. This follows issue #3(a/b), PLAN.md milestone 4 and the final hands-free scenario.

## Reproduced code gap

`Connection._on_sound_intent` starts spoken sound jobs directly using `<utteranceId>:job`. `ResearchController` in `apps/web/src/integration/research.ts` begins idle and only adopts research progress while its local state is running and the jobId matches a request it created. Therefore a spoken job's progress/candidates cannot populate that panel. Blindly adopting every unknown job would revive superseded/out-of-order results, which existing tests intentionally reject.

Audition currently uses an HTML audio element in `apps/web/src/integration/ResearchPanel.tsx`, with the displayed candidate's previewUrl. The current SessionCommand has no candidate-audition operation, and musical command acknowledgments track composition mutations. Applying a patch then Undo is not equivalent to non-mutating preview. PR #26 explicitly refuses unsupported automatic audition; its typed search/refine/accept/cancel tools do not close these browser gates.

## A. Explicit server-ordered research context

Add a ServerMessage variant, emitted once on the socket event loop when a voice search/refinement is accepted, before any worker progress for that job:

```json
{
  "type": "research-context",
  "requestId": "utterance-42",
  "jobId": "utterance-42:job",
  "trackId": "synth-1",
  "description": "warmer 80s electric piano",
  "origin": "voice"
}
```

Proposed structure: nonempty IDs/description, melodic trackId only, origin literal voice. Existing `research` progress and candidate shapes stay unchanged. New voice jobs cancel superseded running searches within their connection. Accepted patches and composition are preserved. Browser adoption starts a normal ResearchState bound to the original track and job. Refinement gets a fresh jobId/context. Later messages from older jobs stay ignored. Context alone does not establish retrieval success.

WebSocket ordering establishes the accepted-job order; workers never generate context. A browser with a locally pending UI request must ignore older voice contexts until its own request receives its existing matching progress/error, so a buffered context cannot displace a newer local intention. Reconnect drops connection-owned jobs/context and pending audition; existing composition remains. Backend context is for this connection only and is never replayed to another socket.

Compatible cases: new browser + old producer still supports UI-started jobs through the existing local request path; no context means no speculative adoption of unknown jobs. Existing consumers are strict and reject unknown message types, so new voice-context production requires a coordinated schema/browser/backend rollout, or an explicitly agreed capability handshake in a separate proposal. Do not call this bidirectionally compatible with old clients.

## B. Bound candidate preview, separate from musical edits

After A is available, add a ServerMessage variant for a resolved spoken/agent audition. Resolve ordinal references to an exact candidate before sending; never send an arbitrary model-provided URL:

```json
{
  "type": "candidate-preview",
  "id": "utterance-43:preview",
  "jobId": "utterance-42:job",
  "candidateId": "patch-2"
}
```

Browser validates both IDs against its currently displayed candidate list and uses that candidate's existing previewUrl/audio element. It refuses stale/missing jobs or candidates, duplicate request IDs, unavailable URLs, disconnects and blocked playback. Starting a new preview stops the previous preview. Superseding the displayed research job stops its preview. No session revision, patch, note, recording epoch or Undo history changes. Existing groove playback and capture continue independently. This is audition of the existing render recipe, not rendering with model timing in the audio callback.

Add a ClientMessage variant to report browser playback outcome without masquerading as a SessionCommand acknowledgment:

```json
{
  "type": "preview-ack",
  "id": "utterance-43:preview",
  "jobId": "utterance-42:job",
  "candidateId": "patch-2",
  "status": "started"
}
```

Proposed status enum: started, ended, rejected; optional nonempty reason for rejection. `started` follows resolved HTMLAudioElement.play(), `ended` follows the corresponding playback event, and rejected covers validation/playback failure. The service matches IDs to an outstanding preview and times out with an explicit error; it must not claim audition succeeded merely because a model called a tool or a server frame was sent. Browser playback events do not prove a human heard the output. Duplicate/stale acknowledgments cannot accept a patch or affect another preview. Accept remains the existing validated next-loop apply-patch operation, and Undo restores the accepted state.

During recording, recognized Groove audition speech is excluded before classified coverage even if preview is rejected. `Groove stop` keeps its established recording meaning; use an explicit preview-stop request in a later agreed extension if needed rather than overloading transport commands. Audition does not block speech verification or musical commits.

## Acceptance tests and delivery order

1. WS1 publishes schemas/examples and validates valid/missing/extra/stale field fixtures. Existing recorded examples must still parse. Review/agree rollout compatibility before producers use new variants.
2. WS2 consumer tests: idle panel adopts accepted voice context; exact source track remains bound; refine supersedes old job; late progress never revives it; a newer pending local UI request wins over buffered old voice context; disconnect has no replay. Existing UI-only requests continue working without context.
3. WS3 producer tests: context precedes worker progress; voice refine cancels old running work; ordinal audition binds the exact current candidate; no URL supplied by a model; preview acknowledgment matches its socket/request/job/candidate; errors/timeouts are explicit and have no musical mutation.
4. Browser integration: describe a sound with recognized speech, see candidates, audition candidate two without changing SessionState, refine, audition again, accept at a boundary, Undo the accepted patch, and keep the original notes/playback. Exercise stale candidate, blocked play, duplicate preview, replacement job and disconnect. Synthetic evidence must be labeled; human listening remains separate.

Blocking owner: WS1 for contract/rollout approval, then WS2/temporary WS1 for browser adoption and playback. WS3 can implement the agreed producers and typed tools immediately after the published interface is available. This proposal does not require provider credentials; model quality comparison separately waits for a local key and WS4 issue #17's frozen corpus.
