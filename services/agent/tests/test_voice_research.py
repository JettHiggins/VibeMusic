"""Published voice-research producers and connection-local preview lifecycle."""
from copy import deepcopy
import pytest

from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture, validate
from groove_agent.intents import AuditionCandidate, Command, interpret
from groove_agent.preview import PreviewRequests
from test_connection import ack, utter, transport_msg, send


class Research:
    def __init__(self):
        self.jobs, self.cancelled = [], []
    def start(self, job_id, description, seeds=None):
        self.jobs.append((job_id, description, seeds))
    def cancel(self, job_id):
        self.cancelled.append(job_id)
        return True


def connection(enabled=True, speech=None):
    port = Research()
    conn = Connection(research=port, voice_research=enabled, speech=speech)
    session = load_fixture("SessionState")
    session["selected"] = {"trackId": "synth-1"}
    send(conn, {"type": "session", "session": session})
    send(conn, transport_msg())
    return conn, port


def candidates():
    first = load_fixture("PatchCandidate")
    first["previewUrl"] = "http://127.0.0.1:8000/previews/synthetic-fixture.wav"
    second = {**deepcopy(first), "id": "patch-2"}
    second["patch"]["preset"] = 1
    return [first, second]


def ui_search(conn, job="ui", track="synth-1"):
    return send(conn, {"type": "sound-request", "id": job, "trackId": track, "description": "electric piano"})


def complete(conn, job="ui", items=None):
    message = {"type": "research", "jobId": job, "status": "complete", "progress": 1,
               "candidates": candidates() if items is None else items}
    validate("ServerMessage", message)
    return conn.observe_research(message)


def preview_ack(request="p:preview", job="ui", candidate="patch-2", status="started", **kwargs):
    return {"type": "preview-ack", "id": request, "jobId": job, "candidateId": candidate, "status": status, **kwargs}


def test_new_production_messages_are_default_off():
    conn, port = connection(False)
    assert send(conn, utter("sound", "find an electric piano")) == []
    assert port.jobs[0][0] == "sound:job"
    complete(conn, "sound:job")
    result = send(conn, utter("p", "Groove audition candidate two", True))
    assert [r["type"] for r in result] == ["command-span", "error"]
    assert "not enabled" in result[-1]["message"]


def test_voice_context_is_bound_to_original_track_and_refine_supersedes():
    conn, port = connection()
    replies = send(conn, utter("sound", "Groove find an electric piano", True))
    assert [r["type"] for r in replies] == ["command-span", "research-context"]
    assert replies[1] == {"type": "research-context", "requestId": "sound", "jobId": "sound:job",
                          "trackId": "synth-1", "description": "electric piano", "origin": "voice"}
    assert send(conn, utter("sound", "Groove find an electric piano", True)) == []
    complete(conn, "sound:job")
    conn.session["selected"] = {"trackId": "synth-3"}
    refined = send(conn, utter("refine", "Groove make it warmer", True))
    context = next(r for r in refined if r["type"] == "research-context")
    assert context["trackId"] == "synth-1" and context["jobId"] == "refine:job"
    assert context["description"] == "electric piano, warmer"
    assert port.jobs[-1][2] == [c["patch"] for c in candidates()]
    assert send(conn, utter("stale", "audition two"))[0]["type"] == "error"


def test_superseded_running_work_cannot_revive_or_rebind_ids():
    conn, port = connection()
    ui_search(conn, "older")
    send(conn, utter("newer", "find a bell"))
    assert port.cancelled == ["older"]
    assert complete(conn, "older") is None
    assert ui_search(conn, "older", track="synth-2")[0]["status"] == "failed"
    assert len(port.jobs) == 2


