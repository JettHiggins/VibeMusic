"""Offline: actual Deep Agents graph with scripted model responses; never provider quality."""
import asyncio
import json

import pytest

from groove_agent.contracts import load_fixture, validate
from groove_agent.intents import Command, SoundSearch
from groove_agent.language import LanguageConfig, LanguageJob, decode_decision, safe_language_error


@pytest.mark.parametrize("model", ["openai/gpt-paid", "openrouter/auto", "x/y:free,paid", "https://evil/x:free", ""])
def test_paid_or_routed_models_are_refused(model):
    with pytest.raises(ValueError):
        LanguageConfig(model=model, api_key="test-never-sent")


def test_config_does_not_expose_key_and_requires_explicit_key():
    assert "test-never-sent" not in repr(LanguageConfig(api_key="test-never-sent"))
    with pytest.raises(ValueError):
        LanguageConfig()


@pytest.mark.parametrize("operation", [{"type": "tempo", "bpm": 999}, {"type": "select", "target": {"trackId": "drums"}},
    {"type": "record", "target": {"trackId": "synth-1", "lane": "kick"}}, {"type": "execute"},
    {"type": "apply-patch", "trackId": "synth-1", "patch": {}}])
def test_proposals_are_structurally_and_semantically_validated(operation):
    with pytest.raises((ValueError, KeyError)):
        decode_decision({"kind": "command", "operation": operation})


def test_provider_errors_never_forward_their_text():
    error = RuntimeError("Authorization: secret-token; raw prompt")
    error.status_code = 429
    assert "quota" in safe_language_error(error)
    assert "secret-token" not in safe_language_error(error)
    assert "timed out" in safe_language_error(TimeoutError("secret-token"))


def scripted_model(calls):
    pytest.importorskip("deepagents")
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatResult, ChatGeneration
    from pydantic import PrivateAttr
    class ScriptedModel(BaseChatModel):
        _position: int = PrivateAttr(0)
        _bound: list = PrivateAttr(default_factory=list)
        @property
        def _llm_type(self):
            return "SCRIPTED offline acceptance fixture"
        def bind_tools(self, tools, **kwargs):
            self._bound = [t.name if hasattr(t, "name") else t.get("name") for t in tools]
            assert set(self._bound) == {"propose_command", "search_sound", "accept_candidate", "cancel_search", "refuse_request",
                                        "tidy_timing", "drum_pattern", "drum_steps", "transpose", "change_key", "set_volume", "adjust_sound", "edit_notes", "input_action"}
            return self
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            index = self._position
            self._position += 1
            message = AIMessage(content="", tool_calls=calls[index]) if index < len(calls) else AIMessage(content="done")
            return ChatResult(generations=[ChatGeneration(message=message)])
    return ScriptedModel()


def infer(calls):
    from groove_agent.language import DeepLanguage
    language = DeepLanguage(LanguageConfig(api_key="offline-never-sent"), model=scripted_model(calls))
    job = LanguageJob("u", "Groove, put the speed at 135", load_fixture("SessionState"), True, False)
    return asyncio.run(language.infer(job))


def test_actual_deepagents_graph_proposes_a_validated_command_offline():
    result = infer([[{"name": "propose_command", "args": {"operation": {"type": "tempo", "bpm": 135}}, "id": "t1"}]])
    assert result == Command({"type": "tempo", "bpm": 135}, "next-loop")


def test_actual_deepagents_graph_can_request_sound_refinement_offline():
    result = infer([[{"name": "search_sound", "args": {"description": "warmer electric piano", "refine": True}, "id": "t1"}]])
    assert result == SoundSearch("warmer electric piano", True)


@pytest.mark.parametrize("name,args", [("read_file", {"file_path": "/secret"}), ("task", {"description": "delegate", "subagent_type": "general-purpose"})])
def test_builtin_tools_cannot_execute_even_if_the_model_invents_a_call(name, args):
    with pytest.raises(ValueError):
        infer([[{"name": name, "args": args, "id": "bad"}]])


def test_several_actions_in_one_request_are_kept_in_order():
    # 2026-11-15: one request may need several actions ("kick on every beat and hats on the off-beats").
    from groove_agent.intents import Plan
    result = infer([[{"name": "propose_command", "args": {"operation": {"type": "undo"}}, "id": "a"},
                     {"name": "propose_command", "args": {"operation": {"type": "clear", "target": {"trackId": "synth-1"}}}, "id": "b"}]])
    assert isinstance(result, Plan) and [s.operation["type"] for s in result.steps] == ["undo", "clear"]


