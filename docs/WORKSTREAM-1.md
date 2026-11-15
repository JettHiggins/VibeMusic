# Workstream 1 — musical control and hands-free completion

**Current human test request:** Jett wants an interim test before WS3 finishes. Use playtest-musical-controls-1 and INTERIM-PLAYTEST.md; older frozen repair instructions below are historical. Preserve development work in its own branch/worktree.

Current scope: HANDSFREE-COMPLETION.md; assignments/dependencies: STATUS.md and issue #9. This supersedes the prior freeze instructions.

```text
/goal Own WS1 for musical control and hands-free completion. Read AGENTS.md, PLAN.md, docs/STATUS.md and docs/HANDSFREE-COMPLETION.md. Publish new shared contracts/examples before consumers; implement authoritative optional key snapping and immediate smoothed patches, review/adopt #29/#31, coordinate small PRs and verify the complete microphone-to-command/research/browser path. Preserve the previous frozen tag and all work. Publish the next test build and require real whole-sentence/hands-free/fun evidence before completion.
```

## Historical handoff — superseded

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