def test_preview_uses_exact_ids_and_never_changes_musical_state():
    conn, _ = connection()
    ui_search(conn)
    complete(conn)
    before = deepcopy(conn.session)
    replies = send(conn, utter("p", "Groove audition candidate two", True), now=1)
    assert [r["type"] for r in replies] == ["command-span", "candidate-preview"]
    assert replies[1] == {"type": "candidate-preview", "id": "p:preview", "jobId": "ui", "candidateId": "patch-2"}
    assert send(conn, preview_ack(), now=2) == []
    assert send(conn, preview_ack(), now=3) == []
    assert send(conn, preview_ack(status="ended"), now=4) == []
    assert send(conn, preview_ack(status="ended"), now=5) == []
    assert conn.session == before and conn.pending_command_ids == []


@pytest.mark.parametrize("field,value", [("jobId", "older"), ("candidateId", "patch-1"), ("id", "other")])
def test_preview_ack_must_match_the_entire_binding(field, value):
    conn, _ = connection()
    ui_search(conn); complete(conn)
    send(conn, utter("p", "audition two"), now=0)
    message = preview_ack(); message[field] = value
    assert send(conn, message, now=1)[0]["type"] == "error"
    assert "p:preview" in conn._previews.pending


def test_preview_start_finish_timeouts_and_blocked_playback_are_explicit():
    controller = PreviewRequests(start_timeout=2, finish_timeout=4)
    candidate = candidates()[0]
    controller.request("one", "job", candidate, 0)
    assert "start" in controller.tick(2)[0]["message"]
    controller.request("two", "job", candidate, 3)
    started = preview_ack(request="two", job="job", candidate=candidate["id"])
    assert controller.acknowledge(started, 4) == []
    assert controller.acknowledge(started, 7) == []
    assert "finish" in controller.tick(8)[0]["message"]
    controller.request("three", "job", candidate, 9)
    rejected = preview_ack(request="three", job="job", candidate=candidate["id"], status="rejected", reason="play blocked")
    assert "play blocked" in controller.acknowledge(rejected, 10)[0]["message"]
    assert not controller.pending


def test_preview_dedup_conflicting_ids_premature_end_and_replacement():
    controller = PreviewRequests()
    first, second = candidates()
    controller.request("one", "job", first, 0)
    assert controller.request("one", "job", first, 1) == []
    assert controller.request("one", "job", second, 1)[0]["type"] == "error"
    assert controller.acknowledge(preview_ack(request="one", job="job", candidate=first["id"], status="ended"), 1)[0]["type"] == "error"
    replaced = controller.request("two", "job", second, 2)
    assert [r["type"] for r in replaced] == ["error", "candidate-preview"]
    assert controller.acknowledge(preview_ack(request="one", job="job", candidate=first["id"], status="started"), 3) == []
    assert list(controller.pending) == ["two"]


def test_removed_or_replaced_candidate_retires_preview_even_with_reused_id():
    conn, _ = connection()
    ui_search(conn); complete(conn)
    send(conn, utter("p", "audition two"))
    items = candidates(); items[1]["previewUrl"] += "?changed"
    assert complete(conn, items=items)[0]["type"] == "error"
    assert not conn._previews.pending


def test_new_job_waits_for_voice_patch_acceptance_and_external_queued_ui_edit():
    conn, port = connection()
    ui_search(conn); complete(conn)
    result = send(conn, utter("accept", "use number two"))
    command = result[0]["command"]
    assert command["operation"]["type"] == "apply-patch"
    assert ui_search(conn, "blocked")[0]["status"] == "failed"
    voice_rejected = send(conn, utter("blocked-voice", "Groove find a bell", True))
    assert [r["type"] for r in voice_rejected] == ["command-span", "error"]
    assert voice_rejected[-1]["requestId"] == "blocked-voice"
    assert len(port.jobs) == 1
    send(conn, ack(command["id"], "applied", 1))
    assert ui_search(conn, "fresh") == []
    send(conn, ack("browser-owned-patch", "queued", 1))
    assert ui_search(conn, "blocked-ui")[0]["status"] == "failed"
    send(conn, ack("browser-owned-patch", "applied", 2))
    assert ui_search(conn, "fresh-ui") == []