def test_a_refusal_mixed_with_actions_is_rejected_without_partial_application():
    with pytest.raises(ValueError):
        infer([[{"name": "propose_command", "args": {"operation": {"type": "undo"}}, "id": "a"},
                {"name": "refuse_request", "args": {}, "id": "b"}]])



class PendingLanguage:
    def __init__(self):
        self.jobs = []
    def submit(self, job):
        self.jobs.append(job)
        return True


def utterance(text="Groove transform this into glassy bells", request="u", recording=True):
    return {"type": "utterance", "id": request, "text": text, "clockId": "ctx", "startFrame": 352900,
            "endFrame": 353900, "duringRecording": recording}


def connection_with_language():
    from test_speech_harness import connect
    language = PendingLanguage()
    connection = connect(None)
    connection._language = language
    return connection, language


def test_familiar_commands_and_explicit_refusals_do_not_wait_for_a_language_provider():
    connection, language = connection_with_language()
    assert connection.handle(utterance("Groove stop"), 0)[1]["command"]["operation"] == {"type": "stop-recording"}
    assert connection.handle(utterance("Groove tempo 999", "bad"), 0)[1]["type"] == "error"
    assert connection.handle(utterance("la la la", "music"), 0) == []
    assert language.jobs == []


def test_unknown_addressed_speech_is_excluded_before_async_inference_and_applied_once():
    connection, language = connection_with_language()
    assert [m["type"] for m in connection.handle(utterance(), 0)] == ["command-span"]
    assert connection.handle(utterance(), 0) == []
    job = language.jobs[0]
    replies = connection.language_result(job, Command({"type": "tempo", "bpm": 135}, "next-loop"), None, 1)
    assert replies[0]["command"]["operation"] == {"type": "tempo", "bpm": 135}
    validate("ServerMessage", replies[0])
    assert connection.language_result(job, Command({"type": "undo"}, "immediate"), None, 2) == []


@pytest.mark.parametrize("change", ["undo", "revision", "take", "clock"])
def test_async_results_cannot_act_after_context_changes_even_without_revision_change(change):
    from test_speech_harness import transport_message, frame_at
    connection, language = connection_with_language()
    connection.handle(utterance(), 0)
    if change == "undo":
        connection.handle(utterance("Groove undo", "edit"), .1)
    elif change == "revision":
        connection.handle({"type": "ack", "commandId": "external-edit", "status": "applied", "revision": 1}, .1)
    else:
        message = transport_message("idle", frame_at(1))
        if change == "clock":
            message["transport"]["clockId"] = "new-context"
        connection.handle(message, .1)
    result = connection.language_result(language.jobs[0], Command({"type": "clear", "target": {"trackId": "synth-1"}}, "immediate"), None, 1)
    assert [r["type"] for r in result] == ["error"] and "changed" in result[0]["message"]


def test_invalid_model_operation_cannot_escape_connection_validation():
    connection, language = connection_with_language()
    connection.handle(utterance(), 0)
    result = connection.language_result(language.jobs[0], Command({"type": "tempo", "bpm": 999}, "immediate"), None, 1)
    assert result[0]["type"] == "error"


def test_connection_language_backlog_is_bounded():
    connection, language = connection_with_language()
    words = ["glassy", "warm", "dusty", "bright", "hollow"]
    for i, word in enumerate(words):
        text = f"Groove transform this into {word} bells"
        assert [r["type"] for r in connection.handle(utterance(text, request=f"u{i}"), 0)] == ["command-span"]
    replies = connection.handle(utterance("Groove transform this into soft bells", request="overflow"), 0)
    assert len(language.jobs) == 5 and [r["type"] for r in replies] == ["command-span", "error"]
    # An identical request already being interpreted is not sent to the provider twice.
    connection._language_pending.clear()
    connection.handle(utterance("Groove transform this into icy bells", request="a"), 0)
    replies = connection.handle(utterance("Groove, transform this into icy bells.", request="b"), 0)
    assert replies[-1]["message"] == "the same request is already being interpreted" and len(language.jobs) == 6


def test_language_inference_never_holds_classified_coverage_of_excluded_command_audio(tmp_path):
    from test_speech_harness import ScriptedWorker, synth_take, chunks_from_wav, connect, flat, stream
    worker = ScriptedWorker(["Groove transform this into glassy bells"])
    connection = connect(worker)
    connection._language = PendingLanguage()
    replies = flat(stream(connection, worker, chunks_from_wav(synth_take(tmp_path / "unknown.wav", seconds=5.5))))
    span = next(r for r in replies if r["type"] == "command-span")
    covering = next(i for i, r in enumerate(replies) if r["type"] == "speech-verified" and r["throughFrame"] >= span["endFrame"])
    assert replies.index(span) < covering and len(connection._language.jobs) == 1
    assert not any(r["type"] == "command" for r in replies)  # model still pending


