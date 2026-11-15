# Instrument request trace — a hidden unavailable result

WS1 reproduced this with the actual combined browser app/coordinator/WebSocket, actual Python service (PR43 protocol/cooldown 4132702) and real SLOOP. STT/LLM/research providers were disabled explicitly and no API call was made. This is a typed-transcript isolation check, not a claim of acoustic or real-model sound-search success.

1. Start the service with GROOVE_VOICE_RESEARCH=0 and GROOVE_RESEARCH unset (the default/unconfigured path).
2. Connect the browser, select Synth 1, and submit `I want an 80s electric piano` through the production coordinator.
3. The server returns a real `research` frame with a new jobId, status failed, progress 0, no candidates and error `sound research is not configured: it needs the offline SLOOP renderer from Workstream 1 and an embedding model`.
4. The actual ResearchController snapshot remains jobId null, status idle, error null. No context was emitted for this voice-origin request with the flag off, so the browser cannot adopt its failed job. The user sees no sound attempt or actionable search failure.

This explains a concrete silent path but does not establish which configuration was running on Lenny's laptop. Check process checkout, health, voiceResearch flag, real renderer/embedder and corpus before attributing his exact failure. Earlier successful typed/real-CLAP tests used an explicitly enabled and configured isolated service, so they do not prove the default deployment works.

WS3 required correction: a recognized instrument request must produce a visible, correctly correlated progress/result or explicit unavailable error. For a disabled/unconfigured voice capability, refuse visibly on the ordinary request/error path instead of launching an uncorrelated hidden job. Preserve manual research request behavior, stale-job guards, exact candidate provenance and old-job isolation. Do not make any unsolicited error adopt an unrelated active job. Verify default-off, enabled-but-unconfigured and enabled/configured scenarios. The user-facing configuration message should describe the actual setup/action rather than implying WS1 has not implemented the renderer that is already integrated.

Then prove actual spoken describe -> configured real CLAP/SLOOP progress/candidates -> real preview -> accept/Undo. Keep acoustic recognition, typed transport, model configuration and human hearing evidence distinct. The default-off negative check must stay truthful; do not substitute mock candidates or switch to a paid provider.

Evidence collected in this run: a real server failure frame reached the browser socket, while controller status stayed idle and error stayed null. This finding is independent of the forced-cut valid-prefix issue in PR43-SENTENCE-REVIEW.md.
