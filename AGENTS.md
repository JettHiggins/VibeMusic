# Agent working agreement

Read PLAN.md before work. It defines the product, workstream ownership, milestone gates, and acceptance criteria.

Read docs/STATUS.md at startup, before starting a capability, and before opening a PR. WS1 owns that current assignment/dependency ledger; HANDOFF.md and older issues contain history and may be stale. At these checkpoints fetch remote updates and read the coordination issue titled "Team restart: recording usability and real-device fixes". Preserve local work before integrating changes. Independent laptop sessions do not receive live instructions automatically; GitHub mentions notify people, not agent conversations.

When blocked, state the exact dependency, the agent/workstream responsible, and the change or evidence needed to unblock it. Complete independent work first, then remain available and wait/sleep instead of ending the goal or returning control solely because of the blocker. Use sleep intervals of at most 60 seconds so new instructions can be handled; check the specific dependency at reasonable intervals rather than busy-polling. Resume when the dependency is resolved. Do not invent competing contracts or cross ownership boundaries to bypass a blocker. This waiting policy supersedes older instructions in PLAN.md, STATUS.md and handoffs that say to return control or forbid dependency checks while blocked. Higher-priority runtime limits still apply.

- Workstream 1 owns engine, integration, root build configuration, CI, vendored upstream, and shared contracts.
- Workstream 2 owns UI, persistence, microphone capture, and performance analysis.
- Workstream 3 owns backend, speech/agent orchestration, and sound research.
- Work in an owner-specific feature branch and submit small PRs. The integrator merges; do not push implementation directly to main.
- Milestone 0 must publish contracts and mocks before independent implementation. If absent, name the blocking owner/dependency and follow the waiting policy above; do not invent competing interfaces.
- Propose shared contract changes before using them. Include compatible examples and tests.
- Keep real audio timing independent of backend/agent response time. Do not mark mock-only features complete.
- Handoffs include commit/PR, behavior, validation, limitations, and next integration step.
- Never commit secrets, raw microphone recordings, downloaded models, or large generated corpora.
- Setup and verified foundation commands are in docs/SETUP.md; protocol and directory ownership are in docs/CONTRACTS.md. OpenRouter free-model access is authorized by Jett; credentials stay backend-local and must never be printed or committed. Other provider access requires a new credential decision.
