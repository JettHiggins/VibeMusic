# Agent working agreement

Read PLAN.md before work. It defines the product, workstream ownership, milestone gates, and acceptance criteria.

- Workstream 1 owns engine, integration, root build configuration, CI, vendored upstream, and shared contracts.
- Workstream 2 owns UI, persistence, microphone capture, and performance analysis.
- Workstream 3 owns backend, speech/agent orchestration, and sound research.
- Work in an owner-specific feature branch and submit small PRs. The integrator merges; do not push implementation directly to main.
- Milestone 0 must publish contracts and mocks before independent implementation. If absent, report dependency and return control; do not poll or invent competing interfaces.
- Propose shared contract changes before using them. Include compatible examples and tests.
- Keep real audio timing independent of backend/agent response time. Do not mark mock-only features complete.
- Handoffs include commit/PR, behavior, validation, limitations, and next integration step.
- Never commit secrets, raw microphone recordings, downloaded models, or large generated corpora.
- Setup/build/test commands are not established yet. Workstream 1 must document actual verified commands during milestone 0; do not invent commands or claim unrun checks.
