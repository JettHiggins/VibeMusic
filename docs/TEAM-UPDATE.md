# Team restart: recording usability and real-device fixes

Current authoritative assignments: [docs/STATUS.md](https://github.com/JettHiggins/VoiceSynthesizer/blob/engine-integration/docs/STATUS.md). This replaces the older pending-blocker summary. Independent agent sessions must fetch/read it at their next checkpoint; mentions do not update their conversations automatically.

@leoAndrade2332 @lennyyanza — Jett selected **OpenRouter, free models only**. Local faster-whisper stays selected for speech. The LLM-provider decision and issue #3 answers no longer block work. Never paste keys into GitHub or agent chat; transfer distinct per-person keys through encrypted secret sharing and keep them backend-local. Current runtime has no OpenRouter/.env adapter yet, so installing a key alone does not enable Deep Agents.

Reviewed #15 c62613d, #21 d637213, #22 75f4181 and #23 d34f10e are now integrated. Delayed capture context and declared SciPy blockers are fixed. Combined schema/Node/live-service/WASM/build checks passed; fresh speech install: 167 backend passed / 5 skipped, plus one opt-in real-model synthetic test. Optional mic-check script syntax passed. No human mic or live API acceptance is claimed.

- **Lenny / WS3:** implement backend OpenRouter + LangChain Deep Agents with validated typed tools in a small PR to engine-integration. Start from current integration. Evaluate inclusionai/ling-3.2-flash:free as an initial tool-capable candidate; no model winner is established. Keep configurable free-only selection, no paid fallback, bounded agent calls and quota/timeout errors. Coordinate configuration/docs and use WS4's corpus. Speech and sample timing remain independent of LLM latency.
- **Leo / WS2:** review/open PR for WS1's browser speech branch bdb4ffc if available. Do not duplicate browser speech wiring. Continue real-device melody-loading reproduction and input tuning using docs/MIC-TESTING.md; #23 improves diagnostics but does not prove the original failure fixed.
- **WS1:** integrates reviewed capabilities, owns speech browser branch temporarily and final end-to-end acceptance. ws1/speech-capture includes dev-worklet refresh; old integration-preview is parent history, consumer is already shared via #20.
- **WS4:** #17 command corpus first, then #18 listening summarizer and #19 sound rubric. No production overlap or credentials needed.

Main remains documentation-only; reviewed product is engine-integration. Remaining gates: browser speech review/merge, actual Deep Agents, calibrated human drums/melody/phrase correction, blind listening, ten-minute audible playback and full hands-free scenario. See STATUS.md for exact evidence and issue #3 answers.

**WS1 combined revalidation:** browser review head bdb4ffc now adopts reviewed backend/integration 6377130. Real local faster-whisper + actual browser/PCM/WebSocket/WASM passed again with synthetic Record kick / Groove stop and three generated hits at expected steps [21,25,29], playback continuing. Fresh declared speech dependencies, no manual workaround. Schema/full Node/explicit live-service integration/build passed. Test service/browser stopped. @leoAndrade2332 @lennyyanza: please open/review this branch against engine-integration; peer review and human microphone acceptance remain open. No live API call.


**New speech/melody blocker for @lennyyanza:** WS1 bdb4ffc adds local-stt-melody.js using
real local faster-whisper + actual capture/PCM/YIN/socket/WASM. Record melody + three pitched
tones + Groove stop passes with a 2.5 s pause, but fails twice with a 0.5 s pause (/?testStopAt=8):
zero notes committed despite Record/Stop recognition and continuing playback. Latest
command-span [286932,428933] at 44.1 kHz covers 3.22 s, including singing. Refine backend
whole-segment command exclusion in a focused PR; preserve measured wake/command coverage,
capture-time context and no command leakage. Do not merely shorten all hangovers or remove
exclusion. Reproduction and caveats: docs/BROWSER-SPEECH.md on bdb4ffc. This is separate from
Deep Agents and the original physical loading error. No human/API acceptance claimed.
