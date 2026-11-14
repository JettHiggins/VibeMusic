# Musical controls integration review

Branch: ws1/musical-controls-integration, based on reviewed engine-integration c604170.

Combines ws1/immediate-patches 25a6388, ws1/key-snapping a2278a3 and ws1/browser-action-routing fb68594 with reviewed real sound research. The shared branch still needs this integration reviewed and merged.

Interactive factory presets, patch controls, manual research acceptance and voice candidate acceptance now request immediate smoothed patches. Explicit next-loop patches remain valid. Rapid backend patch acceptances serialize until final acknowledgment so they use the latest revision; immediate stop controls bypass that wait. The browser patch queue still coalesces slider changes and preserves music.

Key engine and browser routing retain their focused handoffs in IMMEDIATE-PATCHES.md, KEY-SNAPPING.md and BROWSER-ACTION-ROUTING.md. No key UI or real browser calibration executor is invented here. Leo owns those consumers; Lenny owns endpointing, acoustic stop and new speech tools. Coordinator owns exactly one browser-action dispatch.

Validation: Node 222 passed/one optional skip; backend 390 passed/six optional skips; shared checks and production build passed. Real SLOOP-renderer/research/engine acceptance+Undo passed, now requiring acceptance without advancing the engine clock. Chromium actual Preset dropdown during active recording applied in 37 ms in this run, preserving every track's notes/hits, playback and recording epoch. Script: tests/browser/immediate-preset.js. It uses synthetic silence, not a real microphone or human hearing. Regression also covers three rapid patch proposals waiting for final acks while stop-recording remains immediate.

Next: focused peer review of combined changes, then WS1 merges into engine-integration. WS2/WS3 should base consumers on the reviewed combination. Acoustic whole-sentence STT/LLM, reliable voice stop, visible key settings, actual calibration execution and real sound quality remain acceptance gates; this is not the next frozen human test yet. Never commit credentials, microphone audio, model weights or the temporary CLAP corpus.
