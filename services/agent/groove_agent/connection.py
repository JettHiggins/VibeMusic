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
from typing import Any, Callable, Deque, Mapping, Optional, Protocol, Sequence, Union

from .intents import (MELODIC_TRACKS, AcceptCandidate, CancelSearch, Command, Ignored, Interpretation, NotUnderstood,
                      SoundSearch, interpret, validate_operation)
from .speech import ChunkError, StreamTracker, decode_chunk
from .speech_pipeline import EnergySegmenter, Transcriber

Interpreter = Callable[[str, Mapping[str, Any], bool], Interpretation]

DEFAULT_ACK_TIMEOUT_S = 60.0  # longer than the slowest loop (4 bars at 40 BPM = 24 s) plus count-in
MAX_BACKLOG = 8
REMEMBERED_UTTERANCES = 256
# No recognizer is wired yet (STT provider decision pending). Until one is, speech-audio
# is validated and dropped, and speech-verified is never sent: nothing was classified.
SPEECH_UNAVAILABLE = {"type": "speech-status", "available": False, "provider": "none",
                      "reason": "no speech recognizer configured; speech-verified is not sent"}


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


class ResearchPort(Protocol):
    """Starts and cancels research jobs; results come back through `Connection.observe_research`."""

    def start(self, job_id: str, description: str, seeds: Optional[Sequence[dict]] = None) -> None: ...

    def cancel(self, job_id: str) -> bool: ...


@dataclass
class _Search:
    job_id: str
    track_id: str
    description: str
    status: str = "running"
    candidates: Sequence[dict] = ()


def _error(request_id: str, message: str) -> dict:
    return {"type": "error", "requestId": request_id, "message": message}


