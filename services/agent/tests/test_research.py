import json
import random
import threading

import numpy as np
import pytest
from fastapi.testclient import TestClient

from groove_agent.app import app
from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture, validate
from groove_agent.intents import AcceptCandidate, CancelSearch, NotUnderstood, SoundSearch, interpret
from groove_agent.research.audio import DEFAULT_RECIPE, render_problem, unit, wav_bytes
from groove_agent.research.corpus import Cancelled, Corpus
from groove_agent.research.mock import MockEmbedder, MockRenderer
from groove_agent.research.search import MAX_VARIATIONS, Scored, evolve
from groove_agent.research.service import NOT_CONFIGURED, ResearchService
from groove_agent.research.space import MetadataError, ParameterSpace
from research_fixtures import REVISION, backend, metadata, space


# -- parameter space ---------------------------------------------------------------

def test_presets_are_complete_valid_contract_patches():
    s = space()
    presets = s.preset_patches()
    assert len(presets) == 12
    for label, patch in presets:
        assert s.problem(patch) is None, label
        assert len(patch["parameters"]) == 19 and "0" not in patch["parameters"]  # LVL is session-owned
        validate("PatchCandidate", {"id": "x", "patch": patch, "provenance": label, "previewUrl": "", "score": 0})


def test_tunable_set_excludes_notes_level_and_fixed_parameters():
    names = [(b.index, b.name) for b in space().tunable(0)]
    assert (1, "ATK") in names and (5, "FLT") in names and (10, "DST") in names
    assert (9, "FLT") not in names  # second FLT is the LFO depth, not in the default tone set
    for excluded in (0, 6, 7, 8, 11, 19):  # LVL, PIT, MODE, PIT, MUTE, FIXED
        assert excluded not in [i for i, _ in names]


def test_mutation_is_bounded_seeded_and_only_touches_tunables():
    s = space()
    _, base = s.preset_patches()[5]
    tunable = {str(b.index) for b in s.tunable(base["engine"])}
    rng = random.Random(7)
    for _ in range(300):
        child = s.mutate(base, rng, rate=1.0, scale=2.0)  # extreme settings must still stay in bounds
        assert s.problem(child) is None
        changed = {k for k in child["parameters"] if child["parameters"][k] != base["parameters"][k]}
        assert changed and changed <= tunable
        assert (child["engine"], child["preset"], child["engineRevision"]) == (base["engine"], base["preset"], REVISION)
    assert s.mutate(base, random.Random(3)) == s.mutate(base, random.Random(3))


def test_patch_problems_are_detected():
    s = space()
    _, patch = s.preset_patches()[0]
    assert "revision" in s.problem({**patch, "engineRevision": "other"})
    assert s.problem({**patch, "engine": 99}) == "unknown engine"
    assert "outside" in s.problem({**patch, "parameters": {**patch["parameters"], "1": 500}})
    assert "unknown parameter" in s.problem({**patch, "parameters": {"999": 1}})
    assert "owned by the session" in s.problem({**patch, "parameters": {"0": 100}})


def test_bad_metadata_is_refused():
    broken = metadata()
    broken["engines"][0]["presets"][0]["parameters"].pop()
    with pytest.raises(MetadataError):
        ParameterSpace(broken, REVISION)
    with pytest.raises(MetadataError):
        ParameterSpace({"engineParamOffset": 3, "parameters": [], "engines": []}, REVISION)


# -- audio gate ----------------------------------------------------------------------

def test_render_gate_rejects_silent_clipping_and_broken_audio():
    t = np.arange(8000) / 8000
    good = 0.5 * np.sin(2 * np.pi * 220 * t)
    assert render_problem(good) is None
    assert render_problem(np.zeros(8000)) == "silent"
    assert render_problem(np.clip(good * 10, -1, 1)) == "clipping"
    assert render_problem(np.full(10, np.nan)) == "non-finite samples"
    assert render_problem(np.array([])) == "empty render"
    assert wav_bytes(good, 8000)[:4] == b"RIFF"


# -- corpus and retrieval --------------------------------------------------------------

def build(variations=1):
    s = space()
    return s, Corpus.build(s, MockRenderer(s, 8000), MockEmbedder(), DEFAULT_RECIPE, seed=4,
                           variations_per_preset=variations)


