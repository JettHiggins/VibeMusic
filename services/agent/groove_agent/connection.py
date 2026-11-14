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

import re
from collections import OrderedDict, deque
from copy import deepcopy
import json
from dataclasses import dataclass
from typing import Any, Callable, Deque, Mapping, Optional, Protocol, Sequence, Union

from .intents import (BOUNDARY, MELODIC_TRACKS, WAKE_WORDS, AcceptCandidate, CancelSearch, Command, Ignored, Interpretation,
                      NotUnderstood, SoundSearch, interpret, tokenize, validate_operation)
from .speech import ChunkError, StreamTracker, decode_chunk
from .speech_pipeline import EnergySegmenter, SpeechJob, SpeechWorker
from .language import LanguageJob
from .contracts import ContractError, validate


from .speech_pipeline import Transcript
from .speech_alignment import locate_command

Interpreter = Callable[..., Interpretation]  # (text, session, during_recording, take_armed=False)

DEFAULT_ACK_TIMEOUT_S = 60.0  # longer than the slowest loop (4 bars at 40 BPM = 24 s) plus count-in
MAX_BACKLOG = 8
REMEMBERED_UTTERANCES = 256
# People pause after the wake word ("Groove, ... stop"); segmentation then splits it off.
# A segment that is only the wake word waits this long for the command that follows it.
WAKE_JOIN_SECONDS = 2.0
# Without a configured recognizer, speech-audio is validated and dropped and speech-verified is
# never sent: nothing was classified.
SPEECH_UNAVAILABLE = {"type": "speech-status", "available": False, "provider": "none",
                      "reason": "no speech recognizer configured; speech-verified is not sent; hold speech-dependent commits"}


@dataclass
class _Window:
    """A count-in ("armed") or take ("recording") on the capture clock, from transport snapshots."""
    kind: str
    start: int
    end: Optional[int] = None  # first frame known to be outside it; None while still current


MAX_WINDOWS = 32


@dataclass
class _SpeechStream:
    segmenter: EnergySegmenter
    pending: "Deque[SpeechJob]"
    verified: int = -1
    failed: bool = False
    held_wake: Optional[tuple] = None  # (job, text): a bare wake word waiting for its command


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


_WAKE_SPLIT = re.compile(r"(?<=\S)\s+(?=(?:%s)\b)" % "|".join(sorted(WAKE_WORDS)), re.IGNORECASE)


def split_commands(text: str) -> list[str]:
    """One segment can hold several commands when the pause between them is short:
    "Groove, record kick. Groove, stop." -> ["Groove, record kick.", "Groove, stop."]"""
    return [piece.strip() for piece in _WAKE_SPLIT.split(text) if piece.strip()]


def _bare_wake(text: str) -> bool:
    """The transcript is only the wake word ("Groove." / "Grove"), with nothing after it."""
    tokens = tokenize(text)
    return len(tokens) == 1 and tokens[0] in WAKE_WORDS


def _error(request_id: str, message: str) -> dict:
    return {"type": "error", "requestId": request_id, "message": message}