def test_newer_ui_search_refuses_old_voice_research_but_allows_fresh_voice():
    conn, port = connection()
    transport = transport_msg()
    transport["transport"]["currentFrame"] = 5000
    send(conn, transport)
    ui_search(conn)
    assert "newer UI" in send(conn, utter("old", "find a bell", start=1000, end=2000))[0]["message"]
    assert len(port.jobs) == 1
    context = send(conn, utter("fresh", "find a bell", start=6000, end=7000))
    assert context[0]["type"] == "research-context" and len(port.jobs) == 2


def test_fresh_manual_accept_at_same_stopped_clock_frame_is_not_mistaken_for_old_stt():
    conn, _ = connection()
    transport = transport_msg(); transport["transport"]["currentFrame"] = 1000
    send(conn, transport)
    ui_search(conn); complete(conn)
    replies = send(conn, utter("accept", "use number two", start=1000, end=1000))
    assert replies[0]["command"]["operation"]["type"] == "apply-patch"


def test_disconnect_drops_previews_pending_model_results_and_late_worker_updates():
    from test_language import PendingLanguage
    conn, _ = connection()
    ui_search(conn); complete(conn)
    send(conn, utter("p", "audition two"))
    conn._language = language = PendingLanguage()
    send(conn, utter("model", "Groove craft a warmer piano", start=6000, end=7000))
    job = language.jobs[0]
    conn.close()
    assert not conn._previews.pending
    assert conn.language_result(job, Command({"type": "undo"}, "immediate"), None, 1) == []
    assert complete(conn) is None
    assert conn.tick(100) == []


@pytest.mark.parametrize("phrase", ["audition two", "preview candidate 2", "listen to the second candidate", "hear number two"])
def test_audition_parser_is_typed_and_wake_gated(phrase):
    session = load_fixture("SessionState")
    assert interpret("Groove " + phrase, session, True) == AuditionCandidate(2)
    from groove_agent.intents import Ignored
    assert isinstance(interpret(phrase, session, True), Ignored)


def test_closed_speech_job_cannot_supersede_a_newer_ui_request(tmp_path):
    from test_speech_harness import ScriptedWorker, synth_take, chunks_from_wav, stream, transport_message
    worker = ScriptedWorker(["Groove find a warm piano"])
    conn, port = connection(speech=worker)
    # Use the WAV harness clock while preserving the selected synth/research backend.
    send(conn, transport_message("recording", 352800))
    stream(conn, worker, chunks_from_wav(synth_take(tmp_path / "late.wav")), transcribe_each_chunk=False)
    assert worker.jobs
    ui_search(conn, "newer-ui")
    replies = worker.finish(conn)
    assert "research-context" not in [r["type"] for r in replies]
    assert [r["type"] for r in replies][:2] == ["command-span", "error"]
    assert "newer UI" in replies[1]["message"]
    assert [job[0] for job in port.jobs] == ["newer-ui"]
    assert any(r["type"] == "speech-verified" for r in replies)


def test_open_speech_segment_closing_later_uses_measured_wake_time_for_ui_order(tmp_path):
    from test_speech_harness import ScriptedWorker, synth_take, chunks_from_wav, stream, flat, transport_message, frame_at
    from groove_agent.speech_pipeline import Transcript, Word
    worker = ScriptedWorker([Transcript("Groove find a warm piano", (
        Word("Groove", 2, 2.2), Word("find a warm piano", 2.2, 2.7)))])
    conn, port = connection(speech=worker)
    send(conn, transport_message("recording", 352800))
    take = synth_take(tmp_path / "open.wav", hits=(), speech=(1, 2.5), more_speech=((3, 3.7),), seconds=5)
    chunks = list(chunks_from_wav(take))
    split = next(i for i, c in enumerate(chunks) if c["startFrame"] >= frame_at(2.96))
    stream(conn, worker, chunks[:split])
    send(conn, transport_message("recording", frame_at(2.96)))
    ui_search(conn, "ui-between-music-and-wake")
    replies = flat(stream(conn, worker, chunks[split:]))
    context = next(r for r in replies if r["type"] == "research-context")
    assert context["jobId"] != "ui-between-music-and-wake"
    assert port.cancelled == ["ui-between-music-and-wake"]
    # Pre-roll begins BEFORE the UI frame; the actual recognized wake begins AFTER it.
    span = next(r for r in replies if r["type"] == "command-span")
    assert span["startFrame"] < frame_at(2.96)


