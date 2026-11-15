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

## Fixture predecode follow-up

WS1 applied WS3's harness observation: decode all5 synthetic clips **before** enabling capture, then only create/play the prepared sources during the speech stream. On another actual local-model/browser run, search and spoken audition still completed with real started/ended audio acks, but capture again became discontinuous before apply-patch (171 speech-audio chunks sent, no apply-patch command). The robotic request was heard as80 0 trick piano on this run. Thus predecoding alone did not eliminate the observed failure in this environment. The probe now avoids that known confound; it remains an unfinished diagnostic. Dynamic synthetic source insertion and host resource pressure still differ from a physical continuous microphone; neither a universal product regression nor reliable full acoustic acceptance is established. All generated public assets and owned test browser/model/server processes were cleaned up afterward.

## Continuous-input isolation (no production changes)

Three additional diagnostics narrow the failure; none closes full acoustic acceptance:

- `continuous-acoustic-research-probe.js` prepares one42s buffer with continuous low room tone and all synthetic phrases, creates/connects its source before capture, and makes no source/decoder changes during capture. It seeds two actual engine notes to test preserving nonempty music. The stream stayed ready through41s/438 speech-audio chunks without a gap; maximum observed socket buffer229,638bytes (below the256KiB guard). Whisper correctly produced80s electric piano and the real job began. Its fixed cancel at11s arrived before retrieval produced candidates, so later audition/accept correctly refused; an actual Undo was recognized. This is a healthy continuous-capture observation with an incorrectly early test schedule, not a passing research sequence or latency guarantee.
- `worklet-acoustic-research-probe.js` instead generates continuous room tone in one prepared synthetic microphone worklet and injects predecoded speech into that existing source only when real candidates/progress permit. It keeps actual production capture/speech workers, local models and exact preview/accept/Undo assertions. A fresh-session run failed **before speech readiness**, at the existing socket-backlog guard (22 chunks; max264,584bytes; only connected received). The full sequence therefore did not run. The earlier shared-session diagnostic was not counted because stacked socket log wrappers duplicated counts; use a **fresh browser session per different probe**. This run does not prove source insertion is the sole cause, nor that the backend model or physical microphone is broken.
- `speech-throughput-probe.py` sends3s of quiet PCM plus transport to the same actual model-configured service using a direct Python WebSocket. It asserts availability, all30 actual verification replies, final capture frame132299 and zero errors. It passed:31 replies total, availability22ms,30 verified,3.339s elapsed. No scripted recognizer/model output or fake watermark. Quiet PCM does not invoke STT, so this establishes only the direct quiet transport/classification path, not STT/CLAP load or browser capacity.

The host again showed little available RAM/full swap; the precise browser/resource cause remains unproven. No capture/socket/coverage limit was raised and no production implementation changed. Do not repeat threshold changes or claim a transport fix from these observations. The complete scripted research sequence and physical voice/noise/fun acceptance still need reliable evidence on the test laptop. Generated public clips and owned browser/model/dev processes were removed/stopped after the diagnostics.

For the direct check, from repo root run `python docs/reviews/speech-throughput-probe.py` against the real local model-configured service on8001. For either browser probe, generate the five temporary clips listed above, open a fresh named playwright-cli session on5174, run its review JS with --filename, then close that session and remove the clips. The fixed continuous schedule intentionally exposes early-cancel timing; the worklet probe waits for real results but is currently a failing diagnostic in this host environment. Neither is included in the passing browser regression count.