class Connection:
    def __init__(self, interpreter: Interpreter = interpret, ack_timeout_s: float = DEFAULT_ACK_TIMEOUT_S,
                 research: Optional[ResearchPort] = None, transcriber: Optional[Transcriber] = None) -> None:
        self._transcriber = transcriber
        self._segmenters: dict[str, EnergySegmenter] = {}
        self._verified: dict[str, int] = {}
        self._segment_count = 0
        self._interpret = interpreter
        self._research = research
        self._searches: "OrderedDict[str, _Search]" = OrderedDict()
        self._ack_timeout_s = ack_timeout_s
        self.session: Optional[dict] = None
        self.transport: Optional[dict] = None
        self.revision: Optional[int] = None
        self._in_flight: "OrderedDict[str, _InFlight]" = OrderedDict()
        self._backlog: Deque[_Proposal] = deque()
        self._utterances: "OrderedDict[str, None]" = OrderedDict()
        self._speech_streams = StreamTracker()

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
            return self._start_search(message["id"], message["trackId"], message["description"], None)
        if kind == "speech-audio":
            return self._on_speech_audio(message, now)
        if kind == "cancel-job":
            if self._research is not None and self._research.cancel(message["jobId"]):
                return []  # the job answers with status "cancelled"
            return [_error(message["jobId"], "no such running research job")]
        return [_error("unknown", f"unsupported message type {kind!r}")]

    def _on_speech_audio(self, message: Mapping[str, Any], now: float) -> list[dict]:
        """Check one chunk; without a transcriber drop it, otherwise segment, transcribe and verify.

        Ordering per closed segment: its command-span/command (if any) first, then
        speech-verified. The watermark never passes an open segment or unreceived audio.
        """
        stream_id = message["streamId"]
        if self._speech_streams.is_broken(stream_id):
            return []
        transport = self.transport
        try:
            if transport is None or transport["clockId"] != message["clockId"]:
                raise ChunkError("clockId does not match the latest transport snapshot")
            chunk = decode_chunk(message, transport["sampleRate"])
            first = self._speech_streams.accept(chunk)
        except ChunkError as error:
            self._speech_streams.mark_broken(stream_id)
            self._segmenters.pop(stream_id, None)
            return [_error(stream_id, f"speech-audio rejected: {error}; send a new streamId")]
        out: list[dict] = []
        if first:
            out.append(dict(SPEECH_UNAVAILABLE) if self._transcriber is None else
                       {"type": "speech-status", "available": True, "provider": self._transcriber.name})
        if self._transcriber is None:
            return out
        segmenter = self._segmenters.get(stream_id)
        if segmenter is None:
            segmenter = self._segmenters[stream_id] = EnergySegmenter(chunk.sample_rate)
            while len(self._segmenters) > 16:
                self._segmenters.pop(next(iter(self._segmenters)))
        for segment in segmenter.feed(chunk):
            text = self._transcriber.transcribe(segment.samples, segment.sample_rate).strip()
            if not text:
                continue
            self._segment_count += 1
            out.extend(self._on_utterance({
                "type": "utterance", "id": f"{stream_id}:speech-{self._segment_count}", "text": text,
                "clockId": chunk.clock_id, "startFrame": segment.start_frame, "endFrame": segment.last_frame,
                "duringRecording": self._recording_at(segment.start_frame)}, now))
        watermark = segmenter.decided_through
        if watermark > self._verified.get(stream_id, -1):
            self._verified[stream_id] = watermark
            out.append({"type": "speech-verified", "clockId": chunk.clock_id, "throughFrame": watermark})
        return out

    def _recording_at(self, frame: int) -> bool:
        """Whether a take was capturing at `frame`, from the browser's latest transport snapshot."""
        transport = self.transport or {}
        state = transport.get("recordingState")
        active = state == "recording" if state is not None else bool(transport.get("recording"))
        start = transport.get("recordingStartFrame")
        return active and (start is None or frame >= start)

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

    # -- research ----------------------------------------------------------------

    def observe_research(self, message: Mapping[str, Any]) -> None:
        """Record a research message on its way to the browser, so spoken accept/refine can refer to it."""
        search = self._searches.get(message["jobId"])
        if search is not None:
            search.status = message["status"]
            if message["candidates"] or message["status"] != "cancelled":
                search.candidates = message["candidates"]

    def _latest_search(self, with_candidates: bool = False) -> Optional[_Search]:
        """Newest search; with_candidates skips ones that ended (or were cancelled) before producing any."""
        for search in reversed(self._searches.values()):
            if search.candidates or not with_candidates:
                return search
        return None

    def _start_search(self, job_id: str, track_id: str, description: str, seeds: Optional[Sequence[dict]]) -> list[dict]:
        def failed(reason: str) -> list[dict]:
            return [{"type": "research", "jobId": job_id, "status": "failed", "progress": 0, "candidates": [],
                     "error": reason}]
        if job_id in self._searches:
            return []
        if track_id not in MELODIC_TRACKS:
            return failed("sound search works on the three synth tracks; select one first")
        if self._research is None:
            return failed("sound research is not available in this build")
        self._searches[job_id] = _Search(job_id, track_id, description)
        while len(self._searches) > 16:
            self._searches.popitem(last=False)
        self._research.start(job_id, description, seeds)
        return []

    def _on_sound_intent(self, utterance_id: str, result: Interpretation) -> Union[list, _Proposal]:
        if isinstance(result, CancelSearch):
            running = self._latest_search()
            if (running is None or running.status != "running" or self._research is None
                    or not self._research.cancel(running.job_id)):
                return [_error(utterance_id, "no sound search is running")]
            return []
        latest = self._latest_search(with_candidates=True)
        if isinstance(result, AcceptCandidate):
            if latest is None or not latest.candidates:
                return [_error(utterance_id, "there are no sound candidates to accept yet")]
            if result.index > len(latest.candidates):
                return [_error(utterance_id, f"there are only {len(latest.candidates)} candidates")]
            patch = latest.candidates[result.index - 1]["patch"]
            return _Proposal(utterance_id, {"type": "apply-patch", "trackId": latest.track_id, "patch": patch}, "next-loop")
        assert isinstance(result, SoundSearch)
        if result.refine:
            if latest is None or not latest.candidates:
                return [_error(utterance_id, "describe a sound first, for example: make it sound like an electric piano")]
            return self._start_search(f"{utterance_id}:job", latest.track_id, f"{latest.description}, {result.description}",
                                      [candidate["patch"] for candidate in latest.candidates])
        return self._start_search(f"{utterance_id}:job", self.session["selected"]["trackId"], result.description, None)

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
        if isinstance(result, Command):
            problem = validate_operation(result.operation)
            if problem is not None:
                return [_error(utterance_id, problem)]
            proposal: Optional[_Proposal] = _Proposal(utterance_id, result.operation, result.boundary)
        else:
            outcome = self._on_sound_intent(utterance_id, result)
            if isinstance(outcome, _Proposal):
                proposal = outcome
            elif outcome:
                return outcome  # refused, so not a recognized command: no span
            else:
                proposal = None

        out: list[dict] = []
        if during_recording:
            # Sent before the command so the browser can exclude the span from
            # provisional musical events even if the command itself has to wait.
            out.append({"type": "command-span", "utteranceId": utterance_id, "clockId": message["clockId"],
                        "startFrame": message["startFrame"], "endFrame": message["endFrame"]})
        if proposal is None:
            return out
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
