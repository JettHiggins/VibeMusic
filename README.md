# VoiceSynthesizer

A voice-controlled browser groovebox built around SLOOP.

Read [PLAN.md](PLAN.md) and [AGENTS.md](AGENTS.md), then follow [setup](docs/SETUP.md) and [contracts](docs/CONTRACTS.md).

The reviewed application is on `engine-integration`; `main` is still the old documentation baseline. Real SLOOP playback, drums/melodies, piano roll, save/load, microphone capture, local faster-whisper and optional free-only OpenRouter Deep Agents are integrated. Full hands-free sound design and real-device acceptance remain unfinished.

The current priority is the [playtest repair milestone](docs/PLAYTEST-REPAIR.md): finite stopped-record count-in, empty startup, playback/recording metronome with mute, precise mouse/voice erasure and aggressive noisy-room input handling. These are repair requirements, not claims that fixes already shipped. See [current status](docs/STATUS.md) and the three workstream goal files.
