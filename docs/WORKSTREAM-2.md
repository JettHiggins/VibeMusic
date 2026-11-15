# Workstream 2 — Compact microphone workspace

Current scope: VOICE-RELIABILITY-ROUND.md. Read STATUS.md and issue #9 now; this replaces the older frozen-test and workstream instructions. All three work packages start independently against published interfaces. Preserve work and use current origin/engine-integration.

## Copyable goal

```text
/goal Own WS2 for the voice-reliability round. Fetch origin; read AGENTS.md, PLAN.md, docs/STATUS.md, docs/VOICE-RELIABILITY-ROUND.md, docs/VOCHLEA-REFERENCE.md and issue #9. Preserve work; branch ws2/mic-workspace-cleanup from current engine-integration. Own UI/layout/theme/presentation only this round; WS1 owns input DSP/calibration/recorder internals and voice-input.ts. Fix mic-enabled text overflow and simplify the monochrome DAW workspace using existing VoiceInputState/methods. Keep transport/Record/Stop/Undo/Clear obvious; present concise input/pitch/key feedback and put advanced device/calibration/report/agent controls in deliberate optional sections. Study Vochlea's interaction clarity and document the decisions without copying its assets or inventing measurements. Browser-test mic/recording/calibration/long-error states at 1280x720, 1366x768 and 1440x900, including keyboard access. No new DSP/backend field is a prerequisite; keep working with current data. Push a small tested PR and exact handoff before the approximately one-hour check-in, then continue independent UX checks; do not wait on other streams.
```

## Instrument-request visibility

Jett reports spoken sound requests have never visibly started research. Keep actual search progress/results and actionable failure/unavailable states discoverable in the compact UI; do not hide an active request in collapsed details. WS3 owns recognition/research launch, so continue the base UI independently using existing events.

## Delivery

Follow the exact ownership, P0 acceptance and independent follow-ups in VOICE-RELIABILITY-ROUND.md. Submit small PRs targeting engine-integration while continuing the goal. Publish docs/handoffs/voice-reliability-ws2.md with commit/PR, behavior, checks, limits and next step before the return check-in. WS1 integrates and maintains STATUS.md. Do not edit other streams' files or invent interfaces to bypass a wait. Models/secrets/raw audio stay out of Git. Old test tags remain immutable.
