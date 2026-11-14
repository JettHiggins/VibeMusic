"""Per-connection orchestration, written without I/O so it can be tested deterministically.

One `Connection` exists per WebSocket. It mirrors the browser's latest session
and transport snapshots, turns utterances into SessionCommand proposals, and
tracks acknowledgments. It holds no state across connections: after a
reconnect the browser sends fresh snapshots and nothing issued before the
disconnect is replayed (docs/CONTRACTS.md, "WebSocket and speech").

The browser stays authoritative. This class never edits the mirrored session;
it only reads the revision to fill `expectedRevision`.
"""
from __future__ import annotations

from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Any, Callable, Deque, Mapping, Optional

from .intents import Command, Ignored, Interpretation, NotUnderstood, interpret, validate_operation

Interpreter = Callable[[str, Mapping[str, Any], bool], Interpretation]

DEFAULT_ACK_TIMEOUT_S = 60.0  # longer than the slowest loop (4 bars at 40 BPM = 24 s) plus count-in
MAX_BACKLOG = 8
REMEMBERED_UTTERANCES = 256


@dataclass
class _Proposal:
    utterance_id: str
    operation: dict
    boundary: str


@dataclass
class _InFlight:
    proposal: _Proposal
    command_id: str
    sent_at: float
    status: str = "sent"  # sent -> queued -> (removed on applied/rejected)


def _error(request_id: str, message: str) -> dict:
    return {"type": "error", "requestId": request_id, "message": message}


class Connection:
    def __init__(self, interpreter: Interpreter = interpret, ack_timeout_s: float = DEFAULT_ACK_TIMEOUT_S) -> None:
        self._interpret = interpreter
        self._ack_timeout_s = ack_timeout_s
        self.session: Optional[dict] = None
        self.transport: Optional[dict] = None
        self.revision: Optional[int] = None
        self._in_flight: "OrderedDict[str, _InFlight]" = OrderedDict()
        self._backlog: Deque[_Proposal] = deque()
        self._utterances: "OrderedDict[str, None]" = OrderedDict()

    # -- inbound -----------------------------------------------------------------

    def handle(self, message: Mapping[str, Any], now: float) -> list[dict]:
        """Process one validated ClientMessage and return ServerMessages to send, in order."""
        kind = message["type"]
        if kind == "session":
            self.session = dict(message["session"])
            self.revision = self.session["revision"]
            return self._drain(now)
        if kind == "transport":
            self.transport = dict(message["transport"])
            return []
        if kind == "ack":
            return self._on_ack(message, now)
        if kind == "utterance":
            return self._on_utterance(message, now)
        if kind == "sound-request":
            return [{"type": "research", "jobId": message["id"], "status": "failed", "progress": 0, "candidates": [],
                     "error": "sound research is not available in this build"}]
        if kind == "cancel-job":
            return [_error(message["jobId"], "no such research job")]
        return [_error("unknown", f"unsupported message type {kind!r}")]

    def tick(self, now: float) -> list[dict]:
        """Expire commands the browser never resolved, so later commands are not blocked forever."""
        out: list[dict] = []
        for command_id, flight in list(self._in_flight.items()):
            if now - flight.sent_at >= self._ack_timeout_s:
                del self._in_flight[command_id]
                out.append(_error(flight.proposal.utterance_id,
                                  f"no final acknowledgment for {flight.proposal.operation['type']}; giving up on it"))
        if out:
            out.extend(self._drain(now))
        return out

    @property
    def pending_command_ids(self) -> list[str]:
        return list(self._in_flight)

    # -- utterances --------------------------------------------------------------

    def _on_utterance(self, message: Mapping[str, Any], now: float) -> list[dict]:
        utterance_id = message["id"]
        if utterance_id in self._utterances:
            return []  # already handled; never issue a second command for the same utterance
        self._utterances[utterance_id] = None
        while len(self._utterances) > REMEMBERED_UTTERANCES:
            self._utterances.popitem(last=False)

        if self.session is None:
            return [_error(utterance_id, "no session snapshot received yet")]
        if message["endFrame"] < message["startFrame"]:
            return [_error(utterance_id, "utterance ends before it starts")]
        if self.transport is not None and message["clockId"] != self.transport["clockId"]:
            return [_error(utterance_id, "utterance clock does not match the current audio clock")]

        during_recording = bool(message["duringRecording"])
        result = self._interpret(message["text"], self.session, during_recording)
        if isinstance(result, Ignored):
            return []
        if isinstance(result, NotUnderstood):
            return [_error(utterance_id, result.reason)]
        assert isinstance(result, Command)
        problem = validate_operation(result.operation)
        if problem is not None:
            return [_error(utterance_id, problem)]

        out: list[dict] = []
        if during_recording:
            # Sent before the command so the browser can exclude the span from
            # provisional musical events even if the command itself has to wait.
            out.append({"type": "command-span", "utteranceId": utterance_id, "clockId": message["clockId"],
                        "startFrame": message["startFrame"], "endFrame": message["endFrame"]})
        proposal = _Proposal(utterance_id, result.operation, result.boundary)
        if proposal.boundary == "next-loop" and self._next_loop_in_flight():
            if len(self._backlog) >= MAX_BACKLOG:
                out.append(_error(utterance_id, "too many commands are waiting; try again after the next loop"))
            else:
                self._backlog.append(proposal)
        else:
            out.append(self._issue(proposal, now))
        return out

    # -- commands ----------------------------------------------------------------

    def _next_loop_in_flight(self) -> bool:
        return any(flight.proposal.boundary == "next-loop" for flight in self._in_flight.values())

    def _issue(self, proposal: _Proposal, now: float) -> dict:
        # Derived from the utterance so a repeated delivery maps to the same command ID,
        # which the browser answers with its previous acknowledgment instead of applying twice.
        command_id = f"{proposal.utterance_id}:cmd"
        self._in_flight[command_id] = _InFlight(proposal, command_id, now)
        return {"type": "command", "command": {"id": command_id, "expectedRevision": self.revision,
                                               "boundary": proposal.boundary, "operation": proposal.operation}}

    def _drain(self, now: float) -> list[dict]:
        """Issue the next waiting next-loop command once the previous one has resolved.

        Next-loop commands are issued one at a time: the browser rechecks
        `expectedRevision` when a queued command is applied, so two issued
        against the same revision would make the second one stale.
        """
        if self._backlog and self.session is not None and not self._next_loop_in_flight():
            return [self._issue(self._backlog.popleft(), now)]
        return []

    def _on_ack(self, message: Mapping[str, Any], now: float) -> list[dict]:
        self.revision = message["revision"] if self.revision is None else max(self.revision, message["revision"])
        flight = self._in_flight.get(message["commandId"])
        if flight is None:
            return []  # late or repeated acknowledgment
        status = message["status"]
        if status == "queued":
            flight.status = "queued"
            return []
        del self._in_flight[message["commandId"]]
        out: list[dict] = []
        if status == "rejected":
            reason = message.get("reason") or "no reason given"
            out.append(_error(flight.proposal.utterance_id,
                              f"{flight.proposal.operation['type']} was rejected: {reason}"))
        out.extend(self._drain(now))
        return out