def test_corpus_holds_presets_and_seeded_variations_and_is_reproducible():
    s, corpus = build()
    assert len(corpus.entries) == 24 and corpus.rejected == 0
    assert all(s.problem(e.patch) is None and abs(np.linalg.norm(e.embedding) - 1) < 1e-9 for e in corpus.entries)
    _, again = build()
    assert [e.patch for e in again.entries] == [e.patch for e in corpus.entries]
    assert np.allclose(np.stack([e.embedding for e in again.entries]), np.stack([e.embedding for e in corpus.entries]))


def test_retrieval_returns_top_five_by_cosine_similarity():
    _, corpus = build()
    query = corpus.entries[9].embedding  # a text vector identical to one entry must retrieve that entry first
    top = corpus.top(query, 5)
    assert len(top) == 5 and top[0][0].id == corpus.entries[9].id and top[0][1] == pytest.approx(1.0)
    scores = [score for _, score in top]
    assert scores == sorted(scores, reverse=True)
    everything = sorted((float(e.embedding @ unit(query)) for e in corpus.entries), reverse=True)
    assert scores == pytest.approx(everything[:5])


def test_corpus_rejects_silent_renders_and_revision_mismatch():
    s = space()

    class Silent(MockRenderer):
        def render(self, patch, recipe):
            audio = super().render(patch, recipe)
            return audio * 0 if patch["engine"] == 1 else audio

    corpus = Corpus.build(s, Silent(s, 8000), MockEmbedder(), DEFAULT_RECIPE)
    assert len(corpus.entries) == 8 and corpus.rejected == 4
    renderer = MockRenderer(s, 8000)
    renderer.engine_revision = "other"
    with pytest.raises(ValueError):
        Corpus.build(s, renderer, MockEmbedder(), DEFAULT_RECIPE)


def test_corpus_save_and_load_round_trip(tmp_path):
    _, corpus = build(variations=0)
    corpus.save(tmp_path / "corpus")
    loaded = Corpus.load(tmp_path / "corpus")
    assert [e.patch for e in loaded.entries] == [e.patch for e in corpus.entries]
    assert loaded.recipe == corpus.recipe and loaded.engine_revision == REVISION
    assert (tmp_path / "corpus" / "audio" / "preset-0.wav").stat().st_size > 44
    query = MockEmbedder().embed_text("warm pad")
    assert [e.id for e, _ in loaded.top(query)] == [e.id for e, _ in corpus.top(query)]


def test_corpus_build_can_be_cancelled():
    s = space()
    calls = []
    with pytest.raises(Cancelled):
        Corpus.build(s, MockRenderer(s, 8000), MockEmbedder(), DEFAULT_RECIPE,
                     cancelled=lambda: len(calls) >= 3, progress=lambda done, total: calls.append(done))
    assert calls == [1, 2, 3]


# -- evolutionary search -----------------------------------------------------------------

def run_search(seed=11, budget=48, renderer=None, **kwargs):
    s, corpus = build(variations=0)
    embedder = MockEmbedder()
    query = embedder.embed_text("glassy bell")
    seeds = [Scored(e.patch, score, e.label, e.audio) for e, score in corpus.top(query, 5)]
    result = evolve(seeds, s, renderer or MockRenderer(s, 8000), embedder, query, DEFAULT_RECIPE, seed=seed,
                    budget=budget, **kwargs)
    return s, seeds, result


def test_search_is_seeded_bounded_and_never_worse_than_retrieval():
    s, seeds, result = run_search()
    assert result.rendered == 48
    assert len(result.best) == 5 and len({c.key() for c in result.best}) == 5
    assert all(s.problem(c.patch) is None for c in result.best)
    assert result.best[0].score >= max(x.score for x in seeds)
    assert [c.score for c in result.best] == sorted((c.score for c in result.best), reverse=True)
    _, _, again = run_search()
    assert [c.patch for c in again.best] == [c.patch for c in result.best]
    _, _, other = run_search(seed=12)
    assert [c.patch for c in other.best] != [c.patch for c in result.best]


def test_search_budget_is_capped_at_128_per_request():
    renders = []

    class Counting(MockRenderer):
        def render(self, patch, recipe):
            renders.append(1)
            return super().render(patch, recipe)

    _, _, result = run_search(budget=10_000, renderer=Counting(space(), 8000))
    assert result.rendered == MAX_VARIATIONS == 128 and len(renders) == 128


