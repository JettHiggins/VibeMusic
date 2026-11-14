# Current-source worklet during development

Prepared on `ws1/dev-worklet-sync` for integration review. Root build configuration is WS1-owned; there are no shared message or UI changes.

Previously `engine-runtime.js` was built only at dev-server startup. Pulling new engine/contracts could update the browser UI but leave the audio thread validating against older schemas until a restart. A successful Vite page load therefore did not guarantee matching code in the audio thread.

The Vite serve plugin now compiles the actual worklet import graph, watches engine/contract dependencies, and requests a page reload when compiled output changes or a failed compile recovers. The worklet URL is served from a fresh build with Cache-Control: no-store, ahead of public-file handling. Each request finishes any existing watch build and performs another rebuild, so it cannot race an in-progress pre-pull compile. Compile errors produce a Vite overlay and HTTP 500, rather than serving the last successful artifact. The build context is disposed when the server closes. Compilation stays in the dev server, outside audio callbacks.

The CLI production build shares the same esbuild options and still emits the ignored public worklet asset. The pinned WASM, metadata and upstream preview module must still be built/staged; this change does not manufacture missing engine assets or update a running Python process's cached schemas. Reloading development code reinitializes the app/audio context, so save musical work before pulling changes.

Validation: the Vite integration regression starts with a stale public artifact, changes an imported dependency and requests the worklet immediately, exercises compile failure, and recovers back to the prior valid source. Shared checks, full Node suite and production build pass. A real Chromium app loaded SLOOP, enabled audio and played; it also enabled audio successfully after the on-disk generated worklet was deliberately replaced with a throwing stale artifact. The dev middleware served current compiled source instead. These are software-path checks, not human audio-quality or microphone signoff.
