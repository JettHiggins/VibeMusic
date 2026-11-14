# VoiceSynthesizer project and coordination plan

## Outcome

A browser groovebox controlled by voice after one initial audio activation and microphone permission. With headphones on, a user builds kick, snare, and hi-hat patterns, sings melodies, corrects phrases, describes sounds, auditions editable patches, and stops recording while playback continues.

Use SLOOP's actual browser WASM DSP and sequencer. The browser groovebox, musical-input pipeline, local service, and research pipeline are integrated on engine-integration. Read docs/STATUS.md for current evidence, active assignments, and remaining acceptance gates; the milestone descriptions below define the product, not its completion status.

## Decisions

- Open-source GPL-3.0-only project. Pin SLOOP source and preserve notices; use original artwork and clearly licensed samples.
- TypeScript/React/Vite browser client; AudioWorklet owns DSP and musical timing. Python/FastAPI local service with LangChain Deep Agents and WebSocket communication. Cloud speech and language providers are allowed; secrets stay server-side.
- Chrome initially; macOS and Windows with WSL2 development. No FM-1 hardware required.
- Four bars, 4/4, 120 BPM default, straight sixteenth-note grid. Spoken tempo changes apply at a loop boundary. Updated after real-device testing: recording starts on the next beat during playback, with a one-bar count-in from stopped. Explicit next-loop scheduling remains available for existing callers.
- Preserve SLOOP's drum track and three melodic tracks. Initially select kick, snare, or closed hats before beatboxing; detect timing rather than classify drum type. Singing is monophonic.
- New notes replace overlapping old notes; silence preserves the rest. Repeated drum hits update the same lane/grid position. Clear and Undo act immediately while recording/playback continue; conflicting pre-edit buffered input must never restore removed music. Undo discards pending provisional input first, otherwise restores the last applied musical edit.
- Normal speech outside recording; during recording commands begin with “Groove.” “Groove, stop” stops recording; “Groove, stop playback” stops transport.
- Agent inference never controls sample timing. Browser musical state is authoritative; validate agent actions before application.
- Fresh launches start empty, with 120 BPM/default patches and no automatic song or saved-session restore. Metronome defaults on during playback/recording, with mute and no musical history entry. Mouse and precise voice erasure remove individual committed/provisional events without losing unrelated input.
- Raw microphone recordings are not persisted by default. Diagnostic capture is opt-in. Playback remains usable without AI services.
- Speech recognition: local faster-whisper (configurable small-model baseline), selected by Jett. Language-model provider: OpenRouter, free models only, selected by Jett on 2026-11-14. Keep credentials backend-local, never in Git or the browser. Local STT and optional OpenRouter Deep Agents are integrated; live model quality and full-product acceptance remain unfinished. Familiar commands retain the deterministic parser path.
- Current UI direction: dark monochrome DAW workspace, persistent transport/track/editor/inspector controls, drum step sequencer, and an editable synth piano roll. Replace the tab-based layout. Timing calibration includes preparation, practice clicks, progress, cancellation, and a recording-offset adjustment.

## Current priority: playtest repair milestone

The latest real-device session found an infinite apparent count-in when Record precedes Play, difficult drum timing/individual erasure, noisy-room melody failure progressing to no notes on synth 3, and unwanted demo-song startup. [docs/PLAYTEST-REPAIR.md](docs/PLAYTEST-REPAIR.md) is the approved detailed repair plan; docs/STATUS.md is the current assignment ledger. The three copyable goals are in docs/WORKSTREAM-1.md, docs/WORKSTREAM-2.md and docs/WORKSTREAM-3.md.

Defaults selected by Jett: empty stopped project on fresh launch (explicit load only); metronome during playback AND recording with mute; mouse AND precise voice erasure; aggressive noisy-room cleanup, accepting some artifacts. WS1 owns count-in/audio deadlines/metronome/erase contracts and engine/empty startup/integration. WS2 owns processing-profile-aware input, calibration, editing and feedback. WS3 owns noisy-room classification/coverage/target continuity and deterministic commands. Preserve/defer sound-search feature branches until the repair gate; no new feature expansion. Human microphone/fun acceptance on a frozen commit is required. The full milestones below remain the product roadmap, not claims of completion.

## Milestones and acceptance