def test_search_rejects_clipping_children_and_reports_progress():
    class Clipping(MockRenderer):
        def render(self, patch, recipe):
            return np.ones(8000, dtype=np.float32)

    seen = []
    _, seeds, result = run_search(budget=20, renderer=Clipping(space(), 8000),
                                  progress=lambda done, total, best: seen.append((done, total)))
    assert result.rejected == 20 and seen == [(16, 20), (20, 20)]
    assert {c.key() for c in result.best} == {c.key() for c in seeds}


def test_search_can_be_cancelled():
    count = []
    with pytest.raises(Cancelled):
        run_search(cancelled=lambda: count.append(1) or len(count) > 5)


# -- job service --------------------------------------------------------------------------

def collect(service, description="electric piano", seeds=None, job_id="job1"):
    messages = []
    port = service.port(messages.append)
    port.start(job_id, description, seeds)
    port.join()
    for message in messages:
        validate("ServerMessage", message)
    return messages


def test_job_streams_retrieval_first_then_progress_then_complete():
    service = ResearchService(backend(budget=32))
    messages = collect(service)
    statuses = [m["status"] for m in messages]
    assert statuses == ["running"] * (len(messages) - 1) + ["complete"]
    assert messages[0]["candidates"] == [] and messages[0]["progress"] == 0
    retrieval = messages[1]
    assert len(retrieval["candidates"]) == 5 and all("retrieved" in c["provenance"] for c in retrieval["candidates"])
    progress = [m["progress"] for m in messages]
    assert progress == sorted(progress) and progress[-1] == 1.0 and progress[-2] < 1.0
    final = messages[-1]["candidates"]
    assert len(final) == 5 and final[0]["score"] >= retrieval["candidates"][0]["score"]
    for candidate in final:
        assert "MOCK" in candidate["provenance"]  # mock output is always labeled
        assert service.backend.space.problem(candidate["patch"]) is None
        token = candidate["previewUrl"].rsplit("/", 1)[1].removesuffix(".wav")
        assert candidate["previewUrl"].startswith("http://127.0.0.1:8000/previews/")
        assert service.preview(token)[:4] == b"RIFF"
    ids = {c["id"]: json.dumps(c["patch"], sort_keys=True) for m in messages for c in m["candidates"]}
    assert len(set(ids.values())) == len(ids)  # an ID always names the same patch
    assert [c["patch"] for c in collect(ResearchService(backend(budget=32)))[-1]["candidates"]] == [c["patch"] for c in final]


def test_job_without_backend_fails_with_the_dependency_named():
    messages = collect(ResearchService(None))
    assert [m["status"] for m in messages] == ["failed"] and messages[0]["error"] == NOT_CONFIGURED
    assert messages[0]["candidates"] == []


def test_job_cancellation_reports_cancelled_and_keeps_last_candidates():
    b = backend(budget=128)
    release = threading.Event()
    original = b.renderer.render
    state = {"count": 0}
    reached = threading.Event()

    def slow(patch, recipe):
        state["count"] += 1
        if state["count"] == 20:  # corpus (12 renders) done and retrieval sent; now mid-search
            reached.set()
            release.wait(10)
        return original(patch, recipe)

    b.renderer.render = slow
    messages = []
    port = ResearchService(b).port(messages.append)
    port.start("job1", "electric piano")
    assert reached.wait(10)
    assert port.cancel("job1") is True
    release.set()
    port.join()
    assert messages[-1]["status"] == "cancelled" and len(messages[-1]["candidates"]) == 5
    assert state["count"] < 12 + 128
    assert port.cancel("job1") is False and port.cancel("nope") is False


def test_job_failure_is_contained():
    b = backend()
    b.renderer.render = lambda patch, recipe: (_ for _ in ()).throw(RuntimeError("renderer crashed"))
    messages = collect(ResearchService(b))
    assert messages[-1]["status"] == "failed" and "renderer crashed" in messages[-1]["error"]


def test_refinement_carries_previous_candidates_forward():
    service = ResearchService(backend(budget=16))
    first = collect(service)[-1]["candidates"]
    carried = [c["patch"] for c in first]
    messages = collect(service, "electric piano, brighter", seeds=carried + [{"engine": 99}], job_id="job2")
    start = messages[1]["candidates"]
    assert all("carried over" in c["provenance"] for c in start)  # refines those candidates, not a new retrieval
    assert {json.dumps(c["patch"], sort_keys=True) for c in start} <= {json.dumps(p, sort_keys=True) for p in carried}
    assert len({c["id"] for c in start}) == len(start)
    assert messages[-1]["status"] == "complete"
    unusable = collect(service, "pad", seeds=[{"engine": 99}], job_id="job3")
    assert all("retrieved" in c["provenance"] for c in unusable[1]["candidates"])


