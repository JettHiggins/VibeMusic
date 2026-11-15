# VoiceSynthesizer plan

## Product

A browser groovebox controlled by voice after initial audio activation and microphone permission. Wearing headphones, build three drum lanes, sing and correct melodies, describe/refine/audition sounds, accept editable patches, clear/undo edits, and stop recording while playback continues. The goal is a fun musical instrument; passing software checks alone is insufficient.

The runnable shared branch is engine-integration. Main remains the older documentation baseline until final integration acceptance. [STATUS](docs/STATUS.md) records current completion and assignments; this file defines the product. Working rules and ownership are in [AGENTS](AGENTS.md), current priorities in [MELODY-RETENTION-ROUND](docs/MELODY-RETENTION-ROUND.md).

## Product decisions

- GPL-3.0-only; preserve pinned SLOOP source/notices and use original artwork or clearly licensed samples. Actual SLOOP WASM DSP/sequencer, no FM-1 hardware dependency.
- TypeScript/React/Vite and AudioWorklet in Chrome; Python/FastAPI service, WebSockets and LangChain Deep Agents. Target macOS and Windows/WSL2. Audio clocks and browser musical state remain independent of inference.
- Four bars, 4/4, 120 BPM initially, 64 sixteenth cells. One drum track with kick/snare/hats and three monophonic melodic tracks. Select a drum lane before beatboxing; detect timing rather than drum class.
- Empty fresh projects, default patches, explicit save/load/import/export, no automatic saved-song restore. Compact dark monochrome DAW with persistent transport/tracks, drum grid, editable piano roll and live growing note preview. Live synth monitoring is deferred.
- Record starts next beat during playback or after one-bar count-in from stopped; explicit next-loop scheduling remains. Rhythmic starts/ends currently snap to sixteenths. Optional root/Major/Minor pitch snapping is separate; existing music changes only via explicit undoable Snap.
- New notes replace overlaps; silence preserves untouched music. Drum hits replace lane/grid positions. Immediate Clear/Undo/individual erase work during recording and playback; buffered pre-edit audio must not resurrect music. Undo discards pending input first, otherwise restores the last musical edit. Metronome defaults on, can mute, and has no musical Undo entry.
- Normal speech outside recording; addressed commands during recording begin with “Groove.” “Groove stop” stops recording, “Groove stop playback” stops transport. Exclude classified command audio using measured capture frames, never inference arrival time. Preserve already committed music on disconnect.
- Local faster-whisper speech; deterministic familiar commands work without LLM quota. Existing OpenRouter is free-only; selected Google Cloud/Vertex migration remains pending implementation/configuration. Secrets stay backend-local; raw microphone audio is not persisted by default. Standalone playback remains usable without AI.

## Required capabilities and acceptance

| Gate | Required result |
| --- | --- |
| Foundation | Reproducible setup, pinned upstream, published versioned schemas/examples/mocks; browser-authoritative sessions, operations, capture events, speech spans and research lifecycle. |
| Groovebox | Actual engine plays editable four-bar drums/melodies, changes sounds, and saves/reloads identically. Sample-clock scheduling and stale-revision validation remain intact. |
| Voice drums | Guided noise/timing calibration with preparation/practice/cancel; per-device offset; separate speech/performance processing; onset analysis and calibrated grid mapping. Build all three lanes hands-free, stop capture while looping, erase/undo without losing unrelated music. |
| Melody | Streaming monophonic pitch/confidence/stability/duration, live view-only piano-roll preview, fast/repeated/held/loop-crossing notes and phrase correction. Quiet singing and room noise tested physically. Optional key snapping preserves timing and articulation. Basic Pitch is optional phrase-refinement research outside audio callbacks. |
| Sound design | Offline render same pinned SLOOP presets/seeded bounded variations; complete patch/provenance/recipe/audio/embeddings. CLAP retrieves top five, seeded bounded evolutionary search initially at most128 variations/request rejects silence/clipping and supports progress/cancel. Deep Agents coordinates describe/refine/audition/accept/undo through validated tools; patches apply promptly with smoothing. |
| Full session | After startup, create drums and melody, correct a phrase, describe/refine/audition/accept a sound, clear/undo, stop recording while playback continues. All owners test real microphones; WS1 signs off. |

Compare sound retrieval with preset-only selection on fixed prompts and blind human listening; embedding score is not musical quality. AutoSynth reproduction/model training are deferred.

## Validation and coordination

Preserve upstream DSP/parity tests and regression coverage for timing/drift, capture/grid alignment, atomic edits, stale revisions/disconnects, noise, sustained/fast notes, speech exclusion and correction. CI builds actual WASM and exercises frontend/backend/schema/integration paths. Targets per laptop: ten minutes without audible playback interruption, p95 local onset analysis below50ms, qualifying edits by the following loop, ordinary command acknowledgment within two seconds after utterance (research excluded). Record misses and exact commit/device/configuration.

Each owner starts fresh capability branches from reviewed origin/engine-integration, preserves local work, submits tested PRs and reads issue9 at checkpoints. WS1 approves shared contracts and integrates; no consumer invents unpublished interfaces. See [workstream1](docs/WORKSTREAM-1.md), [workstream2](docs/WORKSTREAM-2.md), [workstream3](docs/WORKSTREAM-3.md). Current device test checklist: [MIC-TESTING](docs/MIC-TESTING.md).

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
