# Workstream 1 — Melody reliability, Vochlea study and integration

## Latest playtest assignment

Read docs/MELODY-RETENTION-ROUND.md and the top of STATUS.md first. This supersedes the older copyable goal below.

```text
/goal Fetch origin; read AGENTS.md, PLAN.md, docs/STATUS.md, docs/MELODY-RETENTION-ROUND.md and issue9; preserve local work. Own event-retention tracing and musical timing/contract proposals from MELODY-RETENTION-ROUND.md. Reproduce preview-to-loss in manual versus speech mode, preserving verified timing and committed music. Publish compatible examples/tests for explicit rhythm snap and next-bar preparation before consumers use them; keep legacy sixteenth behavior and raw capture/key/erase semantics. Integrate owner fixes and validate against the new physical test. Publish a tested owner branch/PR and exact handoff; distinguish proposed, synthetic and human evidence.
```

Current scope: VOICE-RELIABILITY-ROUND.md. Read STATUS.md and issue #9 now; this replaces the older frozen-test and workstream instructions. All three work packages start independently against published interfaces. Preserve work and use current origin/engine-integration.

## Live preview priority

Jett explicitly selected live piano-roll preview first. Follow the latest section in VOICE-RELIABILITY-ROUND.md: implement streaming held-note view data and minimal Groovebox wiring, with immediate appearance/growth and correct reset/exclusion behavior; no live synth audition or premature commits. This takes priority over further threshold tuning. Coordinate low/high note range handling with WS2 using the published optional local fields.

## Copyable goal

```text
/goal Own WS1 for the voice-reliability round. Prioritize Jett’s live piano-roll preview interaction: it is integrated from 6a119b0; preserve the view-only/commit separation and coordinate WS2 low/high visibility before physical singing acceptance. Fetch origin; read AGENTS.md, PLAN.md, docs/STATUS.md, docs/VOICE-RELIABILITY-ROUND.md, docs/VOCHLEA-REFERENCE.md and issue #9. Preserve work; branch ws1/melody-reliability from current engine-integration. Own the temporarily assigned input DSP/calibration/segmentation/recorder files and engine integration. Reproduce quiet/normal humming, over-high calibration, missed fast adjacent notes and short full-bar holds; trace raw capture, extracted/committed duration and rendered envelope separately. Study Vochlea's documented sensitivity, stability and pitch feedback; record observations versus inference and implement measured fixes. Jett says key mapping was reasonable, so preserve existing scale semantics. Keep public input/wire interfaces compatible so WS2/WS3 work independently. Add focused and real-browser pipeline regressions, preserve drum/speech/timing/Undo behavior, publish small PRs and integrate peer work. Push a concrete handoff before the approximately one-hour check-in; continue independent follow-ups instead of waiting on another stream or a model provider. Physical-mic/fun acceptance remains required.
```

## Instrument-request integration steering

Jett reports spoken sound requests have never fetched a sound or visibly attempted research. WS3 owns that top-priority backend/speech path; WS1 verifies actual integrated candidates/preview/accept/Undo and truthful availability while continuing the melody work independently. Prior typed research tests do not establish spoken success.

## Delivery

Follow the exact ownership, P0 acceptance and independent follow-ups in VOICE-RELIABILITY-ROUND.md. Submit small PRs targeting engine-integration while continuing the goal. Publish docs/handoffs/voice-reliability-ws1.md with commit/PR, behavior, checks, limits and next step before the return check-in. WS1 integrates and maintains STATUS.md. Do not edit other streams' files or invent interfaces to bypass a wait. Models/secrets/raw audio stay out of Git. Old test tags remain immutable.