### 0. Foundation and contracts — integrator owns this first

Create repository scaffolding, reproducible setup, pinned upstream source, shared contracts and example payloads. Publish a foundation commit before teammates commit implementation. Do not claim that these artifacts already exist.

Contracts cover versioned SessionState (tempo, tracks, patches, events, revision), PerformanceEvent (capture-frame timestamp, target, onset/note, confidence), SessionCommand (ID, operation, arguments, expected revision, scheduling boundary), and PatchCandidate (parameters, engine revision, provenance, preview, score). Define WebSocket acknowledgments, transport snapshots, command-span timestamps, and research progress. Browser owns musical state; backend receives snapshots and requests mutations. Include mock adapters and fixtures for independent development.

### 1. Standalone browser groovebox

Build pinned SLOOP browser preview without firmware hardware toolchains. Verify 64-step loop capacity and note-duration representation; extend adapter if necessary. Expose sample-clock timestamps and boundary-scheduled edits. Build a dark monochrome DAW workspace with persistent transport, tracks, preset/engine, tempo, bar/beat, drum grid, synth piano roll, mute, volume, audition, and essential patch controls. Keep session operations in a compact menu. Start with empty note/hit arrays and stopped transport; retain default instruments and versioned local save/load plus JSON import/export. Saved projects load only explicitly.

Accept when the real engine plays an editable four-bar drum/melody pattern, changes sounds, saves, and reloads identically.

### 2. First voice slice and drums

Calibrate input level/noise floor. Show instructions and a three-second preparation countdown; timing calibration has four practice clicks then eight measured clicks, progress and cancellation. Failed/cancelled calibration preserves the prior valid result. Expose and persist a per-device recording-offset adjustment. Default to aggressive Noisy room cleanup, with an explicit Music profile for less processing; keep separate speech/performance conditioning and calibrate per device/profile. Detect onsets with energy/spectral change, adaptive thresholds, and retrigger guard. Map capture timestamps to audio clock with latency compensation and quantize to sixteenths. Buffer provisional performance events, exclude recognized command spans, and commit for a subsequent pass. Record starts on the next beat during playback or after a one-bar count-in from stopped. Clear/Undo act immediately without stopping playback or fresh capture; invalidate pre-edit events atomically. Include lane selection, stop, mute, and tempo commands. On speech disconnect stop new capture commits, preserve composition, and continue playback.

Accept the complete slice: say record kick, beatbox, hear quantized loop, say Groove stop, hear playback continue. Then build all three lanes hands-free.

### 3. Melody and correction

Use worker-based YIN pitch tracking with confidence filtering, hysteresis, and minimum duration. Derive MIDI pitch, velocity, duration; quantize starts/ends with minimum one step. Handle silence, vibrato, repeated notes, octave errors, and loop-crossing notes. Apply atomic edits at boundaries. Benchmark Basic Pitch as optional phrase refinement; do not place inference in audio callbacks. No forced musical scale.

Accept singing a melody and replacing one phrase while preserving untouched notes.

### 4. Research-driven sound design

Use offline rendering of the same pinned SLOOP engine. Render presets and seeded bounded variations with fixed notes/phrases; store complete patch parameters, render recipe, revision, audio, embeddings. Retrieve top five by LAION CLAP music checkpoint similarity. Optimize with seeded bounded evolutionary search, initially at most 128 variations/request; reject silent/clipping renders. Run research in a separate worker, returning retrieval first and streaming progress/cancellation. Deep Agents coordinates requests, audition, refinement, acceptance, and undo. Accepted patches preserve music and apply at boundaries with output smoothing.

Evaluate against preset-only retrieval using fixed prompts and blind listening by all three teammates, recording preference and latency. Do not equate embedding score with musical quality. AutoSynth reproduction and model training are deferred.

Accept describing an 80s electric piano, auditioning candidates, refining one, accepting it, and continuing the existing composition.

## Ownership and teammate start instructions

### Workstream 1: project owner — engine and integration

Own root configuration, shared contracts, vendored SLOOP, engine adapter, clock, CI, and end-to-end integration. First deliver milestone 0 and post its commit. Merge reviewed capability-sized PRs frequently. Completion means all milestones work together on macOS and Windows Chrome, not merely that the engine works.

