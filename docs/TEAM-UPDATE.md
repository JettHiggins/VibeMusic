# Team restart: current integration and next gates

@leoAndrade2332 @lennyyanza — WS1 reviewed/integrated #24–#27, resolving overlap while preserving timed wake context, compound commands, Deep Agents stale-result guards and browser coverage/recovery. Start from latest engine-integration; main remains documentation-only. The old provider-choice, issue #3, browser PR and deterministic all-note-exclusion blockers are resolved.

Fresh declared install: backend 234 passed / six optional skips, Node 162 passed / one skip, schemas/live-service/WASM/build pass. Original eSpeak short-pause melody repeat, long-pause melody and drums passed through actual browser + real local STT. First short-pause run preserved notes but missed strict grid timing; keep that WS2 timing concern open. One live OpenRouter Deep Agents smoke proposed tempo 110 correctly in 4547 ms; not a corpus/latency acceptance result. No key copied/printed/committed.

- WS1: approve/publish voice research context/non-mutating audition contracts from WS3 proposal, coordinate rollout, integrate and validate.
- WS2: physical loading/late-hit/near-grid pitch timing evidence; no duplicate speech wiring.
- WS3: implement voice research producers/tools after shared contracts; live provider evaluation with WS4 corpus. Existing Deep Agents refusal of unsupported voice audition is correct until rollout.
- WS4: frozen #17 corpus first, #18 listening summarizer and #19 rubric next.

Keys: distinct revocable per-person keys through encrypted sharing; backend .env only. Easy setup: docs/TEAM-API-SETUP.md. Old integrated remote branch tips were retired atomically with exact-tip leases with ancestry/tips recorded in docs/BRANCH-CLEANUP.md; current ws3 work and speech/review branches stay intact. Preserve local work, fetch/prune and start new capability branches from integration rather than resurrecting a retired branch.

Remaining gates: voice sound jobs visible in browser and non-mutating voice audition, real-device mic/loading/timing/phrase correction, live model corpus/latency, three-listener evaluation, full hands-free session and ten-minute audible playback. docs/STATUS.md is authoritative; independent sessions must read it at their next checkpoint.
