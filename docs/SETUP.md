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

Teammate 1: branch `ui-input` from the published foundation commit. Teammate 2: branch `agent-sound` from the same commit. Read PLAN.md, AGENTS.md, and CONTRACTS.md, then use the workstream goal in PLAN.md. If the branch already exists, inspect it rather than overwriting it. Push your branch and open a PR to main. Include a handoff with tests, limitations, and integration instructions.

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

After building the engine, run `npm run dev`, click Enable audio, then Play. The app includes pattern/sound editing, persistence and manual microphone drum/melody takes; speech recognition remains pending. See STATUS.md for capability availability and current assignments. In development Vite compiles the audio worklet from current dependencies, watches engine/contract changes and reloads after a successful rebuild. `/engine-runtime.js` is served without caching and does not use a stale generated public file. Build failures are shown in the Vite overlay and return HTTP 500. Production `npm run build` still generates the bundled worklet asset. See DEV-WORKLET.md for validation and limits.

### Local command-service integration

With the virtualenv active, run the backend in a second terminal:

```sh
python -m pip install -r services/agent/requirements-dev.txt
python -m pytest services/agent
python -m uvicorn groove_agent.app:app --app-dir services/agent --host 127.0.0.1 --port 8000
```

In the browser enable audio, connect the agent, then submit a command transcript such as `select synth two`, `play`, `tempo one forty`, or `stop playback`. This is an integration harness, not speech recognition. No API credentials are read. Recording commands now arm/open an engine recording window, but no microphone data is submitted yet; sound requests report unavailable rather than invented results.

After building the WASM engine, `npm run test:integration` starts an isolated local service, connects via the production WebSocket adapter/coordinator, and verifies proposals, queueing, application, and revision feedback against real WASM. Activate the virtualenv first so `python3` resolves the backend dependencies; alternatively set `VOICESYNTH_PYTHON` to its Python executable. The integration command is POSIX shell syntax, supported on macOS and WSL2.

After pulling new contracts, restart uvicorn so it reloads the schemas. For engine recording tests, submit `record snare` while stopped: count-in plays, recording arms on the next four-bar downbeat, then `Groove stop` ends the window while playback continues. This tests scheduling only; it is not microphone recording.

### Platform and optional model checks

The workflow now includes macOS and Windows artifact-consumer jobs: they use the Linux-built WASM, run contracts/engine/backend tests and live service integration, and build the browser app. These jobs do not establish physical-microphone latency, browser audio quality, or the WSL2 installation process. Pending or failed remote checks must not be reported as passed.

Optional model experiments use a separate `.venv-research` environment, ignored by git. The CLAP adapter records an immutable Hub snapshot and library versions, rejects incomplete/degenerate model features, and uses restricted weights-only loading for the official PyTorch checkpoints. Model tests require GROOVE_TEST_CLAP=1; ordinary CI does not download weights. General CLAP has passed a local CPU feature-space probe; music compatibility and blind-listening quality are separate acceptance gates.

### Browser input diagnostic

With Vite running and playwright-cli installed, open the page, activate audio, then run the committed browser function:

```sh
playwright-cli -s=voicesynth-input open http://127.0.0.1:5173/
playwright-cli -s=voicesynth-input click "getByRole('button', { name: 'Enable audio' })"
playwright-cli -s=voicesynth-input run-code --filename=tests/browser/input-pipeline.js
playwright-cli -s=voicesynth-input close
```

It uses an isolated real engine/context and a synthetic buffer through the actual worklet/worker/recorder. It requires four correctly quantized hits by the following loop and analysis p95 below 50 ms. It does not request microphone permission, upload audio, or measure a real device. Current UI microphone takes are manual. Melody capture/correction is integrated and has a separate synthetic diagnostic in tests/browser/melody-pipeline.js; speech recognition and physical-performer validation remain pending.
