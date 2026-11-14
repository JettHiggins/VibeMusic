# Offline SLOOP renderer

Engine-owned code provides the `research.audio.Renderer` interface expected by Workstream 3. This is actual SLOOP WASM, not the toy renderer. It uses the browser snapshot validator, real factory FM6 voices, and sample-timed native note events. Output is mono (average of stereo), float32, 44100 Hz, without loudness normalization. Recipe note boundaries are rounded to samples; positive notes last at least one sample. Releases and effect tails occupy the remainder of recipe.seconds.

## Prerequisites and sample render

Run from the repository root after `npm ci`, building the latest engine, and activating the Python virtualenv with backend dependencies installed. The new native `vs_note` export requires rebuilding older assets.

```sh
python3 scripts/build-engine.py --docker --test
PYTHONPATH=services/agent python - <<'PY'
from pathlib import Path
from groove_agent.research.audio import DEFAULT_RECIPE, wav_bytes
from tools.sloop_renderer import SloopRenderer
patch = {
    'engine': 1, 'preset': 0,
    'parameters': {},
    'engineRevision': 'bac9c05ea7627449405aa10e48da21d75b6c8c56',
}
renderer = SloopRenderer()
audio = renderer.render(patch, DEFAULT_RECIPE)
Path('artifacts').mkdir(exist_ok=True)
Path('artifacts/rhodes.wav').write_bytes(wav_bytes(audio, renderer.sample_rate))
print(renderer.name)
PY
```

`SloopRenderer` accepts optional assets Path, node executable, and timeout (30 seconds per render by default). A failed/invalid render raises an error; it never falls back to a mock. Its name records the pinned upstream revision and SHA256 of the actual WASM, metadata, renderer source, and browser snapshot source. Keep corpus artifacts out of git.

The renderer supports the existing three-second c-major-phrase-v1 recipe. Inputs must have 0.1–12 seconds and 1–64 note tuples `(startSeconds, durationSeconds, midi, velocity)` within the render duration. This is the offline performance recipe, not grid quantization of a user's singing. It shares DSP and patch state with browser playback, including session-owned mixer settings; it does not claim to equal a live take with different timing, previous notes/effect tails, or mix levels.

## Node protocol

`node --import tsx tools/render-patch.ts` reads one JSON request `{patch, recipe}` from stdin and returns raw little-endian mono float32 bytes on stdout. Diagnostics go only to stderr, with nonzero exit on failure. The Python adapter owns process invocation and frame-count validation. `GROOVE_ENGINE_ASSETS` selects the generated engine asset directory. A separate process bounds per-render work and isolates it from the Python event loop; cancellation is checked between renders by the research job framework.

## Research integration and verification

Supply SloopRenderer to ResearchBackend with a real joint audio/text embedder. The backend is now wired through research.sloop.SloopRenderer. Default research remains unconfigured. GROOVE_RESEARCH=sloop with GROOVE_EMBEDDER=mock tests real audio plumbing with explicitly meaningless ranking; real CLAP is still pending. Hash embeddings are mock rankings and must not be used as evidence for sound-design quality.

```sh
npm test
PYTHONPATH=services/agent python -m pytest tests/test_sloop_renderer.py
python -m pytest services/agent
```

Tests exercise real generated WASM, deterministic rendering, velocity response, rejection of incompatible patches/recipes, Python protocol compatibility, and every complete factory patch's preservation of browser timing/mixer state. These tests establish rendering functionality, not CLAP relevance or blind-listening preference.

The research integration test is also exposed as `npm run test:research-integration` and runs in firmware CI. A cold local run with the MOCK embedder took about 73 seconds including factory-corpus construction, bounded refinement, preview fetch, accept, and undo. This is a measured plumbing baseline, not a CLAP performance or sound-quality result.
