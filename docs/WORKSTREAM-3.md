# Workstream 3 — playtest repair

**Freeze checkpoint:** `playtest-repair-1` is ready for the physical test. Your repair PRs are integrated. Preserve work, follow FROZEN-PLAYTEST.md/STATUS.md and help record results; do not add features or change code during the frozen session. The goal below remains the repair scope if human testing reveals failures.

Owner: Lenny. Ownership: Backend, speech recognition/classification, command orchestration and sound research (currently deferred).

Current scope and acceptance: [PLAYTEST-REPAIR.md](PLAYTEST-REPAIR.md). Read [STATUS.md](STATUS.md) for the latest contract publication/dependencies. Supersedes older feature assignments. No producer/consumer may invent shared interfaces; WS1 publishes them first. Finish independent reproduction while a contract is pending.

## Copyable goal

```text
/goal Own WS3 for the playtest repair milestone. Read AGENTS.md, PLAN.md, docs/STATUS.md, docs/WORKSTREAM-3.md and PLAYTEST-REPAIR.md. Preserve current sound-search work; use a fresh repair branch from reviewed engine-integration. Investigate noisy-room classification/verification across successive takes on synths 1, 2 and 3. Prevent unexplained coverage stalls, wrong targets and command exclusion that erases music; preserve capture-clock context and real classified coverage. Implement deterministic voice metronome and precise bar/beat/sixteenth erasure using WS1-published contracts, without LLM latency. Review offline-test isolation. Do not add sound-search features during this repair pass. Submit focused PRs with limitations and participate in the frozen real-mic/fun test.
```

## Handoff requirements

Use a fresh owner-specific repair branch from reviewed engine-integration; preserve existing work, .env and assets. Small PRs to engine-integration, merged by WS1. Include exact commit/PR, reproduction, behavior, checks, limitations and next integration step. Never commit secrets/raw microphone audio/models. Do not count synthetic evidence as human acceptance.
