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

After building the engine, run `npm run dev`, click Enable audio, then Play demo. The integration harness supports playback, track selection, boundary-scheduled tempo/clear/undo, with worklet acknowledgments. Recording, persistence, full editing UI, and speech remain pending workstream integration. `npm run dev` and `npm run build` compile the worklet automatically. Do not serve a stale generated worklet after changing engine source.