# -- spoken sound design ---------------------------------------------------------------------

@pytest.fixture
def session():
    s = load_fixture("SessionState")
    s["selected"] = {"trackId": "synth-2"}
    return s


def test_sound_intents(session):
    assert interpret("Make it sound like an 80s electric piano", session, False) == SoundSearch("80s electric piano")
    assert interpret("I want a warm pad sound", session, False) == SoundSearch("warm pad")
    assert interpret("find me something like a plucked bass", session, False) == SoundSearch("plucked bass")
    assert interpret("make it brighter", session, False) == SoundSearch("brighter", refine=True)
    assert interpret("more attack", session, False) == SoundSearch("more attack", refine=True)
    assert interpret("refine with less reverb", session, False) == SoundSearch("with less reverb", refine=True)
    assert interpret("accept", session, False) == AcceptCandidate(1)
    assert interpret("use number two", session, False) == AcceptCandidate(2)
    assert interpret("take the third one", session, False) == AcceptCandidate(3)
    assert interpret("cancel", session, False) == CancelSearch()
    assert isinstance(interpret("make it sound like", session, False), NotUnderstood)
    assert interpret("make it faster", session, False).operation == {"type": "tempo", "bpm": 130}


class FakePort:
    def __init__(self):
        self.started, self.cancelled = [], []

    def start(self, job_id, description, seeds=None):
        self.started.append((job_id, description, seeds))

    def cancel(self, job_id):
        self.cancelled.append(job_id)
        return True


def utter(uid, text, recording=False):
    return {"type": "utterance", "id": uid, "text": text, "clockId": "c", "startFrame": 0, "endFrame": 9,
            "duringRecording": recording}


def candidates(job_id, count=3):
    patch = load_fixture("PatchCandidate")["patch"]
    return [{"id": f"{job_id}:{i}", "patch": {**patch, "parameters": {"1": i}}, "provenance": "test", "previewUrl": "",
             "score": 1 - i / 10} for i in range(1, count + 1)]


def test_describe_audition_refine_accept_by_voice(session):
    port = FakePort()
    conn = Connection(research=port)
    conn.handle({"type": "session", "session": session}, 0)

    assert conn.handle(utter("u1", "make it sound like an 80s electric piano"), 0) == []
    assert port.started == [("u1:job", "80s electric piano", None)]
    assert conn.handle(utter("u2", "accept"), 0)[0]["type"] == "error"  # nothing to accept yet

    conn.observe_research({"type": "research", "jobId": "u1:job", "status": "complete", "progress": 1,
                           "candidates": candidates("u1:job")})
    assert conn.handle(utter("u3", "make it brighter"), 0) == []
    job, description, seeds = port.started[1]
    assert (job, description) == ("u3:job", "80s electric piano, brighter")
    assert seeds == [c["patch"] for c in candidates("u1:job")]

    conn.observe_research({"type": "research", "jobId": "u3:job", "status": "running", "progress": 0.5,
                           "candidates": candidates("u3:job")})
    out = conn.handle(utter("u4", "use number two"), 0)
    validate("ServerMessage", out[0])
    assert out[0]["command"] == {"id": "u4:cmd", "expectedRevision": 0, "boundary": "next-loop", "operation": {
        "type": "apply-patch", "trackId": "synth-2", "patch": candidates("u3:job")[1]["patch"]}}
    assert conn.handle(utter("u5", "use number nine"), 0)[0]["type"] == "error"
    assert conn.handle(utter("u6", "cancel"), 0) == [] and port.cancelled == ["u3:job"]

    # A new job cannot replace a patch acceptance whose authoritative ack is pending.
    blocked = conn.handle(utter("u7", "make it darker"), 0)
    assert blocked[0]["status"] == "failed" and "pending" in blocked[0]["error"]
    out = conn.handle(utter("u8", "use the first one"), 0)
    assert out == []  # queued behind the unacknowledged apply-patch from u4
    assert conn.handle({"type": "ack", "commandId": "u4:cmd", "status": "applied", "revision": 1}, 0)[0]["command"][
        "operation"]["patch"] == candidates("u3:job")[0]["patch"]
    conn.handle({"type": "ack", "commandId": "u8:cmd", "status": "applied", "revision": 2}, 0)
    # Legacy/default-off producers still retain previous candidates if a later empty
    # refinement is cancelled. The enabled context consumer instead clears its display.
    assert conn.handle(utter("u9", "make it darker"), 0) == []
    conn.observe_research({"type": "research", "jobId": "u9:job", "status": "cancelled", "progress": 0, "candidates": []})
    assert conn.handle(utter("u10", "use the first one"), 0)[0]["command"]["operation"]["patch"] == candidates("u3:job")[0]["patch"]


