# Provider isolation for routine tests

Review branch: ws1/offline-integration-tests. Service/research integration subprocesses explicitly disable language inference, API credentials and speech model startup. Service integration also disables optional research; research integration still opts into the real local renderer with the explicitly MOCK embedder. Each asserts parser/unconfigured-speech health. This avoids a developer's ignored backend .env or exported provider settings changing routine test behavior or consuming API quota.

Backend tests/conftest.py clears opt-in provider settings before collection imports app.py. Individual tests can still explicitly monkeypatch providers. GROOVE_TEST_STT/CLAP local-model opt-ins remain separate; no production configuration/key file is modified. The explicit language_check.py --live CLI is unchanged and remains the way to request a live provider measurement.

Validation used deliberately invalid parent language/speech/research settings and a non-secret sentinel API value. Both explicit live-service/WASM and real-renderer/MOCK-embedder research integration scenarios passed (~77 s). Backend suite passed 234 / six optional skips, and schema/TypeScript checks passed. No provider request was part of these checks. This is test-harness isolation, not additional application/provider acceptance.

WS3 review requested for pytest configuration; WS1 owns root integration test orchestration. Merge after review, then ordinary commands need no special environment sanitization. Existing live-demo configuration and local key file remain untouched.
