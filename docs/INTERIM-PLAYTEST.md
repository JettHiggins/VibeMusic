# Musical controls 1 — interim usability test

Current test tag: **playtest-musical-controls-1**. This supersedes playtest-repair-1 as the requested current test. The old tag and FROZEN-PLAYTEST.md are historical comparison material. Jett explicitly wants this interim test before WS3 finishes the remaining speech work; this is not the full hands-free acceptance gate.

Application source matches engine-integration 4566dd8ee5f48480f37fab4c13564fde557bd23e, whose Linux contracts/web, firmware/real-renderer integration and Windows/macOS jobs all passed: https://github.com/JettHiggins/VoiceSynthesizer/actions/runs/43655308001. The tagged follow-up changes documentation only.

## What changed since the last human test

- Immediate preset/engine/parameter and accepted research patch changes, preserving music/capture and existing smoothing. Explicit scheduled callers still work.
- Optional root + Major/Minor/Off for new sung notes; live preview uses the same mapping. Existing-track Snap is explicit and undoable; selecting a key alone preserves committed music.
- Real sound research describe/refine/preview/accept/Undo is integrated. Availability still requires the actual SLOOP/CLAP backend, voice-research flag and a matching prewarmed corpus. Cold rebuilding took minutes in prior measurements.
- Browser-local calibration/profile/offset actions have a real executor. Scoped cancellation, UI lockout and cancellation when transport invalidates calibration are fixed. Ordinary calibration is available from the screen; new spoken calibration/key/timeline commands still await WS3.

Still open: premature sentence endpointing, reliable acoustic Groove stop, new voice key/calibration/timeline tools and full human hands-free acceptance. Test existing speech as a baseline; record known failures without assuming this snapshot contains the upcoming WS3 fixes.

## Laptop agent setup

Read current origin/engine-integration docs/STATUS.md and this document before choosing a checkout. Preserve the development branch, uncommitted work and credentials. Create a separate detached worktree so testing does not interrupt or discard WS3 work:

```sh
git status --short
git fetch origin --tags
git worktree add --detach ../VoiceSynthesizer-playtest-musical-controls-1 playtest-musical-controls-1
cd ../VoiceSynthesizer-playtest-musical-controls-1
git rev-parse HEAD
git submodule update --init --recursive
npm ci
python3 scripts/build-engine.py --docker
```

Use the existing available native compiler instead of Docker when appropriate; verified alternatives are in SETUP.md. Build current assets/worklet, not a running old bundle. Activate the laptop's existing backend virtualenv by its absolute path; install missing requirements from this checkout. Reuse the laptop's ignored services/agent/.env locally, for example through a symlink from the test worktree to the existing file; verify it is ignored and never print/copy its contents into a message or Git. Reuse cached speech/research models, not new credentials.

Stop that laptop's old VoiceSynth frontend/backend processes, then start both from the test worktree. Check ports so Vite does not silently choose another while the browser keeps showing the old app:

```sh
npm run dev -w @voicesynth/web -- --host 127.0.0.1 --port 5173 --strictPort
```

In a second terminal, use the existing configured speech/LLM/research environment and launch:

```sh
python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

Open a fresh Chrome tab at http://localhost:5173 and reload. Verify the real process working directories and checked-out tag/commit, not just the tab title. Confirm Key root/Scale controls are visible after audio activation. Report the exact tag, commit, backend health/capabilities (no secrets) and URL before handing control to Jett. Research is optional in this interim session: if not actually configured, report it unavailable; if available, prewarm before listening rather than discover a multi-minute corpus build mid-test.

## Test sequence — headphones, real microphone

1. Fresh empty project: enable audio/microphone; run the guided silence and timing calibration. Check warning/countdown, click preparation and reported offset. If cancelling, prior valid settings remain.
2. Drums: Record while stopped, then while playing. Build kick/snare/hats, erase specific hits, Clear and Undo during takes. Note remaining timing/friction.
3. Melody/key: sing a short phrase with Off. Select C major (or another known key), record another phrase, inspect neighboring pitches. Selecting a key alone must not alter old notes. Use Snap existing notes, then Undo; verify timing and other tracks survive.
4. Sounds: change presets while playing and while recording. They should apply promptly rather than after four bars; rapid choices should settle on the final one without losing notes. If real research is configured, describe, preview, refine, accept and Undo; judge the sound by ear, not its score.
5. Existing hands-free baseline: test instrument/BPM and say Groove stop during a take. Record exact phrases, visible transcripts and outcomes, including any early interpretation. New spoken key/calibration/timeline controls are not yet implemented. Manual controls can be used for the rest of this interim test.

Keep the tag fixed for the session. Record commit, laptop/OS/browser/mic, measured offset, desired vs actual timing, exact speech/transcripts, errors and fun/usability feedback. Do not record raw audio by default. Return results to WS1 and Lenny before continuing WS3 implementation. This interim test does not mark the full roadmap complete.
