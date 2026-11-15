# Musical controls integration review

Branch: ws1/musical-controls-integration, based on reviewed engine-integration c604170.

Combines ws1/immediate-patches 25a6388, ws1/key-snapping a2278a3 and ws1/browser-action-routing fb68594 with reviewed real sound research. Merged as PR #41 after WS1 integration audit; shared implementation/tests/manifests match the exact green dcc0370 head.

Interactive factory presets, patch controls, manual research acceptance and voice candidate acceptance now request immediate smoothed patches. Explicit next-loop patches remain valid. Rapid backend patch acceptances serialize until final acknowledgment so they use the latest revision; immediate stop controls bypass that wait. The browser patch queue still coalesces slider changes and preserves music.

Key engine and browser routing retain their focused handoffs in IMMEDIATE-PATCHES.md, KEY-SNAPPING.md and BROWSER-ACTION-ROUTING.md. No key UI or real browser calibration executor is invented here. Leo owns those consumers; Lenny owns endpointing, acoustic stop and new speech tools. Coordinator owns exactly one browser-action dispatch.

Validation: Node 222 passed/one optional skip; backend 390 passed/six optional skips; shared checks and production build passed. Real SLOOP-renderer/research/engine acceptance+Undo passed, now requiring acceptance without advancing the engine clock. Chromium actual Preset dropdown during active recording applied in 37 ms in this run, preserving every track's notes/hits, playback and recording epoch. Script: tests/browser/immediate-preset.js. It uses synthetic silence, not a real microphone or human hearing. Regression also covers three rapid patch proposals waiting for final acks while stop-recording remains immediate.

Next: fix/re-review PR #40 lifecycle defects and integrate the actual speech tools. WS1 used its assigned integration authority; no independent peer approval is claimed. WS2/WS3 should base consumers on the reviewed combination. Acoustic whole-sentence STT/LLM, reliable voice stop, visible key settings, actual calibration execution and real sound quality remain acceptance gates; this is not the next frozen human test yet. Never commit credentials, microphone audio, model weights or the temporary CLAP corpus.

## Browser singing-path follow-up

`tests/browser/key-capture.js` passed both Off and C-major cases through a real browser capture worklet, YIN worker, recorder and SLOOP WASM. Raw detected MIDI stayed [60,61,68] in both takes. Off committed [60,61,68]; C major committed [60,60,67]. Step/duration arrays matched exactly ([20,3], [24,3], [28,4] in these runs), three notes committed and playback continued. Analysis p95 was 7.9/7.8 ms on this machine. This verifies integrated pitch/timing behavior using synthesized sung tones; it does not prove acoustic recognition or replace Leo's visible key controls/human test.