def test_worker_cancels_on_disconnect_and_refuses_new_work():
    from groove_agent.language import LanguageWorker
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()
        class Delayed:
            async def infer(self, job):
                started.set()
                await release.wait()
                return Command({"type": "undo"}, "immediate")
        replies = []
        worker = LanguageWorker(Delayed(), lambda *args: replies.append(args))
        job = LanguageJob("u", "test", {}, False, False)
        assert worker.submit(job)
        await started.wait()
        await worker.close()
        release.set()
        await asyncio.sleep(0)
        assert replies == [] and not worker.submit(job)
    asyncio.run(scenario())


def test_actual_router_object_is_pinned_to_free_only_and_no_retry(monkeypatch):
    pytest.importorskip("langchain_openrouter")
    import groove_agent.language as module
    seen = []
    monkeypatch.setattr(module, "create_graph", lambda model: seen.append(model))
    module.DeepLanguage(LanguageConfig(api_key="offline-never-sent", timeout_s=2))
    model = seen[0]
    assert model.model_name == "inclusionai/ling-3.2-flash:free"
    assert model.openrouter_api_base == "https://openrouter.ai/api/v1"
    assert model.request_timeout == 2000 and model.max_retries == 0
    assert model.client.sdk_configuration.timeout_ms == 2000
    assert model.client.sdk_configuration.retry_config is None
    assert model.openrouter_provider == {"allow_fallbacks": False, "require_parameters": True, "max_price": {"prompt": "0", "completion": "0", "request": "0"}}



def test_proposal_returns_directly_without_an_extra_model_round_trip():
    from groove_agent.language import DeepLanguage
    model = scripted_model([[{"name": "propose_command", "args": {"operation": {"type": "undo"}}, "id": "one"}]])
    language = DeepLanguage(LanguageConfig(api_key="offline"), model=model)
    result = asyncio.run(language.infer(LanguageJob("u", "Groove reverse that edit", load_fixture("SessionState"), True, False)))
    assert result == Command({"type": "undo"}, "immediate")
    assert model._position == 1


def test_inference_wall_timeout_is_enforced():
    from groove_agent.language import DeepLanguage
    class DelayedGraph:
        async def ainvoke(self, *args, **kwargs):
            await asyncio.sleep(10)
    language = object.__new__(DeepLanguage)
    language.config = LanguageConfig(api_key="offline", timeout_s=.1)
    language.graph = DelayedGraph()
    with pytest.raises(TimeoutError):
        asyncio.run(language.infer(LanguageJob("u", "request", {}, False, False)))


def test_backend_env_loading_preserves_process_values_and_does_not_search_parents(tmp_path, monkeypatch):
    pytest.importorskip("dotenv")
    import groove_agent.language as module
    monkeypatch.setattr(module, "__file__", str(tmp_path / "groove_agent" / "language.py"))
    (tmp_path / ".env").write_text("GROOVE_LLM_MODEL=from-file\nOPENROUTER_API_KEY=file-only-placeholder\n")
    monkeypatch.setenv("GROOVE_LLM_MODEL", "already-in-process")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    module.load_backend_env()
    import os
    assert os.environ["GROOVE_LLM_MODEL"] == "already-in-process"
    assert os.environ["OPENROUTER_API_KEY"] == "file-only-placeholder"
    # Undo monkeypatch tracks setenv, not mutations done inside dotenv.
    monkeypatch.delenv("OPENROUTER_API_KEY")


def test_websocket_handles_clear_while_language_inference_is_waiting(monkeypatch):
    import importlib
    import threading
    from fastapi.testclient import TestClient
    module = importlib.import_module("groove_agent.app")
    started, release = threading.Event(), threading.Event()
    class DelayedLanguage:
        async def infer(self, job):
            started.set()
            while not release.is_set():
                await asyncio.sleep(.005)
            return Command({"type": "tempo", "bpm": 135}, "next-loop")
    monkeypatch.setattr(module, "language", DelayedLanguage())
    with TestClient(module.app).websocket_connect("/ws") as ws:
        ws.send_json({"type": "session", "session": load_fixture("SessionState")})
        ws.send_json(utterance())
        assert ws.receive_json()["type"] == "command-span"
        assert started.wait(2)
        ws.send_json(utterance("Groove clear kick", "clear"))
        assert ws.receive_json()["type"] == "command-span"
        reply = ws.receive_json()
        assert reply["command"]["operation"] == {"type": "clear", "target": {"trackId": "drums", "lane": "kick"}}
        release.set()
        reply = ws.receive_json()
        assert reply["type"] == "error" and "changed" in reply["message"]



