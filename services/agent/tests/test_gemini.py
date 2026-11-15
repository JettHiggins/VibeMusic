"""Gemini provider (playtest plan, issue #9): offline only, no live calls or keys.

Vertex AI is the default backend because the team's credit is Google Cloud credit. The same bounded
Deep Agents harness, validation, shared cooldown and no-replay rules apply as for OpenRouter.
"""
import asyncio
import json

import pytest

from groove_agent.language import (DEFAULT_GEMINI_MODEL, LanguageConfig, LanguageWorker, ProviderGate,
                                   language_from_env, provider_status, safe_language_error)

FAKE_KEY = "never-log-this-gemini-placeholder"


def env(monkeypatch, **values):
    for name in ("GROOVE_LLM", "GROOVE_LLM_MODEL", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION",
                 "GOOGLE_APPLICATION_CREDENTIALS", "GROOVE_GEMINI_BACKEND", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    for name, value in values.items():
        monkeypatch.setenv(name, value)


def test_vertex_config_requires_a_project_and_credentials_and_hides_the_key():
    # An Agent Platform (Vertex) API key works alone; a service-account file needs the project.
    assert LanguageConfig(provider="gemini", model=DEFAULT_GEMINI_MODEL, api_key=FAKE_KEY).vertex
    with pytest.raises(ValueError, match="GOOGLE_CLOUD_PROJECT"):
        LanguageConfig(provider="gemini", model=DEFAULT_GEMINI_MODEL, credentials_file="C:/keys/sa.json")
    with pytest.raises(ValueError, match="Vertex AI needs"):
        LanguageConfig(provider="gemini", model=DEFAULT_GEMINI_MODEL, project="demo-project")
    with pytest.raises(ValueError, match="Gemini model id"):
        LanguageConfig(provider="gemini", model="gpt-4o", project="demo-project", api_key=FAKE_KEY)
    with pytest.raises(ValueError, match="Developer API"):
        LanguageConfig(provider="gemini", model=DEFAULT_GEMINI_MODEL, vertex=False)
    config = LanguageConfig(provider="gemini", model=DEFAULT_GEMINI_MODEL, project="demo-project", api_key=FAKE_KEY)
    assert FAKE_KEY not in repr(config) and config.label == "gemini/deepagents (gemini-3.1-flash-lite, vertex)"


def test_environment_selects_gemini_on_vertex_with_no_sdk_retries(monkeypatch):
    pytest.importorskip("langchain_google_genai")
    import groove_agent.language as module
    built = []
    monkeypatch.setattr(module, "create_graph", lambda model, **_: built.append(model))
    env(monkeypatch, GROOVE_LLM="gemini", GOOGLE_API_KEY=FAKE_KEY + "\n", GOOGLE_CLOUD_PROJECT="demo-project")
    language = language_from_env()
    model = built[0]
    assert type(model).__name__ == "ChatGoogleGenerativeAI"
    # With an API key the project is not passed (express mode); otherwise the client ignores the key.
    assert (model.model, model.vertexai, model.project) == (DEFAULT_GEMINI_MODEL, True, None)
    assert (model.max_retries, model.temperature, model.max_output_tokens, model.timeout) == (0, 0, 512, 8.0)
    assert language.config.api_key == FAKE_KEY  # trailing newline stripped (it breaks HTTP headers)
    assert FAKE_KEY not in repr(language.config)


def test_unknown_provider_and_backend_are_refused(monkeypatch):
    env(monkeypatch, GROOVE_LLM="claude")
    with pytest.raises(ValueError, match="openrouter or gemini"):
        language_from_env()
    env(monkeypatch, GROOVE_LLM="gemini", GROOVE_GEMINI_BACKEND="aistudio", GOOGLE_API_KEY=FAKE_KEY)
    with pytest.raises(ValueError, match="vertex or developer"):
        language_from_env()


def google_429(delay="7s"):
    from google.genai import errors
    return errors.ClientError(429, {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED",
                                              "message": "never-forward-provider-text",
                                              "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo",
                                                           "retryDelay": delay}]}})


def wrapped(error):
    """LangChain raises its own error type with the google.genai error as the cause."""
    try:
        try:
            raise error
        except Exception as cause:
            raise RuntimeError("langchain wrapper") from cause
    except RuntimeError as outer:
        return outer


def test_google_rate_limits_start_the_shared_cooldown_using_retry_delay():
    pytest.importorskip("google.genai")
    error = wrapped(google_429("7s"))
    assert provider_status(error) == 429
    clock = type("Clock", (), {"now": 50.0, "__call__": lambda self: self.now})()
    gate = ProviderGate(clock)
    gate.failure(error)
    assert gate.blocked() == pytest.approx(7)
    message = safe_language_error(error)
    assert "quota/rate limit" in message and "never-forward" not in message and "Groove stop" in message


