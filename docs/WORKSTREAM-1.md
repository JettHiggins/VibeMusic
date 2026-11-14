# Workstream 1 — playtest repair

Owner: Jett — this computer. Ownership: Engine, shared contracts, root build/CI, startup and integration.

Current scope and acceptance: [PLAYTEST-REPAIR.md](PLAYTEST-REPAIR.md). Read [STATUS.md](STATUS.md) for the latest contract publication/dependencies. Supersedes older feature assignments. No producer/consumer may invent shared interfaces; WS1 publishes them first. Finish independent reproduction while a contract is pending.

## Copyable goal

```text
/goal Own WS1 for the playtest repair milestone. Read AGENTS.md, PLAN.md, docs/STATUS.md and docs/WORKSTREAM-1.md; preserve current work and supersede the previous feature priority. First publish the plan/three assignments/coordination handoff, then metronome/erasure/countdown contracts before consumers depend on them. Reproduce and fix infinite stopped-record count-in using fixed audio-clock deadlines. Implement default-on playback/recording metronome with mute, empty startup and immediate targeted erasure that preserves unrelated committed/provisional music without stale resurrection. Coordinate Leo/Lenny through small reviewed PRs; preserve/defer sound-search work. Run checks, integrate repairs and publish a frozen playtest commit. Require the real microphone/fun test before completing this milestone; preserve the full roadmap.
```

## Handoff requirements

Use a fresh owner-specific repair branch from reviewed engine-integration; preserve existing work, .env and assets. Small PRs to engine-integration, merged by WS1. Include exact commit/PR, reproduction, behavior, checks, limitations and next integration step. Never commit secrets/raw microphone audio/models. Do not count synthetic evidence as human acceptance.

## Current checkpoints

Peer-reviewed #38/#39 and consumer repairs are integrated. Frozen test tag: `playtest-repair-1`. Follow FROZEN-PLAYTEST.md and STATUS.md; pause for Jett's microphone/fun test as requested. Preserve all current work and deferred research. Resume with the filled result sheet before changing the frozen session or claiming completion.
