# Latest physical playtest: retain the melody, improve timing, migrate language provider

This continues VOICE-RELIABILITY-ROUND.md and its existing AGENTS.md temporary ownership. No implementation ownership changes. Start from current engine-integration, not main or an old test tag. Preserve local work, backend-only credentials and existing producer/consumer compatibility.

## Human evidence and priority

Jett reports voice control slightly better but still heavily rate-limited; deterministic commands remain useful. Fast `duh duh — duh duh` appeared captured, then earlier notes disappeared while a few later notes remained. The suspicion of speech exclusion is plausible, not yet the established cause; speech versus manual mode and exact failure messages are being clarified. Melody/bar-start timing is still hard. Jett wants to use a friend's $10 Gemini API credits instead of OpenRouter free models; whether those credits belong to AI Studio/Gemini Developer API or Google Cloud/Vertex is pending clarification. Never request a key in chat or commit one.

Priorities: **P0 keep performed notes**, **P1 make rhythmic placement/downbeat entry easier**, **P1 Gemini adapter/access**, with independent work available to all3 owners. A provider switch alone does not fix performance exclusion, and external paid tiers still have project quotas.

## Verified current behavior and first reproduction

- Starts and ends already quantize to nearest sixteenth; CONTRACTS.md and engine/performance.ts are authoritative. At120BPM this is125ms. Key snapping changes pitch, not rhythmic placement. Coarser rhythm snap must be explicit and must preserve intended quick sixteenths when that setting is chosen.
- Current Record starts next beat during playback, with a one-bar count-in from stopped. Starting sooner does not mean the performer has a clear bar-start preparation cue.
- Speech-mode live previews are view-only until classified. Command-span overlap drops pending events; a speech/connection failure also discards unverified capture. Neither is proof of an Undo reverting already saved music. Trace preview -> finalized/queued -> exclusion/reset/commit -> resulting notes before naming the cause.
- A real Connection/parser reproduction with a SCRIPTED transcript `Groove, duh duh duh duh` (also da/doo variants) emits a span covering the supplied musical interval and queues a language job. Unaddressed duh already stays performance; Groove stop still produces stop-recording. Proposed acceptance guard: wake-like text followed only by musical syllables must not exclude the take or call the LLM. Current result:3 proposed guard cases fail,2 controls pass. Run reviews/MELODY-SPEECH-PROTECTION-reproduction.py explicitly with PYTHONPATH=services/agent. It is a diagnostic/proposed acceptance case, not a passing feature or proof of Jett's actual Whisper output.

## WS1 — event retention and musical timing

Own the currently assigned recorder/input/engine/contracts files. First reproduce the same short source in manual and speech mode, distinguishing actual command spans from verification stall/disconnect, recording epoch reset, overlapping-note replacement and ordinary provisional-to-committed changes. Capture only bounded event/frame/reason metadata; raw mic audio remains opt-in. Do not disable verification or accept unclassified command audio just to keep the roll populated.

Publish a compatible shared proposal/examples/tests before any new fields/operations: selectable rhythmic recording snap (quarter/eighth/sixteenth, legacy/default sixteenth) and an explicit next-bar recording start/count-in option. Existing16-cell-per-bar storage stays; coarser timing snaps to multiples of those cells. Use the same calibrated frame/grid-origin calculation in preview, commit and erase fences. Preserve pickups/rests and phrase phase unless the user explicitly chooses a phrase shift; do not silently move the first sung note onto beat1 or quantize twice. Changes during capture need an explicit take/epoch policy. Tempo/key/Undo/erasure/loop wrap must remain coherent. These are proposals until schemas/examples/tests are merged; no competing consumer interfaces.

WS1 can start retention tracing and timing proposal now without a provider/key answer. Integrate reviewed owner fixes in small capabilities; report physical evidence separately from synthetic tests.

## WS2 — downbeat preparation and truthful recording feedback

Own UI/presentation. Keep the merged monochrome workspace/live range; do not redesign it. Use current transport/count-in/recorder state immediately to make bar/beat and recording onset legible. Show concise preparation/count-in and distinguish heard/live versus waiting for verification versus committed notes. Explain a real exclusion/reset using actual available reason data, not a guessed cause from the dropped counter. No new wall of buttons. Prepare a compact rhythm-snap/start choice only against the merged WS1 contract; basic phase/feedback work does not wait on it. Keep manual range navigation, live erase/Clear/Undo, laptop layout and keyboard access.

## WS3 — protect performance classification and Gemini

Own service/speech/language. First close the supplied musical-syllable reproduction: reject spurious command interpretation/model submission for a take consisting only of musical syllables even if the transcript adds a wake-like token. Share the musical-syllable vocabulary without circular imports; cover duh/da/doo/hum variants and actual stop/clear/undo, unknown real addressed requests, commands beside singing, timed/untimed STT, late results and refused continuations. Do not broadly treat all unknown speech as music or skip proper command-span exclusion. Trace actual transcript/word alignment and span scope; a guessed whole-segment span must not casually wipe a melody. Coordinate any span/ack interface proposal with WS1 first; no new wire shape is needed for the lexical guard.

Add Gemini as a provider behind the existing Deep Agents proposal/validation harness. Keep deterministic commands/local STT/performance audio independent of the LLM. Preserve queue limits, cooldown, no replay/storms, stale-input guards, exact known research routing, and candidate provenance. Test provider selection, missing credentials, Google-style429/timeouts and existing OpenRouter behavior offline. Avoid retrying a failed mutation/tool call. Health/error labels must show the actual provider rather than hardcoded OpenRouter.

Jett's Gemini-credit choice supersedes OpenRouter-only provider guidance for this migration. Billing service and a backend-local key/project still need confirmation before live calls; do not assume consumer Gemini subscriptions or generic cloud credits fund the same API. Provisional Developer API configuration is GROOVE_LLM=gemini, GOOGLE_API_KEY backend-local and an explicitly verified supported GROOVE_LLM_MODEL; these names are a proposed adapter setup, not already supported. Vertex configuration differs. Do not route a Google key through OpenRouter or silently add paid fallbacks. Scaffold provider-neutral code/tests while the billing answer is pending. No live calls/model choice/spend commitment until the correct credit-backed project is identified and configured.

## Acceptance and handoff

Same fast repeated phrase stays in the composition after verification and subsequent loop boundaries in manual and speech mode; no silent erasure from a musical-vocalization transcript. Real Groove stop excludes only command audio and keeps playback. Actual failure/disconnect is explained and music already committed stays intact. Quiet/held/fast notes, key snapping, Undo/Clear/individual erase and loop crossing remain covered.

Rhythm setting visibly changes expected grid placement; sixteenths retain quick pairs, eighths/quarters behave as selected. A next-bar/count-in option lets the singer prepare and start on a clearly marked downbeat, without a hidden4-bar wait or arbitrary phrase rotation. Validate using calibrated capture, actual engine commit and physical singing.

Gemini integration uses the confirmed credit-backed endpoint, passes the same bounded validated tools, survives offline429/timeout tests, and reports actual availability. Provider access is not claimed to guarantee unlimited quota. Full physical microphone/fun and end-to-end hands-free acceptance remain required. Each stream publishes exact source/PR, checks, before/after, unresolved limits and next integration action in its handoff; issue9 and STATUS are the shared ledger.
