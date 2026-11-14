# Development setup

Use Node 22.12+ and Python 3.11+. Windows developers run these commands inside WSL2, with the repository in the Linux filesystem; open the Vite URL in Windows Chrome. macOS developers use a terminal and Chrome. Commands below have been checked in this Linux workspace; macOS and Windows verification remains part of integration acceptance.

```sh
git clone --recurse-submodules git@github.com:JettHiggins/VoiceSynthesizer.git
cd VoiceSynthesizer
git switch engine-integration
git submodule update --init --recursive
npm ci
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r services/agent/requirements-dev.txt
npm run check
npm test
npm run build
npm run dev
```

Open http://localhost:5173. The browser now loads the real SLOOP engine when assets have been built. Until then it reports the missing build on audio activation. No API keys are needed. Run commands from the repository root with the virtualenv active so `npm run check` can find jsonschema.

Before a capability, fetch origin, read PLAN.md, AGENTS.md, docs/STATUS.md and coordination issue #9, and preserve local work. Branch from the latest reviewed origin/engine-integration using an owner-specific capability name; open PRs against engine-integration. Do not restart from main, the old foundation, or a stale workstream branch. Include commit/PR, behavior, tests, limitations and the exact next integration step. STATUS.md records temporary ownership changes and pending reviews.

## Upstream engine

`vendor/sloop` is pinned to bac9c05ea7627449405aa10e48da21d75b6c8c56. Do not move the submodule independently. Its browser build uses Python and Emscripten (or clang + wasm-ld), without the hardware SDK:

```sh
python3 vendor/sloop/tools/build_preview.py
```

WASM compilation and native parity are verified in Linux Docker; neither is required to start UI or backend work against mocks. The upstream preview test script is `vendor/sloop/tests/run_preview_tests.sh`; it also runs in the firmware-parity CI job. No firmware flashing is part of this project.

### Engine compiler container

If native clang + lld or Emscripten is unavailable, install Docker and run:

```sh
python3 scripts/build-engine.py --docker --test
```

The image contains clang/lld, Python, and Node for upstream native/WASM parity tests. It stages WASM and the upstream worklet in ignored `apps/web/public/engine/`, together with metadata exported from actual C descriptors and factory patches. Generated metadata is not sourced from the upstream editor's mock implementation. For environments where Docker bridge networking cannot reach package mirrors, add `--docker-network host` to the build command. The native build path is `python3 scripts/build-engine.py --test`.

After building the engine, run `npm run dev`, click Enable audio, then Play. The integrated workspace supports drum editing, synth piano roll, persistence, microphone diagnostics/calibration and manual takes. Read STATUS.md for capabilities still on review branches, especially the new recording controls. Real speech recognition remains unfinished. `npm run dev` and `npm run build` compile the worklet automatically. Do not serve a stale generated worklet after changing engine source.

### Local command-service integration

With the virtualenv active, run the backend in a second terminal:

```sh
python -m pip install -r services/agent/requirements-dev.txt
python -m pytest services/agent
python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

In the browser enable audio, connect the agent, then submit a command transcript such as `select synth two`, `play`, `tempo one forty`, or `stop playback`. This is an integration harness, not speech recognition. No API credentials are read. Transcript commands can arm/stop recording and mutate the session; manual microphone takes are separate from this transcript seam. Sound research is unavailable by default; explicitly configured SLOOP/CLAP research can return real candidates and previews (see services/agent/README.md). No provider is silently enabled.

After building the WASM engine, `npm run test:integration` starts an isolated local service, connects via the production WebSocket adapter/coordinator, and verifies proposals, queueing, application, and revision feedback against real WASM. Activate the virtualenv first so `python3` resolves the backend dependencies; alternatively set `VOICESYNTH_PYTHON` to its Python executable. The integration command is POSIX shell syntax, supported on macOS and WSL2.

After pulling new contracts, restart uvicorn so it reloads the schemas. For engine recording tests, submit `record snare` while stopped: one bar/four beats of count-in plays before recording starts (or the next beat if already playing), then `Groove stop` ends the window while playback continues. This tests scheduling only; it is not microphone recording.

### Platform and optional model checks

The workflow now includes macOS and Windows artifact-consumer jobs: they use the Linux-built WASM, run contracts/engine/backend tests and live service integration, and build the browser app. These jobs do not establish physical-microphone latency, browser audio quality, or the WSL2 installation process. Pending or failed remote checks must not be reported as passed.

Optional model experiments use a separate `.venv-research` environment, ignored by git. The CLAP adapter records an immutable Hub snapshot and library versions, rejects incomplete/degenerate model features, and uses restricted weights-only loading for the official PyTorch checkpoints. Model tests require GROOVE_TEST_CLAP=1; ordinary CI does not download weights. The original pinned music-checkpoint loader has passed local inference probes. Retrieval improvements on PR #13 and human blind-listening quality remain separate gates. Local faster-whisper is selected for STT but not yet integrated; the language-model provider/API access remains deferred.

### Browser input diagnostic

With Vite running and playwright-cli installed, open the page, activate audio, then run the committed browser function:

```sh
playwright-cli -s=voicesynth-input open http://127.0.0.1:5173/
playwright-cli -s=voicesynth-input click "getByRole('button', { name: 'Enable audio' })"
playwright-cli -s=voicesynth-input run-code --filename=tests/browser/input-pipeline.js
playwright-cli -s=voicesynth-input close
```

It uses an isolated real engine/context and a synthetic buffer through the actual worklet/worker/recorder. It requires four correctly quantized hits by the following loop and analysis p95 below 50 ms. It does not request microphone permission, upload audio, or measure a real device. Current UI microphone takes are manual; monophonic melody extraction exists, while real speech recognition remains unfinished. On ws1/recording-consumer, tests/browser/next-beat-melody.js checks three synthetic sung tones through the actual YIN worker/recorder/WASM; tests/browser/recording-consumer.js checks the visible next-beat/live-edit controls on a fresh page. These do not establish real-device acceptance.