def test_external_capture_epoch_change_refuses_late_model_action_without_revision_change():
    connection, language = connection_with_language()
    connection.handle(utterance(), 0)
    connection.handle({"type": "transport", "transport": {**connection.transport, "recordingEpoch": 1}}, .5)
    replies = connection.language_result(language.jobs[0], Command({"type": "undo"}, "immediate"), None, 1)
    assert replies[0]["type"] == "error" and "changed" in replies[0]["message"]


def test_provider_error_does_not_disable_the_fast_parser():
    connection, language = connection_with_language()
    connection.handle(utterance(), 0)
    replies = connection.language_result(language.jobs[0], None, "language provider quota/rate limit reached; no change applied", 1)
    assert replies[0]["type"] == "error"
    replies = connection.handle(utterance("Groove stop", "stop"), 2)
    assert replies[1]["command"]["operation"] == {"type": "stop-recording"}


def test_model_cannot_choose_a_noncanonical_scheduling_boundary():
    connection, language = connection_with_language()
    connection.handle(utterance(), 0)
    replies = connection.language_result(language.jobs[0], Command({"type": "tempo", "bpm": 135}, "immediate"), None, 1)
    assert replies[0]["type"] == "error"



@pytest.mark.parametrize("status", [429, 500])
def test_actual_sdk_makes_one_mock_http_request_without_retries_or_sensitive_logs(monkeypatch, caplog, status):
    pytest.importorskip("langchain_openrouter")
    import httpx
    import logging
    import groove_agent.language as module
    models = []
    monkeypatch.setattr(module, "create_graph", lambda model: models.append(model))
    module.DeepLanguage(LanguageConfig(api_key="never-log-this-test-placeholder", timeout_s=1.5))
    model = models[0]
    requests = []
    def fail(request):
        requests.append(request)
        return httpx.Response(status, json={"error": {"code": status, "message": "never-forward-provider-exception"}})
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(fail)) as client:
            model.client.sdk_configuration.async_client = client
            with pytest.raises(Exception) as caught:
                await model.ainvoke("offline request")
            message = module.safe_language_error(caught.value)
            assert "never-forward-provider-exception" not in message
            if status == 429:
                assert "quota" in message
    with caplog.at_level(logging.DEBUG):
        asyncio.run(scenario())
    assert len(requests) == 1
    assert requests[0].url == "https://openrouter.ai/api/v1/chat/completions"
    assert requests[0].extensions["timeout"]["read"] == 1.5
    payload = json.loads(requests[0].content)
    assert payload["model"].endswith(":free")
    assert payload["provider"]["max_price"] == {"prompt": "0", "completion": "0", "request": "0"}
    assert not payload["provider"]["allow_fallbacks"]
    assert "never-log-this-test-placeholder" not in caplog.text
    assert "never-forward-provider-exception" not in caplog.text



def test_actual_deepagent_and_openrouter_sdk_round_trip_with_mock_http(monkeypatch):
    pytest.importorskip("deepagents")
    openrouter = pytest.importorskip("openrouter")
    import httpx
    from groove_agent.language import DeepLanguage
    original_sdk = openrouter.OpenRouter
    requests = []
    def respond(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert payload["provider"]["max_price"]["prompt"] == "0"
        assert set(t["function"]["name"] for t in payload["tools"]) == {
            "propose_command", "search_sound", "accept_candidate", "cancel_search", "refuse_request",
            "tidy_timing", "drum_pattern", "drum_steps", "transpose", "change_key", "set_volume", "adjust_sound", "edit_notes", "input_action"}
        if len(requests) == 1:
            message = {"role": "assistant", "content": "", "tool_calls": [{"id": "proposal-1", "type": "function",
                "function": {"name": "propose_command", "arguments": json.dumps({"operation": {"type": "tempo", "bpm": 135}})}}]}
            finish = "tool_calls"
        else:
            assert any(m["role"] == "tool" for m in payload["messages"])
            message, finish = {"role": "assistant", "content": "done"}, "stop"
        return httpx.Response(200, json={"id": f"mock-{len(requests)}", "object": "chat.completion", "created": 1,
            "model": "offline/free:free", "system_fingerprint": None, "choices": [{"index": 0, "message": message, "finish_reason": finish}]})
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            def sdk(**kwargs):
                return original_sdk(**kwargs, async_client=client)
            monkeypatch.setattr(openrouter, "OpenRouter", sdk)
            language = DeepLanguage(LanguageConfig(api_key="offline-placeholder", timeout_s=3))
            result = await language.infer(LanguageJob("u", "Groove shift the pulse to 135", load_fixture("SessionState"), True, False))
            assert result == Command({"type": "tempo", "bpm": 135}, "next-loop")
    asyncio.run(scenario())
    assert len(requests) == 1