def test_open_older_wake_is_refused_when_segment_closes_after_ui_request(tmp_path):
    from test_speech_harness import ScriptedWorker, synth_take, chunks_from_wav, stream, flat, transport_message, frame_at
    worker = ScriptedWorker(["Groove find a warm piano"])
    conn, port = connection(speech=worker)
    send(conn, transport_message("recording", 352800))
    chunks = list(chunks_from_wav(synth_take(tmp_path / "old-open.wav")))
    split = next(i for i, c in enumerate(chunks) if c["startFrame"] >= frame_at(2.4))
    stream(conn, worker, chunks[:split])
    send(conn, transport_message("recording", frame_at(2.4)))
    ui_search(conn, "newer-ui")
    replies = flat(stream(conn, worker, chunks[split:]))
    assert "research-context" not in [r["type"] for r in replies]
    assert "newer UI" in next(r for r in replies if r["type"] == "error")["message"]
    assert [job[0] for job in port.jobs] == ["newer-ui"]


def test_socket_queues_context_before_immediate_worker_progress(monkeypatch):
    import importlib
    from fastapi.testclient import TestClient
    module = importlib.import_module("groove_agent.app")
    class Port(Research):
        closed = False
        def __init__(self, callback):
            super().__init__()
            self.callback = callback
        def start(self, job_id, description, seeds=None):
            super().start(job_id, description, seeds)
            self.callback({"type": "research", "jobId": job_id, "status": "complete", "progress": 1, "candidates": candidates()})
        def close(self):
            self.closed = True
    class Service:
        backend = None
        def port(self, callback):
            self.created = Port(callback)
            return self.created
    service = Service()
    monkeypatch.setattr(module, "research_service", service)
    monkeypatch.setattr(module, "voice_research", True)
    monkeypatch.setattr(module, "language", None)
    session = load_fixture("SessionState"); session["selected"] = {"trackId": "synth-1"}
    with TestClient(module.app).websocket_connect("/ws") as ws:
        ws.send_json({"type": "session", "session": session})
        ws.send_json(transport_msg())
        ws.send_json(utter("sound", "Groove find a piano", True))
        replies = [ws.receive_json() for _ in range(3)]
        assert [r["type"] for r in replies] == ["command-span", "research-context", "research"]
        for reply in replies:
            validate("ServerMessage", reply)
        ws.send_json(utter("p", "Groove audition two", True))
        assert ws.receive_json()["type"] == "command-span"
        assert ws.receive_json()["type"] == "candidate-preview"
        ws.send_json(preview_ack(job="sound:job", status="rejected", reason="blocked playback"))
        assert "blocked playback" in ws.receive_json()["message"]
    assert service.created.closed


def test_pending_language_research_cannot_supersede_newer_ui_job():
    from test_language import PendingLanguage
    from groove_agent.intents import SoundSearch
    conn, port = connection()
    conn._language = language = PendingLanguage()
    send(conn, utter("old", "Groove craft a bell"))
    job = language.jobs[0]
    ui_search(conn, "newer-ui")
    replies = conn.language_result(job, SoundSearch("bell"), None, 1)
    assert [r["type"] for r in replies] == ["error"]
    assert [job[0] for job in port.jobs] == ["newer-ui"]


def test_cancelled_job_cannot_be_revived_by_late_worker_progress():
    conn, _ = connection()
    ui_search(conn)
    send(conn, {"type": "cancel-job", "jobId": "ui"})
    assert complete(conn) is None
    assert conn._latest_search().status == "cancelled"