class Connection:
    def __init__(self, interpreter: Interpreter = interpret, ack_timeout_s: float = DEFAULT_ACK_TIMEOUT_S,
                 research: Optional[ResearchPort] = None, speech: Optional[SpeechWorker] = None, language=None) -> None:
        self._language = language
        self._language_pending: dict[str, tuple] = {}
        self._language_epoch = 0
        self._speech = speech
        self._speech_state: "OrderedDict[str, _SpeechStream]" = OrderedDict()
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
        self._windows: list[_Window] = []

    # -- inbound -----------------------------------------------------------------

    def handle(self, message: Mapping[str, Any], now: float) -> list[dict]:
        """Process one validated ClientMessage and return ServerMessages to send, in order."""
        kind = message["type"]
        if kind == "session":
            self.session = dict(message["session"])
            self.revision = self.session["revision"]
            return self._drain(now)
        if kind == "transport":
            before = self._capture_signature()
            self._observe_windows(message["transport"])
            self.transport = dict(message["transport"])
            if self._capture_signature() != before:
                self._language_epoch += 1
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
            self._speech_state.pop(stream_id, None)
            return [_error(stream_id, f"speech-audio rejected: {error}; send a new streamId")]
        if first:
            status = ({**SPEECH_UNAVAILABLE, "streamId": stream_id} if self._speech is None else
                      {"type": "speech-status", "streamId": stream_id, "available": True, "provider": self._speech.name})
            out = [status]
        else:
            out = []
        if self._speech is None:
            return out
        state = self._speech_state.get(stream_id)
        if state is None:
            state = self._speech_state[stream_id] = _SpeechStream(EnergySegmenter(chunk.sample_rate), deque())
            while len(self._speech_state) > 16:
                self._speech_state.popitem(last=False)
        if state.failed:
            return out
        for segment in state.segmenter.feed(chunk):
            self._segment_count += 1
            job = SpeechJob(f"{stream_id}:speech-{self._segment_count}", stream_id, chunk.clock_id, segment)
            state.pending.append(job)
            self._speech.submit(job)  # transcribed off the event loop; see speech_result
        out.extend(self._advance_speech(stream_id, chunk.clock_id, now))
        return out

    def speech_result(self, job: SpeechJob, text: Optional[str | Transcript], error: Optional[str], now: float) -> list[dict]:
        """A transcript (or failure) for one segment, delivered on the event loop by the service.

        Order: the segment's command-span and command/error first, then any watermark it
        releases. A failure stops coverage for that stream and reports it unavailable.
        """
        state = self._speech_state.get(job.stream_id)
        if state is None or state.failed or job not in state.pending:
            return []
        state.pending.remove(job)
        if error is not None:
            state.failed = True
            state.pending.clear()
            return [_error(job.stream_id, f"speech recognition failed: {error}"),
                    {"type": "speech-status", "streamId": job.stream_id, "available": False,
                     "provider": self._speech.name if self._speech else "none",
                     "reason": "recognition failed; speech-verified stopped for this stream; hold speech-dependent commits"}]
        out: list[dict] = []
        job, text = locate_command(job, text or "", state.segmenter.decided_through)
        held = state.held_wake
        if held is not None and text:
            state.held_wake = None
            wake_job, wake_text = held
            if job.segment.start_frame - wake_job.segment.last_frame <= self._wake_join_frames():
                out.extend(self._speech_utterance(wake_job, f"{wake_text} {text}", now, end=job.segment.last_frame))
                text = ""
            else:
                out.extend(self._speech_utterance(wake_job, wake_text, now))
        if text:
            if _bare_wake(text):
                state.held_wake = (job, text)
            else:
                out.extend(self._speech_utterance(job, text, now))
        out.extend(self._advance_speech(job.stream_id, job.clock_id, now))
        return out

    def _speech_utterance(self, job: SpeechJob, text: str, now: float, end: Optional[int] = None) -> list[dict]:
        """Ordered commands share one measured span; capture context follows the aligned wake."""
        segment = job.segment
        context_start = job.context_start_frame if job.context_start_frame is not None else segment.start_frame
        window = self._window_at(context_start)
        out: list[dict] = []
        for index, command in enumerate(split_commands(text)):
            out.extend(self._on_utterance({
                "type": "utterance", "id": job.job_id if index == 0 else f"{job.job_id}:{index}", "text": command,
                "clockId": job.clock_id, "startFrame": segment.start_frame,
                "endFrame": segment.last_frame if end is None else end,
                "duringRecording": window is not None and window.kind == "recording"}, now,
                take_armed=(window is not None and window.kind == "armed") or (index > 0 and self._take_armed()),
                obsolete=self._obsolete(window),
                emit_span=not any(m["type"] == "command-span" for m in out)))
        return out

    def _wake_join_frames(self) -> int:
        return round(WAKE_JOIN_SECONDS * (self.transport or {}).get("sampleRate", 44100))

    def _advance_speech(self, stream_id: str, clock_id: str, now: float) -> list[dict]:
        """speech-verified for one stream: never past an open, still-transcribing or held segment."""
        state = self._speech_state.get(stream_id)
        first_frame = self._speech_streams.first_frame(stream_id)
        if state is None or state.failed or first_frame is None:
            return []
        out: list[dict] = []
        decided = state.segmenter.decided_through
        if (state.held_wake is not None and not state.pending
                and decided >= state.held_wake[0].segment.last_frame + self._wake_join_frames()):
            wake_job, wake_text = state.held_wake  # no command followed: excluded, then not understood
            state.held_wake = None
            out.extend(self._speech_utterance(wake_job, wake_text, now))
        bound = decided
        if state.pending:
            bound = min(bound, state.pending[0].segment.start_frame - 1)
        if state.held_wake is not None:
            bound = min(bound, state.held_wake[0].segment.start_frame - 1)
        if bound < first_frame or bound <= state.verified:
            return out
        state.verified = bound
        return out + [{"type": "speech-verified", "clockId": clock_id, "streamId": stream_id,
                       "fromFrame": first_frame, "throughFrame": bound}]

    # -- capture-time recording context ----------------------------------------------------

    def _observe_windows(self, transport: Mapping[str, Any]) -> None:
        """Track count-ins and takes in capture-clock frames, so a transcript that arrives late is
        judged by what was happening when it was spoken, not when recognition finished."""
        if self.transport is not None and self.transport["clockId"] != transport["clockId"]:
            self._windows.clear()  # a new audio context: old frames mean nothing
        state = transport.get("recordingState") or ("recording" if transport.get("recording") else "idle")
        now_frame = transport["currentFrame"]
        last = self._windows[-1] if self._windows else None
        current = last if last is not None and last.end is None else None
        if state == "recording":
            start = transport.get("recordingStartFrame", now_frame)
            if current is not None and current.kind == "recording" and current.start == start:
                return  # the same take (Clear/Undo epochs do not start a new take)
            if current is not None:
                current.end = start if current.kind == "armed" else now_frame
            self._windows.append(_Window("recording", start))
        elif state == "armed":
            if current is not None and current.kind == "armed":
                return
            if current is not None:
                current.end = now_frame
            self._windows.append(_Window("armed", now_frame))
        elif current is not None:
            current.end = now_frame
        del self._windows[:-MAX_WINDOWS]

    def _window_at(self, frame: int) -> Optional[_Window]:
        for window in reversed(self._windows):
            if window.start <= frame and (window.end is None or frame < window.end):
                return window
        return None

    def _obsolete(self, window: Optional[_Window]) -> bool:
        """Spoken in a take or count-in that is no longer current. A count-in that became its own
        take is still current, so "stop recording" said during the count-in still stops it."""
        if window is None or window.end is None:
            return False
        later = self._windows[self._windows.index(window) + 1:]
        return not (window.kind == "armed" and len(later) == 1 and later[0].kind == "recording"
                    and later[0].start == window.end and later[0].end is None)

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
        self._language_epoch += 1
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
            self._language_epoch += 1
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

    def _on_utterance(self, message: Mapping[str, Any], now: float, take_armed: Optional[bool] = None,
                      obsolete: bool = False, emit_span: bool = True) -> list[dict]:
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
        armed = self._take_armed() if take_armed is None else take_armed
        result = self._interpret(message["text"], self.session, during_recording, take_armed=armed)
        if isinstance(result, Ignored):
            return []  # performance, not speech addressed to Groove
        # During recording, anything not Ignored began with the wake word. Its span is excluded
        # from the take even when the command is not understood or is refused (Issue #3 d), and
        # it is sent first so the browser can exclude it before any command or watermark.
        out: list[dict] = []
        if during_recording and emit_span:
            out.append({"type": "command-span", "utteranceId": utterance_id, "clockId": message["clockId"],
                        "startFrame": message["startFrame"], "endFrame": message["endFrame"]})
        if obsolete:
            # Recognized after its take or count-in ended (or a newer one began): never act on the
            # current transport or a newer take with it. Its span was still excluded above.
            return out + [_error(utterance_id, "spoken during a take or count-in that has already ended; not applied")]
        if isinstance(result, NotUnderstood):
            # Familiar commands and explicit parser refusals never wait on a provider. Only
            # unknown addressed speech takes the optional bounded async interpretation path.
            if self._language is not None and result.reason == "command not recognized":
                if len(self._language_pending) >= 5:
                    return out + [_error(utterance_id, "language queue is full; try again shortly")]
                latest = self._latest_search(with_candidates=True)
                research = ({"jobId": latest.job_id, "trackId": latest.track_id, "description": latest.description,
                             "status": latest.status, "candidates": [
                                 {"index": i + 1, "id": item["id"], "provenance": item.get("provenance", "")}
                                 for i, item in enumerate(latest.candidates[:5])]} if latest else {})
                job = LanguageJob(utterance_id, message["text"], deepcopy(self.session), during_recording, armed, research)
                self._language_pending[utterance_id] = (job, self._language_token())
                if not self._language.submit(job):
                    del self._language_pending[utterance_id]
                    return out + [_error(utterance_id, "language queue is full; try again shortly")]
                return out  # wake span is already excluded; coverage need not wait for inference
            return out + [_error(utterance_id, result.reason)]
        return out + self._apply_interpretation(utterance_id, result, now)

    def _capture_signature(self) -> tuple:
        transport = self.transport or {}
        return (transport.get("clockId"), transport.get("recordingState", "recording" if transport.get("recording") else "idle"),
                transport.get("recordingStartFrame"), transport.get("recordingEpoch"), transport.get("captureStartFrame"),
                transport.get("playing"), tuple(sorted((transport.get("recordingTarget") or {}).items())),
                tuple(sorted((transport.get("armedTarget") or {}).items())))

    def _language_token(self) -> tuple:
        latest = self._latest_search(with_candidates=True)
        candidates = tuple((item["id"], json.dumps(item["patch"], sort_keys=True)) for item in latest.candidates) if latest else ()
        return (self._language_epoch, self.revision, self._capture_signature(),
                latest.job_id if latest else None, candidates)

    def language_result(self, job: LanguageJob, result: Optional[Interpretation], error: Optional[str], now: float) -> list[dict]:
        pending = self._language_pending.pop(job.request_id, None)
        if pending is None or pending[0] is not job:
            return []
        if pending[1] != self._language_token():
            return [_error(job.request_id, "session or take changed while interpreting; no change applied")]
        if error is not None:
            return [_error(job.request_id, error)]
        if result is None or isinstance(result, (Ignored, NotUnderstood)):
            return [_error(job.request_id, "language agent could not resolve the request; no change applied")]
        if not isinstance(result, (Command, SoundSearch, AcceptCandidate, CancelSearch)):
            return [_error(job.request_id, "invalid language proposal; no change applied")]
        if isinstance(result, AcceptCandidate) and (type(result.index) is not int or not 1 <= result.index <= 5):
            return [_error(job.request_id, "invalid candidate index; no change applied")]
        if isinstance(result, SoundSearch) and (not isinstance(result.description, str)
                                               or not 0 < len(result.description.strip()) <= 500):
            return [_error(job.request_id, "invalid sound request; no change applied")]
        return self._apply_interpretation(job.request_id, result, now)

    def _apply_interpretation(self, utterance_id: str, result: Interpretation, now: float) -> list[dict]:
        out: list[dict] = []
        if isinstance(result, Command):
            try:
                validate("SessionCommand", {"id": utterance_id, "expectedRevision": self.revision,
                                             "boundary": result.boundary, "operation": result.operation})
            except ContractError:
                return [_error(utterance_id, "invalid command proposal; no change applied")]
            if result.boundary != BOUNDARY.get(result.operation["type"]):
                return [_error(utterance_id, "invalid command scheduling boundary; no change applied")]
            problem = validate_operation(result.operation)
            if problem is not None:
                return out + [_error(utterance_id, problem)]
            proposal: Optional[_Proposal] = _Proposal(utterance_id, result.operation, result.boundary)
        else:
            outcome = self._on_sound_intent(utterance_id, result)
            if isinstance(outcome, _Proposal):
                proposal = outcome
            elif outcome:
                return out + outcome  # refused: still excluded, no mutation
            else:
                proposal = None

        if proposal is None:
            return out
        if proposal.boundary == "next-loop" and self._queued_in_flight():
            if len(self._backlog) >= MAX_BACKLOG:
                out.append(_error(utterance_id, "too many commands are waiting; try again after the next loop"))
            else:
                self._backlog.append(proposal)
        else:
            out.append(self._issue(proposal, now))
        return out

    # -- commands ----------------------------------------------------------------

    def _take_armed(self) -> bool:
        """A Record is counting in: the transport says armed, or our Record is not yet resolved."""
        if (self.transport or {}).get("recordingState") == "armed":
            return True
        return any(flight.proposal.operation["type"] == "record" for flight in self._in_flight.values())

    def _queued_in_flight(self) -> bool:
        """A boundary-scheduled command (next-loop, or a next-beat Record) is still unresolved.

        A next-beat Record checks expectedRevision on receipt and stays pinned once armed
        (RECORDING-USABILITY.md), so it is issued without waiting. Its application can still
        change the revision, so a next-loop command waits behind it like behind another
        next-loop command. Immediate commands are never held back.
        """
        return any(flight.proposal.boundary in ("next-loop", "next-beat") for flight in self._in_flight.values())

    def _issue(self, proposal: _Proposal, now: float) -> dict:
        self._language_epoch += 1  # even discard-only Undo can invalidate a late interpretation
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
        if self._backlog and self.session is not None and not self._queued_in_flight():
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
