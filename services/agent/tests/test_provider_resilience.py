"""Voice reliability round, WS3 P0: essential commands survive language-provider limits.

Scripted provider failures only (no live quota is spent). A 402/429 starts a shared, bounded
cooldown (Retry-After when given, else doubling backoff); while it lasts no request reaches the
provider, queued work fails fast, nothing is retried or replayed, and exact commands keep working.
"""
import asyncio

import pytest
from fastapi.testclient import TestClient

from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture, validate
from groove_agent.intents import Command
from groove_agent.language import BACKOFF_MAX_S, LanguageWorker, ProviderGate, safe_language_error


class Clock:
    def __init__(self):
        self.now = 100.0
    def __call__(self):
        return self.now


class ProviderError(Exception):
    def __init__(self, status, retry_after=None, where="response"):
        super().__init__("never-forward-provider-text")
        self.status_code = status
        headers = {} if retry_after is None else {"retry-after": str(retry_after)}
        if where == "self":
            self.headers = headers
        else:
            self.response = type("Response", (), {"headers": headers})()


def test_rate_limits_back_off_exponentially_honor_retry_after_and_reset_on_success():
    clock = Clock()
    gate = ProviderGate(clock)
    assert gate.blocked() is None
    gate.failure(ProviderError(429))
    assert gate.blocked() == pytest.approx(15)
    assert "Groove stop" in gate.unavailable_message() and "never-forward" not in gate.unavailable_message()
    clock.now += 16
    gate.failure(ProviderError(402))
    assert gate.blocked() == pytest.approx(30)
    clock.now += 31
    gate.failure(ProviderError(429, retry_after=7, where="self"))
    assert gate.blocked() == pytest.approx(7)
    clock.now += 8
    gate.failure(ProviderError(429, retry_after=99999))
    assert gate.blocked() == pytest.approx(BACKOFF_MAX_S)
    clock.now += BACKOFF_MAX_S + 1
    gate.success()
    gate.failure(ProviderError(429))
    assert gate.blocked() == pytest.approx(15)


def test_ordinary_failures_do_not_block_and_repeated_timeouts_pause_briefly():
    clock = Clock()
    gate = ProviderGate(clock)
    gate.failure(ProviderError(500))
    gate.failure(ValueError("bad tool call"))
    assert gate.blocked() is None
    gate.failure(asyncio.TimeoutError())
    assert gate.blocked() is None
    gate.failure(asyncio.TimeoutError())
    assert gate.blocked() == pytest.approx(10) and "not responding" in gate.unavailable_message()


class LimitedLanguage:
    """Scripted provider: the first call hits a rate limit."""
    def __init__(self, error=None):
        self.gate = ProviderGate()
        self.calls = []
        self.error = error or ProviderError(429, retry_after=60)
    async def infer(self, job):
        self.calls.append(job.text)
        raise self.error


def test_worker_never_storms_the_provider_queued_jobs_fail_fast_without_replay():
    language = LimitedLanguage()
    delivered = []
    async def scenario():
        worker = LanguageWorker(language, lambda job, result, error: delivered.append((job, result, error)))
        for i in range(3):
            assert worker.submit(type("Job", (), {"text": f"request {i}"})())
        for _ in range(50):
            await asyncio.sleep(0.01)
            if len(delivered) == 3:
                break
        assert worker.unavailable() is not None
        await worker.close()
    asyncio.run(scenario())
    assert language.calls == ["request 0"]  # one provider call, no retries, queued work never sent
    assert [result for _, result, _ in delivered] == [None, None, None]
    assert "quota/rate limit" in delivered[0][2] and "never-forward" not in delivered[0][2]
    assert all("for about" in error for _, _, error in delivered[1:])


class CoolingLanguage:
    def __init__(self):
        self.jobs = []
        self.reason = "language provider quota/rate limit reached for about 60 s; no change applied. Exact commands still work"
    def unavailable(self):
        return self.reason
    def submit(self, job):
        self.jobs.append(job)
        return True


ESSENTIAL = [
    ("Groove stop", {"type": "stop-recording"}),
    ("Groove select synth two", {"type": "select", "target": {"trackId": "synth-2"}}),
    ("Groove tempo 100", {"type": "tempo", "bpm": 100}),
    ("Groove clear kick", {"type": "clear", "target": {"trackId": "drums", "lane": "kick"}}),
    ("Groove undo", {"type": "undo"}),
    ("Groove metronome off", {"type": "metronome", "enabled": False}),
    ("Groove key D minor", {"type": "set-pitch-snap", "settings": {"root": 2, "scale": "minor"}}),
]


@pytest.mark.parametrize("text, operation", ESSENTIAL)
def test_essential_commands_work_while_the_provider_is_cooling_down(text, operation):
    from test_speech_harness import connect
    connection = connect(None)
    connection._language = language = CoolingLanguage()
    replies = connection.handle({"type": "utterance", "id": "u", "text": text, "clockId": "ctx", "startFrame": 352900,
                                 "endFrame": 353900, "duringRecording": True}, 0)
    assert replies[0]["type"] == "command-span" and replies[-1]["command"]["operation"] == operation
    assert language.jobs == []


def test_unknown_requests_get_an_immediate_truthful_refusal_during_cooldown():
    from test_speech_harness import connect
    connection = connect(None)
    connection._language = language = CoolingLanguage()
    replies = connection.handle({"type": "utterance", "id": "u", "text": "Groove make the chorus wider", "clockId": "ctx",
                                 "startFrame": 352900, "endFrame": 353900, "duringRecording": True}, 0)
    assert [r["type"] for r in replies] == ["command-span", "error"]  # still excluded from the take
    assert replies[1]["message"] == language.reason and language.jobs == []


def test_provider_error_text_is_safe_and_names_working_alternatives():
    message = safe_language_error(ProviderError(429))
    assert "no change applied" in message and "Groove stop" in message and "never-forward" not in message


def test_actual_websocket_service_degrades_to_exact_commands_after_a_429(monkeypatch):
    import importlib
    module = importlib.import_module("groove_agent.app")
    language = LimitedLanguage(ProviderError(429, retry_after=45))
    monkeypatch.setattr(module, "language", language)
    client = TestClient(module.app)
    utterance = lambda text, uid: {"type": "utterance", "id": uid, "text": text, "clockId": "c", "startFrame": 0,
                                   "endFrame": 1, "duringRecording": False}
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "session", "session": load_fixture("SessionState")})
        ws.send_json(utterance("make the chorus wider", "u1"))
        reply = ws.receive_json()
        assert reply["requestId"] == "u1" and "quota/rate limit" in reply["message"]
        assert "cooling down" in client.get("/healthz").json()["language"]
        ws.send_json(utterance("make the drums swing", "u2"))
        reply = ws.receive_json()
        assert reply["requestId"] == "u2" and "for about" in reply["message"]
        ws.send_json(utterance("tempo 100", "u3"))
        reply = ws.receive_json()
        validate("ServerMessage", reply)
        assert reply["command"]["operation"] == {"type": "tempo", "bpm": 100}
    assert language.calls == ["make the chorus wider"]  # exactly one provider request in total
