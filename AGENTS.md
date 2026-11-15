# Agent working agreement

Read PLAN.md and docs/STATUS.md before work. At startup, before a capability, and before a PR: fetch origin, preserve local changes, and read [coordination issue #9](https://github.com/JettHiggins/VoiceSynthesizer/issues/9). STATUS is the current assignment ledger; Git history contains retired plans and reviews.

- Start owner-specific branches from reviewed origin/engine-integration. Open small PRs against engine-integration; WS1 integrates. Do not push implementation directly to main.
- WS1 owns engine, shared contracts, root build/CI and vendored upstream. WS2 owns UI, persistence and normally microphone/input analysis. WS3 owns services/agent, speech, language orchestration and sound research.
- **Current round override:** WS1 owns apps/web/src/input/{pitch,analysis-worker,calibration,recorder,mic-check,voice-input,processing-profile}.ts, plus microphone.ts/capture-worklet.ts when needed for measured fixes. WS2 owns UI/presentation/persistence and uses existing input interfaces. See docs/MELODY-RETENTION-ROUND.md; general ownership otherwise persists.
- Propose shared contract changes with compatible examples/tests before consumers depend on them. Keep browser state authoritative and audio timing independent of agent latency. Mocks and synthetic tests do not establish physical acceptance.
- Finish independent work before reporting an exact dependency, responsible owner and unblock condition. Do not dependency-poll or invent competing interfaces. Independent laptop agents must explicitly read shared GitHub updates; mentions do not inject conversation instructions.
- Handoffs state commit/PR, behavior, validation, limitations and next integration step. Keep STATUS concise; replace obsolete assignments rather than appending history.
- Never commit or print secrets, raw microphone recordings, downloaded models or generated corpora. Diagnostics containing real audio require opt-in.
- Local faster-whisper and existing free-only OpenRouter are selected. Jett selected a Google Cloud/Vertex AI migration using a friend's credits; adapter/billing/project setup is pending. No live Google calls until the credit-backed project and local authentication are configured. Do not route a Google credential through OpenRouter or silently enable another paid provider.

Setup: docs/SETUP.md. Protocol: docs/CONTRACTS.md. Current goals: docs/WORKSTREAM-{1,2,3}.md. Keep licenses and the pinned vendor revision intact.
