# Workstream 3 — Protocol and resilient speech control

Current scope: VOICE-RELIABILITY-ROUND.md. Read STATUS.md and issue #9 now; this replaces the older frozen-test and workstream instructions. All three work packages start independently against published interfaces. Preserve work and use current origin/engine-integration.

## Copyable goal

```text
/goal Own WS3 for the voice-reliability round. Fetch origin; read AGENTS.md, PLAN.md, docs/STATUS.md, docs/VOICE-RELIABILITY-ROUND.md and issue #9. Preserve work; branch ws3/speech-resilience from current engine-integration. Top priority: fix the actual spoken instrument request -> real research progress/candidates -> audible preview -> accept/Undo path; Jett reports it has never even attempted a search. Trace STT transcript through parser/model, configuration and browser delivery; support known sound requests without requiring a healthy LLM provider, and report missing real research capability explicitly. Typed/mock-only tests are insufficient. Handle published browser-status/browser-action-ack messages through the real service with clock/inputRevision and stale-job guards; current Connection falls through to unsupported. Make exact essential commands work during LLM 402/429/timeouts with bounded queues/cooldown, safe degraded feedback and no retry or mutation replay storms. Use local/scripted provider tests rather than burning quota. Then finish whole-sentence endpointing and reliable Groove stop with actual speech/coverage tests, and bounded key/timeline/browser tools against the integrated executor. Existing OpenRouter free-model/local Whisper decisions persist; no new key/provider decision or #40/#41 wait. Keep frontend/contracts unchanged and publish a small tested PR and exact handoff before the approximately one-hour check-in. If quota is exhausted, continue local parser/STT/protocol/error tests and report the external limit honestly; retain Deep Agents and real human acceptance requirements.
```

## Delivery

Follow the exact ownership, P0 acceptance and independent follow-ups in VOICE-RELIABILITY-ROUND.md. Submit small PRs targeting engine-integration while continuing the goal. Publish docs/handoffs/voice-reliability-ws3.md with commit/PR, behavior, checks, limits and next step before the return check-in. WS1 integrates and maintains STATUS.md. Do not edit other streams' files or invent interfaces to bypass a wait. Models/secrets/raw audio stay out of Git. Old test tags remain immutable.
