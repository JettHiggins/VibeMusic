# WS4: evaluation and acceptance support

Start with the command corpus, then the listening summarizer, then held-out sound cases. Full tickets are in WS4-TICKETS.json and are published as GitHub issues by the coordination workflow. All three can start without API access, models or a running app. Own only evals/, tools/evaluation/ and docs/WS4-HANDOFF.md; do not change the active UI, speech, engine or contract implementations.

Copy this into the fourth teammate's agent:

> Read AGENTS.md, PLAN.md, docs/STATUS.md, docs/WS4-START.md and issue #9 in JettHiggins/VoiceSynthesizer. Own WS4 evaluation support. Find the open issue titled "WS4: build the hands-free command acceptance corpus" and complete it first on ws4/command-corpus, branched from reviewed origin/engine-integration after preserving local work. Follow its file ownership and acceptance criteria. Open a focused PR to engine-integration with validation and a handoff; do not call APIs, configure keys, download models or edit other workstreams. Then take the listening-summary and held-out sound-case tickets in priority order. Label synthetic evidence honestly; never fill human listening results yourself. Do not poll dependencies.