### Workstream 2: teammate 1 — UI and musical input

Own browser UI, local save/load, microphone calibration/capture, onset detection, YIN note extraction, recording feedback, provisional buffering and command-span exclusion. Start against agreed mocks, then integrate real engine. Do not independently redefine shared contracts or root configuration.

Copyable goal:
> Read PLAN.md and AGENTS.md. Own Workstream 2 through integrated completion: compact UI and microphone-to-musical-event pipeline. First inspect whether milestone 0 contracts and scaffolding are published. If missing, report the precise dependency and return control without polling or creating competing scaffolding. Once available, use its mocks to build independently. Submit small tested PRs, integrate feedback, and verify drums and phrase correction with the real engine. Do not stop at a mock-only demo.

### Workstream 3: teammate 2 — agent service and sound research

Own Python service, speech adapters, wake-phrase orchestration, typed Deep Agents tools, connection recovery, patch corpus, retrieval/optimization workers, and research evaluation. Begin against mock session tools and patch fixtures; adopt the real renderer from Workstream 1.

Copyable goal:
> Read PLAN.md and AGENTS.md. Own Workstream 3 through integrated completion: local Deep Agents service, spoken commands, and research-driven editable patch search. First inspect whether milestone 0 contracts and scaffolding are published. If missing, report the precise dependency and return control without polling or creating competing scaffolding. Once available, use shared mocks and fixtures. Submit small tested PRs, support the first voice slice before sound research integration, and verify the real browser can audition, refine, and accept patches.

## Coordination protocol

Each laptop uses its own clone and feature branch. Start capability branches from the latest reviewed origin/engine-integration, preserving any local work first; do not restart from main or an old workstream tip. Main stays runnable; nobody pushes implementation directly to main. Workstream 1 merges PRs and owns contract changes; other owners propose small contract PRs before depending on a change. Do not edit another owner's subsystem without agreement. GitHub PRs and issues carry handoffs; independent agent sessions do not share live context. WS1 maintains docs/STATUS.md as the concise current assignment/dependency ledger; HANDOFF.md is history. Read STATUS.md at startup, before starting a capability, and before opening a PR. At those checkpoints, fetch remote status and read the linked coordination issue for steering. Do not repeatedly poll; if a dependency is missing, finish independent work and return control.

Every handoff includes commit/PR, capabilities, checks run, limitations, and exact next integration step. Document contract changes with example payloads. Never silently substitute mocks for a completed integration. If blocked, finish independent tasks, leave a precise dependency report, and return control; humans resume sessions after dependencies merge. Do not run repeated dependency polling. Share generated corpus artifacts rather than committing large model/data files.

## Validation

Preserve upstream DSP tests. Add deterministic tests for loop duration/drift, boundary edits, capture timestamps, quantization, early/late hits, noise, double triggers, command rejection, stale revisions, disconnections, sustained/repeated notes, and phrase replacement. CI builds WASM, checks frontend/backend, and runs contract/integration fixtures.

Targets to measure on all development laptops: ten-minute playback without audible interruptions; p95 local onset analysis below 50 ms; qualifying edits available by following loop; ordinary command acknowledgment within two seconds after utterance, excluding research jobs. Record misses rather than hiding them.

Final acceptance: after startup, create three drum lanes and a melody, correct a phrase, request and refine a sound, audition/accept it, clear/undo an edit, and stop recording while playback continues. All owners participate; Workstream 1 owns final signoff.

## References

- SLOOP source/browser build: https://github.com/isod89/sloop-fm1 and its BUILDING.md and LICENSING.md
- CTAG: https://proceedings.mlr.press/v235/cherep24a.html
- SynthScribe: https://arxiv.org/abs/2312.04690
- Basic Pitch: https://basicpitch.spotify.com/ and https://github.com/spotify/basic-pitch-ts
- AutoSynth: https://arxiv.org/abs/2610.10774
- CLAP: https://github.com/LAION-AI/CLAP
- Hardware inspiration: https://www.youtube.com/watch?v=yedcHP3jy5s
- Ableton beatboxing inspiration: https://www.youtube.com/watch?v=H-BIAG9OMm4&t=20s

Deferred: automatic drum classification, vocal sampling, automatic tempo inference, polyphonic singing, mobile, hardware control, and collaborative live sessions.