def test_browser_cleanup_of_superseded_context_does_not_cancel_a_fresh_voice_intent():
    from test_language import PendingLanguage
    from groove_agent.intents import SoundSearch
    conn, port = connection()
    ui_search(conn, "old")
    ui_search(conn, "current")
    conn._language = language = PendingLanguage()
    send(conn, utter("fresh", "Groove craft a bell", start=6000, end=7000))
    job = language.jobs[0]
    assert send(conn, {"type": "cancel-job", "jobId": "old"}) == []
    replies = conn.language_result(job, SoundSearch("bell"), None, 1)
    assert replies[0]["type"] == "research-context"
    assert port.jobs[-1][0] == "fresh:job"


def test_missing_preview_url_and_duplicate_candidate_ids_are_refused():
    conn, _ = connection()
    ui_search(conn)
    items = candidates(); items[1]["previewUrl"] = ""
    complete(conn, items=items)
    assert "unavailable" in send(conn, utter("missing", "audition two"))[0]["message"]
    items = candidates(); items[1]["id"] = items[0]["id"]
    complete(conn, items=items)
    assert "ambiguous" in send(conn, utter("duplicate", "audition two"))[0]["message"]


def test_preview_history_is_bounded_and_new_connection_cannot_ack_old_preview():
    controller = PreviewRequests()
    candidate = candidates()[0]
    for index in range(300):
        controller.request(str(index), "job", candidate, index)
    assert len(controller.retired) == 256 and len(controller.pending) == 1
    fresh = PreviewRequests()
    assert fresh.acknowledge(preview_ack(request="299", job="job", candidate=candidate["id"]), 301)[0]["type"] == "error"


def test_typed_language_preview_is_exposed_only_with_rollout_flag():
    pytest.importorskip("deepagents")
    import asyncio
    from groove_agent.language import DeepLanguage, LanguageConfig, LanguageJob, decode_decision
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    class PreviewModel(BaseChatModel):
        @property
        def _llm_type(self):
            return "SCRIPTED preview fixture"
        def bind_tools(self, tools, **kwargs):
            assert "audition_candidate" in {t.name for t in tools}
            return self
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content="", tool_calls=[
                {"name": "audition_candidate", "args": {"index": 2}, "id": "preview"}]))])
    language = DeepLanguage(LanguageConfig(api_key="offline", voice_research=True), model=PreviewModel())
    result = asyncio.run(language.infer(LanguageJob("u", "Groove let me hear the second option", load_fixture("SessionState"), True, False)))
    assert result == AuditionCandidate(2)
    assert decode_decision({"kind": "preview", "index": 2}) == result


def test_rollout_flag_requires_explicit_one(monkeypatch):
    from groove_agent.language import voice_research_enabled
    monkeypatch.delenv("GROOVE_VOICE_RESEARCH", raising=False)
    assert not voice_research_enabled()
    monkeypatch.setenv("GROOVE_VOICE_RESEARCH", "1")
    assert voice_research_enabled()
    monkeypatch.setenv("GROOVE_VOICE_RESEARCH", "auto")
    with pytest.raises(ValueError):
        voice_research_enabled()


def test_server_deadlines_leave_margin_for_browser_start_and_finish_rejections():
    controller = PreviewRequests()
    first = candidates()[0]
    controller.request("start", "job", first, 0)
    assert controller.tick(5) == []
    assert controller.acknowledge(preview_ack(request="start", job="job", candidate=first["id"],
                                             status="rejected", reason="browser start timeout"), 5.1)[0]["type"] == "error"
    controller.request("finish", "job", first, 6)
    controller.acknowledge(preview_ack(request="finish", job="job", candidate=first["id"]), 7)
    assert controller.tick(128) == []  # browser has 120 s from started, plus delivery grace
    assert controller.acknowledge(preview_ack(request="finish", job="job", candidate=first["id"],
                                             status="rejected", reason="browser finish timeout"), 128.1)[0]["type"] == "error"