def test_gemini_429_never_storms_queued_work():
    pytest.importorskip("google.genai")
    calls, delivered = [], []

    class Limited:
        gate = ProviderGate()
        async def infer(self, job):
            calls.append(job)
            raise wrapped(google_429("30s"))

    async def scenario():
        worker = LanguageWorker(Limited(), lambda job, result, error: delivered.append(error))
        for i in range(3):
            worker.submit(type("Job", (), {"text": f"request {i}"})())
        for _ in range(50):
            await asyncio.sleep(0.01)
            if len(delivered) == 3:
                break
        await worker.close()
    asyncio.run(scenario())
    assert len(calls) == 1 and len(delivered) == 3 and all("never-forward" not in e for e in delivered)


def test_health_reports_the_actual_provider(monkeypatch):
    import importlib
    from fastapi.testclient import TestClient
    module = importlib.import_module("groove_agent.app")
    config = LanguageConfig(provider="gemini", model=DEFAULT_GEMINI_MODEL, project="demo-project", api_key=FAKE_KEY)
    monkeypatch.setattr(module, "language", type("L", (), {"config": config, "gate": ProviderGate()})())
    label = TestClient(module.app).get("/healthz").json()["language"]
    assert label == "gemini/deepagents (gemini-3.1-flash-lite, vertex)" and FAKE_KEY not in label


def test_a_vertex_api_key_alone_uses_the_agent_platform_endpoint(monkeypatch):
    pytest.importorskip("langchain_google_genai")
    import groove_agent.language as module
    built = []
    monkeypatch.setattr(module, "create_graph", lambda model, **_: built.append(model))
    env(monkeypatch, GROOVE_LLM="gemini", GOOGLE_API_KEY=FAKE_KEY)
    language_from_env()
    model = built[0]
    assert model.vertexai is True and model.project is None
    assert str(model.client._api_client._http_options.base_url).startswith("https://aiplatform.googleapis.com/")


def test_vertex_key_mode_hides_project_variables_from_the_google_client(monkeypatch):
    pytest.importorskip("langchain_google_genai")
    import os
    import groove_agent.language as module
    built = []
    monkeypatch.setattr(module, "create_graph", lambda model, **_: built.append(model))
    env(monkeypatch, GROOVE_LLM="gemini", GOOGLE_API_KEY=FAKE_KEY, GOOGLE_CLOUD_PROJECT="demo-project",
        GOOGLE_CLOUD_LOCATION="us-central1")
    language_from_env()
    # Live finding: with a project visible, the client ignores the key and needs gcloud credentials.
    assert built[0].project is None and "GOOGLE_CLOUD_PROJECT" not in os.environ and "GOOGLE_CLOUD_LOCATION" not in os.environ


def test_model_schema_is_flat_with_allowed_operation_names():
    from groove_agent.language import MODEL_OPERATIONS_EXCLUDED, model_operation_schema
    schema = model_operation_schema()
    assert "oneOf" not in json.dumps(schema)  # Gemini's tool schema drops oneOf
    names = schema["properties"]["type"]["enum"]
    assert {"tempo", "mute", "select", "set-rhythm-snap", "set-chord-mode"} <= set(names)
    assert not set(names) & MODEL_OPERATIONS_EXCLUDED
    assert "drums" in schema["properties"]["trackId"]["enum"]  # mute drums must be expressible


@pytest.mark.parametrize("operation, expected", [
    # Live Gemini shapes: every optional field filled with defaults, or the operation as a JSON string.
    ({"type": "tempo", "bpm": 128, "muted": False, "enabled": False, "step": 0, "target": {"trackId": "synth-2"}},
     {"type": "tempo", "bpm": 128}),
    ('{"type": "mute", "trackId": "drums", "muted": true}', {"type": "mute", "trackId": "drums", "muted": True}),
])
def test_model_proposals_are_cleaned_then_validated(operation, expected):
    from test_language import scripted_model
    from groove_agent.language import DeepLanguage, LanguageJob
    from groove_agent.contracts import load_fixture
    model = scripted_model([[{"name": "propose_command", "args": {"operation": operation}, "id": "c1", "type": "tool_call"}]])
    language = DeepLanguage(LanguageConfig(api_key="placeholder-only"), model=model)
    result = asyncio.run(language.infer(LanguageJob("u", "Groove do it", load_fixture("SessionState"), False, False)))
    assert result.operation == expected


def test_free_text_operations_are_rejected_not_guessed():
    from test_language import scripted_model
    from groove_agent.language import DeepLanguage, LanguageJob
    from groove_agent.contracts import load_fixture
    model = scripted_model([[{"name": "propose_command", "args": {"operation": "tempo 128"}, "id": "c1", "type": "tool_call"}]])
    language = DeepLanguage(LanguageConfig(api_key="placeholder-only"), model=model)
    with pytest.raises(Exception):
        asyncio.run(language.infer(LanguageJob("u", "Groove faster", load_fixture("SessionState"), False, False)))
