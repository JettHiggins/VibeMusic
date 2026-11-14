"""Issue #3 section 5, as answered by WS1 in docs/STATUS.md ("Issue #3 contract answers").

(c) and (e) are covered in test_connection.py (PR #16); (d) in the speech pipeline tests
(PR #15) and test_connection.py once #15 merges. This file covers (a) and (b).
"""
from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture, validate
from groove_agent.research.service import ResearchService
from research_fixtures import backend
from test_research import FakePort, candidates, utter

RESEARCH_KEYS = {"type", "jobId", "status", "progress", "candidates"}


def session():
    state = load_fixture("SessionState")
    state["selected"] = {"trackId": "synth-2"}
    return state


def test_a_research_messages_keep_the_current_wire_shape():
    # Keep the shape until a focused additive metadata proposal is reviewed: no trackId/description.
    messages = []
    port = ResearchService(backend(budget=8)).port(messages.append)
    port.start("job-1", "electric piano")
    port.join()
    assert [m["status"] for m in messages][-1] == "complete"
    for message in messages:
        validate("ServerMessage", message)
        assert set(message) - {"error"} == RESEARCH_KEYS
    bad = dict(messages[-1], trackId="synth-1")
    try:
        validate("ServerMessage", bad)
    except ValueError:
        pass
    else:
        raise AssertionError("research messages must not grow fields before a reviewed proposal")


def test_b_audition_is_preview_only_accept_applies_and_undo_restores():
    conn = Connection(research=FakePort())
    conn.handle({"type": "session", "session": session()}, 0)
    conn.handle(utter("u1", "make it sound like a glassy bell"), 0)
    # Candidates arrive and are auditioned through previewUrl: nothing is proposed.
    assert conn.observe_research({"type": "research", "jobId": "u1:job", "status": "complete", "progress": 1,
                                  "candidates": candidates("u1:job")}) is None
    assert conn.pending_command_ids == []
    accept = conn.handle(utter("u2", "use number two"), 0)[0]["command"]
    assert accept["operation"]["type"] == "apply-patch" and accept["boundary"] == "next-loop"
    conn.handle({"type": "ack", "commandId": accept["id"], "status": "applied", "revision": 1}, 0)
    undo = conn.handle(utter("u3", "undo"), 0)[0]["command"]
    assert undo["operation"] == {"type": "undo"} and undo["boundary"] == "immediate"
    assert undo["expectedRevision"] == 1  # restores the accepted state's predecessor, by revision
