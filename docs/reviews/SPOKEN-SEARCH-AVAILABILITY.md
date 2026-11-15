# Spoken-search availability and acoustic integration

WS1 combined current shared browser/engine/live preview with **only** WS3 source bec6a8f (local cherry-pick95575d5). The sentence/probe work remains excluded pending its separate review. This is a narrow availability/import-path capability, not full speech/research acceptance.

## Visible unavailable states — pass

`tests/browser/spoken-search-unavailable.js` uses the real app, parser, Python WebSocket and SLOOP engine. It redirects the test socket from8000 to8001 but supplies no server response or candidate. Submit the complete typed transcript `I want an 80s electric piano`:

- GROOVE_VOICE_RESEARCH=0 / GROOVE_RESEARCH unset: a correlated ordinary error says spoken search is off and names GROOVE_VOICE_RESEARCH=1. No hidden research job/context starts. The error is visible in the DOM and composition unchanged.
- GROOVE_VOICE_RESEARCH=1 / GROOVE_RESEARCH unset: the context is adopted, then the actual backend failed job is visible in the ResearchController and DOM. Composition unchanged. The remaining backend error copy still mentions needing WS1's renderer although that renderer is integrated; Lenny should replace this with actionable configuration guidance.

These supersede the original hidden default-off failure in VOICE-INSTRUMENT-REQUEST-TRACE.md for this capability. They are typed negative-path evidence, not proof of acoustic recognition or real-model retrieval quality.

Backend checks on this independent combination: **418 passed /6 optional skips** (including real SLOOP renderer tests; no custom PYTHONPATH needed for the new import fix). Shared checks/production build pass. Provider-disabled actual WebSocket/WASM integration passes. No external language/provider request was made.

## Actual local speech/model probe — partial, not accepted

`reviews/acoustic-local-research-probe.js` is an **unfinished full-path probe**, not a passing regression. It uses espeak-ng synthetic spoken WAVs injected at the browser MediaStream boundary, then the actual capture/speech worker, actual local faster-whisper1.2.1 base.en CPU/int8, deterministic parser, cached original CLAP music weights, matching SLOOP artifact e8119882… and the real preview player. No typed utterance or scripted transcript/candidate/model output is used. LLM/key are explicitly blank; HF_HUB_OFFLINE=1 prevents model downloads. The prepared matching corpus is ignored /tmp/voicesynth-live-clap-corpus. Local Python reused installed speech/research dependencies; generated synthetic WAVs were removed from public/ after the probe and are not committed.

Observed default uvicorn transport run: real research context and real candidates reached the app; the robotic clip was heard as `80 0 trick piano` on that pass. A spoken audition reached candidate-preview and HTTP preview returned200, but playback did not start within5s and speech subsequently failed with `Speech connection is behind`. A second attempt failed before readiness, with only connected received. No success claimed for either.

A diagnostic restart explicitly selecting uvicorn's websockets transport (not a product recommendation/default change) recognized **80s electric piano**, returned **five real candidates**, recognized the spoken cancel of optimization while retaining those candidates, and recognized audition candidate two. Actual preview acknowledgments were **started then ended**, with HTTP200 audio. Before acceptance the capture path failed with `Microphone capture discontinuity`; no apply-patch command was emitted. Full probe therefore timed out, and acoustic accept/Undo remain unverified. Do not attribute the difference to transport alone: restart/warm state/resources also differed.

At the failure observation the host reported7,479MiB RAM total,631MiB available and all8,191MiB swap occupied. Resource pressure is observed; it is not a proven sole cause of either failure or a machine requirement. Keep capture/backpressure/verification guards intact. Reproduce on an adequately resourced device and trace capture gaps, socket bufferedAmount and server responsiveness before changing architecture or bounds. This result proves a real acoustic route can launch search and audition, not reliable whole-session performance, physical-human recognition or sound/listening quality.

## Reproduce the full probe

Configure the real local service/CLAP/corpus per SETUP/REAL-CLAP-INTEGRATION, with local faster-whisper enabled too. Use8001 and GROOVE_PUBLIC_URL=http://127.0.0.1:8001, frontend5174. Ensure health reports actual SLOOP/CLAP, actual faster-whisper, parser and voiceResearch:true. Generate these temporary diagnostic assets (synthetic speech, not raw microphone data), run the probe, then remove the assets:

```sh
espeak-ng -v en-us -s 145 -w apps/web/public/__synthetic-instrument-request.wav 'I want an eighties electric piano.'
espeak-ng -v en-us -s 145 -w apps/web/public/__synthetic-cancel.wav 'Cancel.'
espeak-ng -v en-us -s 145 -w apps/web/public/__synthetic-audition.wav 'Audition candidate two.'
espeak-ng -v en-us -s 145 -w apps/web/public/__synthetic-accept.wav 'Use candidate two.'
espeak-ng -v en-us -s 145 -w apps/web/public/__synthetic-undo.wav 'Undo.'
playwright-cli -s=acoustic-research open http://127.0.0.1:5174
playwright-cli -s=acoustic-research run-code --filename=docs/reviews/acoustic-local-research-probe.js
playwright-cli -s=acoustic-research close
```

The final desired result still requires real preview completion, exact candidate acceptance and Undo preserving music/playback, without restarting speech mid-flow or bypassing capture. Then run the human microphone/fun acceptance. Never check generated clips, models or corpus into Git. The current probe fails before completing that gate; earlier typed end-to-end acceptance is separate evidence and cannot close it.
