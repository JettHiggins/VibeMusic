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

Open http://localhost:5173. This milestone shows a clearly labeled mock selection demo, not SLOOP audio. No API keys are needed. Run commands from the repository root with the virtualenv active so `npm run check` can find jsonschema.

Teammate 1: branch `ui-input` from the published foundation commit. Teammate 2: branch `agent-sound` from the same commit. Read PLAN.md, AGENTS.md, and CONTRACTS.md, then use the workstream goal in PLAN.md. If the branch already exists, inspect it rather than overwriting it. Push your branch and open a PR to main. Include a handoff with tests, limitations, and integration instructions.

## Upstream engine

`vendor/sloop` is pinned to bac9c05ea7627449405aa10e48da21d75b6c8c56. Do not move the submodule independently. Its browser build uses Python and Emscripten (or clang + wasm-ld), without the hardware SDK:

```sh
python3 vendor/sloop/tools/build_preview.py
```

WASM tooling/build validation is Workstream 1's next milestone; it is not needed to start UI or backend work. The upstream preview test script is `vendor/sloop/tests/run_preview_tests.sh`; it will be incorporated into engine CI once the toolchain is established. No firmware flashing is part of this project.