def test_sound_search_needs_a_synth_track_and_a_backend(session):
    session["selected"] = {"trackId": "drums", "lane": "kick"}
    conn = Connection(research=FakePort())
    conn.handle({"type": "session", "session": session}, 0)
    out = conn.handle(utter("u1", "i want a warm pad"), 0)
    assert out[0]["type"] == "research" and out[0]["status"] == "failed" and "synth" in out[0]["error"]
    out = Connection().handle({"type": "sound-request", "id": "j", "trackId": "synth-1", "description": "pad"}, 0)
    assert out[0]["status"] == "failed"


def test_sound_talk_during_recording_needs_the_wake_word(session):
    port = FakePort()
    conn = Connection(research=port)
    conn.handle({"type": "session", "session": session}, 0)
    assert conn.handle(utter("u1", "i want a warm pad", recording=True), 0) == [] and port.started == []
    out = conn.handle(utter("u2", "groove i want a warm pad", recording=True), 0)
    assert [m["type"] for m in out] == ["command-span"] and port.started[0][1] == "warm pad"


# -- over the socket -----------------------------------------------------------------------

def test_sound_request_cancel_and_preview_over_websocket(monkeypatch):
    monkeypatch.setattr("groove_agent.app.research_service", ResearchService(backend(budget=16)))
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps(load_fixture("ClientMessage")))
        ws.send_text(json.dumps({"type": "sound-request", "id": "job-a", "trackId": "synth-1",
                                 "description": "80s electric piano"}))
        messages = []
        while not messages or messages[-1]["status"] == "running":
            messages.append(json.loads(ws.receive_text()))
            validate("ServerMessage", messages[-1])
        assert messages[-1]["status"] == "complete" and len(messages[-1]["candidates"]) == 5
        url = messages[-1]["candidates"][0]["previewUrl"]
        path = url.removeprefix("http://127.0.0.1:8000")
        response = client.get(path, headers={"origin": "http://localhost:5173"})
        assert response.status_code == 200 and response.content[:4] == b"RIFF"
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert "access-control-allow-origin" not in client.get(path, headers={"origin": "https://example.com"}).headers
        assert client.get("/previews/unknown.wav").status_code == 404

        ws.send_text(json.dumps({"type": "utterance", "id": "u1", "text": "accept", "clockId": "c", "startFrame": 0,
                                 "endFrame": 1, "duringRecording": False}))
        command = json.loads(ws.receive_text())["command"]
        assert command["operation"]["type"] == "apply-patch" and command["operation"]["trackId"] == "synth-1"
        assert command["operation"]["patch"] == messages[-1]["candidates"][0]["patch"]

        ws.send_text(json.dumps({"type": "cancel-job", "jobId": "job-a"}))
        assert json.loads(ws.receive_text())["type"] == "error"  # already finished


def test_default_service_has_no_research_backend():
    client = TestClient(app)
    assert client.get("/healthz").json()["research"] == "not configured"
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps(load_fixture("ClientMessage")))
        ws.send_text(json.dumps({"type": "sound-request", "id": "j1", "trackId": "synth-1", "description": "pad"}))
        reply = json.loads(ws.receive_text())
        assert reply["status"] == "failed" and reply["candidates"] == [] and "not configured" in reply["error"]


def test_cached_corpus_candidates_have_real_previews_after_restart(tmp_path):
    b = backend(budget=0)
    original = Corpus.build(b.space, b.renderer, b.embedder, DEFAULT_RECIPE)
    original.save(tmp_path)
    b.corpus = Corpus.load(tmp_path)
    assert all(entry.audio is None for entry in b.corpus.entries)
    service = ResearchService(b)
    messages = []
    port = service.port(messages.append)
    port.start('cached', 'electric piano')
    port.join(5)
    assert messages[-1]['status'] == 'complete', messages[-1].get('error')
    assert len(messages[-1]['candidates']) == 5
    for candidate in messages[-1]['candidates']:
        assert candidate['previewUrl']
        token = candidate['previewUrl'].rsplit('/', 1)[1][:-4]
        assert service.preview(token)[:4] == b'RIFF'
