# Playtest repair 1 — historical frozen test build

**Historical comparison only. Current requested interim test: playtest-musical-controls-1; follow INTERIM-PLAYTEST.md and current STATUS.md.**

Use tag **`playtest-repair-1`**. WS1 publishes its exact commit in coordination issue #9 and the test handoff. Keep this checkout fixed during the session; teammates continue on their own branches. Human acceptance is pending, not passed.

This build combines reviewed engine PRs #38/#39, microphone/UI #36, voice targets/metronome/erase #34/#37, speech coverage/spans #33/#35 and timing diagnostics #32. It starts empty and stopped, counts in for four beats from stopped (next beat while playing), keeps the metronome on with mute, and supports individual committed/provisional erasure without globally resetting capture.

## Start on Lenny's laptop

Finish/preserve any local edits and stop the old frontend/backend processes first. If `git status --short` lists work, have that laptop's agent preserve it before switching; never reset or discard it. From the repository root:

```sh
git status --short
git fetch origin --tags
git switch --detach playtest-repair-1
git rev-parse HEAD
git submodule update --init --recursive
npm ci
python scripts/build-engine.py --docker
npm run dev
```

Use the existing activated Python environment (`python3` if that is its command). Docker must be running for this build route; the native compiler alternative is in SETUP.md. Rebuild the matching assets: older WASM lacks the selective note-release export. Do not reuse old running tabs or uvicorn after schema changes.

In a second terminal, activate that laptop's existing backend environment. Install missing dependencies if needed:

```sh
python -m pip install -r services/agent/requirements-dev.txt -r services/agent/requirements-speech.txt
```

Start the service using the already configured local faster-whisper model. For the tested English baseline in macOS/WSL2 shells:

```sh
GROOVE_STT=faster-whisper GROOVE_STT_MODEL=base.en python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

On native Windows, set those two variables in the terminal or the existing backend-local `services/agent/.env`, then run the same `python -m uvicorn …` command without the shell prefixes. Keep existing credentials local and unchanged. Repair commands use the deterministic parser; no new API setup is needed. A model may download into local cache if absent. Research/sound-design expansion remains deferred.

Open **http://localhost:5173**, hard-reload, and wear headphones. Enable audio, enable/select the microphone, keep **Noisy room**, measure silence, check normal-volume foreground guidance, and calibrate timing. Check http://127.0.0.1:8000/healthz shows local faster-whisper before enabling hands-free. Startup permission clicks are expected.

## The test

Use [PLAYTEST-REPAIR-RESULTS.md](PLAYTEST-REPAIR-RESULTS.md) for the full pass/fail sheet. Prioritize:

1. Record before Play: four count-in beats become recording; metronome continues as a separate state. Cancel/restart; check mouse and spoken metronome mute.
2. Build kick, snare and hats. Erase one hit while recording/playing; unrelated hits stay. Correct and Undo without stopping playback. Confirm removed input stays gone on later loops.
3. Sing at normal volume on synths **1 → 2 → 3**, then **3 → 1 → 2**, first quiet, then with background conversation. Check provisional notes, pitch advice and speech verification if notes fail to commit. Do not just keep raising gain.
4. Delete individual committed/provisional melody notes. Try “Groove, erase kick, bar two, beat three” and “Groove, metronome off”. Ambiguous targets must refuse without mutation.
5. Spend ten minutes making a groove. Judge timing, correction friction, glitches and whether it is fun. No code changes during the session.

Copy the numeric microphone report and record exact commit, OS/browser, profile, calibration and pass/fail observations in issue #9 or a linked result issue. Raw microphone audio stays unrecorded by default. Say “Groove, stop” to end capture while the loop keeps playing; “Groove, stop playback” stops transport.

WS1 pauses the goal for this human test. A successful automated build does not establish acoustic latency, background-conversation rejection, all-synth real singing or fun. Do not call the repair milestone complete until Jett reviews these results.
