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
import secrets
from collections import OrderedDict, deque
from copy import deepcopy
import json
import os
import time
from dataclasses import dataclass, replace
from typing import Any, Callable, Deque, Mapping, Optional, Protocol, Sequence, Union

from .intents import (BOUNDARY, MELODIC_TRACKS, WAKE_WORDS, AcceptCandidate, AuditionCandidate, CancelSearch, Command, Ignored, Interpretation,
                      MusicTool, NotUnderstood, SoundSearch, interpret, tokenize, validate_operation)
from .music_tools import ToolRefusal, run_tool
from .control_phrases import InputAction
from .speech import ChunkError, StreamTracker, decode_chunk
from .speech_pipeline import EnergySegmenter, SpeechJob, SpeechWorker
from .speech_pipeline import Transcript
from .speech_alignment import SUNG_SYLLABLES, locate_command
from .preview import PreviewRequests
from .research.service import NOT_CONFIGURED
from .research.search import CANDIDATES

from .language import LanguageJob
from .contracts import ContractError, validate

Interpreter = Callable[..., Interpretation]  # (text, session, during_recording, take_armed=False)

DEFAULT_ACK_TIMEOUT_S = 60.0  # longer than the slowest loop (4 bars at 40 BPM = 24 s) plus count-in
MAX_BACKLOG = 8
REMEMBERED_UTTERANCES = 256
# People pause after the wake word ("Groove, ... stop"); segmentation then splits it off.
# A segment that is only the wake word waits this long for the command that follows it.
WAKE_JOIN_SECONDS = 2.0
# The same wait applies to an addressed sentence that is not yet a complete command ("Groove, set the
# tempo to <pause> one twenty"), to a segment the segmenter cut at its maximum length even when its
# prefix already parses, and to open-ended sound descriptions ("make it sound like a warm piano
# <pause> with a soft attack"): each is held for its continuation instead of executing, starting
# research or reaching the language model as a fragment. Stop commands never wait.
# Holding keeps speech-verified at the held sentence's start. The browser fails a stream whose
# coverage lags received audio by more than 8 s (SpeechSession SPEECH_STALL_SECONDS), so a hold is
# released once the audio received since the sentence began exceeds this budget, leaving margin for
# recognition of the following segment.
HOLD_LAG_BUDGET_SECONDS = 6.5
# Without a configured recognizer, speech-audio is validated and dropped and speech-verified is
# never sent: nothing was classified.
# Browser input actions (MUSICAL-CONTROL-CONTRACT.md): a request the browser never starts is given up
# quickly; a started calibration (warning, countdown, practice, measuring) may take a while.
BROWSER_ACTION_START_TIMEOUT_S = 15.0
BROWSER_ACTION_RUN_TIMEOUT_S = 180.0
_INPUT_ACTION_KIND = {"calibrate-input": "calibration", "cancel-input-action": "cancel",
                      "set-input-profile": "input profile change", "set-input-offset": "input offset change"}
SPEECH_UNAVAILABLE = {"type": "speech-status", "available": False, "provider": "none",
                      "reason": "no speech recognizer configured; speech-verified is not sent; hold speech-dependent commits"}


@dataclass
class _Window:
    """A count-in ("armed") or take ("recording") on the capture clock, from transport snapshots."""
    kind: str
    start: int
    end: Optional[int] = None  # first frame known to be outside it; None while still current
    target: Optional[dict] = None  # the take's recordingTarget, so a late "erase bar 2 beat 3" keeps it


MAX_WINDOWS = 32


@dataclass
class _SpeechStream:
    segmenter: EnergySegmenter
    pending: "Deque[SpeechJob]"
    verified: int = -1
    failed: bool = False
    held_wake: Optional[tuple] = None  # (job, text): a bare wake word or unfinished sentence waiting for the rest
    input_key: Optional[tuple] = None  # browser (clockId, inputRevision) when the stream began
    probing: Optional[SpeechJob] = None  # latest early-stop probe of the open segment
    # Last frame of a request refused at the hold budget. Speech continuing it (within the join
    # window, not a new "Groove ...") belongs to that refused request and is never acted on alone.
    refused_through: Optional[int] = None


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


@dataclass
class _BrowserRequest:
    utterance_id: str
    action: dict
    sent_at: float
    status: str = "sent"  # sent -> running -> (removed on a terminal acknowledgment)


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
    # Spoken searches load their best match ("find a disco synth and load it"); the other candidates
    # stay listed to swap. loaded_patch is what Groove last applied, so a later user choice is kept.
    auto_load: bool = False
    loaded_patch: Optional[str] = None
    load_stage: str = ""  # "" -> "retrieval" (first complete candidate list) -> "final" (job complete)


_WAKE_SPLIT = re.compile(r"(?<=\S)\s+(?=(?:%s)\b)" % "|".join(sorted(WAKE_WORDS)), re.IGNORECASE)


def split_commands(text: str) -> list[str]:
    """One segment can hold several commands when the pause between them is short:
    "Groove, record kick. Groove, stop." -> ["Groove, record kick.", "Groove, stop."]"""
    return [piece.strip() for piece in _WAKE_SPLIT.split(text) if piece.strip()]


def _addressed(text: str) -> bool:
    """The transcript starts with the wake word (after politeness words): "Groove, ..." / "Hey Grove ..."."""
    tokens = [t for t in tokenize(text) if t not in ("hey", "ok", "okay", "please", "so", "um", "uh")]
    return bool(tokens) and tokens[0] in WAKE_WORDS


def _bare_wake(text: str) -> bool:
    """The transcript is only the wake word ("Groove." / "Grove"), with nothing after it."""
    tokens = tokenize(text)
    return len(tokens) == 1 and tokens[0] in WAKE_WORDS


def _describe(message: Mapping[str, Any]) -> str:
    """Short human label for an issued action (transcript detail), without patches or note lists."""
    if message["type"] == "browser-action":
        operation = message["operation"]
    elif message["type"] == "candidate-preview":
        return "preview candidate"
    else:
        operation = message["command"]["operation"]
    shown = {k: v for k, v in operation.items() if k not in ("type", "patch", "notes", "hits", "session", "events")}
    values = " ".join(str(v if not isinstance(v, dict) else " ".join(str(x) for x in v.values())) for v in shown.values())
    return f"{operation['type']} {values}".strip()


def _error(request_id: str, message: str) -> dict:
    return {"type": "error", "requestId": request_id, "message": message}


class Connection:
    def __init__(self, interpreter: Interpreter = interpret, ack_timeout_s: float = DEFAULT_ACK_TIMEOUT_S,
                 research: Optional[ResearchPort] = None, speech: Optional[SpeechWorker] = None, language=None,
                 voice_research: bool = False) -> None:
        self._voice_research = voice_research
        # Spoken sound searches load their best match (GROOVE_AUTO_LOAD=0 lists candidates only).
        self.auto_load_sounds = os.environ.get("GROOVE_AUTO_LOAD", "1").strip() != "0"
        # Microphone speech must start with the wake word even outside a take (hands-free is on by default,
        # so conversation must not act). GROOVE_SPEECH_WAKE=take restores "only during takes".
        self.speech_requires_wake = os.environ.get("GROOVE_SPEECH_WAKE", "always").strip() != "take"
        self._closed = False
        self._previews = PreviewRequests()
        self._research_epoch = 0
        self._ui_research_cutoff: Optional[tuple[str, int]] = None
        self._received_capture: dict[str, int] = {}
        self._external_queued: "OrderedDict[str, float]" = OrderedDict()
        self._seen_searches: "OrderedDict[str, tuple]" = OrderedDict()
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
        # Latest browser-status (input executor capability/configuration) and our own pending
        # browser-action requests. IDs carry a per-connection nonce so they stay fresh across
        # reconnects (the browser keeps a per-page ID ledger).
        self.browser_status: Optional[dict] = None
        self._browser_requests: "OrderedDict[str, _BrowserRequest]" = OrderedDict()
        self._nonce = secrets.token_hex(4)

    # -- inbound -----------------------------------------------------------------

    def handle(self, message: Mapping[str, Any], now: float) -> list[dict]:
        """Process one validated ClientMessage and return ServerMessages to send, in order."""
        if self._closed:
            return []
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
        if kind == "preview-ack":
            return self._previews.acknowledge(dict(message), now) if self._voice_research else [_error(message["id"], "voice preview is not enabled")]
        if kind == "speech-audio":
            return self._on_speech_audio(message, now)
        if kind == "browser-status":
            return self._on_browser_status(message)
        if kind == "browser-action-ack":
            return self._on_browser_ack(message)
        if kind == "cancel-job":
            search = self._searches.get(message["jobId"])
            if search is not None and search.status == "cancelled":
                return []  # browser cleanup of an already-superseded voice context is idempotent
            if self._research is not None and self._research.cancel(message["jobId"]):
                current = search is not None and search is self._latest_search()
                if search is not None:
                    search.status = "cancelled"
                if current:
                    self._language_epoch += 1
                    self._mark_ui_research_intent()
                return self._previews.cancel("preview research job was cancelled", message["jobId"])
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
        self._received_capture[chunk.clock_id] = max(self._received_capture.get(chunk.clock_id, -1), chunk.last_frame)
        while len(self._received_capture) > 16:
            del self._received_capture[next(iter(self._received_capture))]
        state = self._speech_state.get(stream_id)
        if state is None:
            state = self._speech_state[stream_id] = _SpeechStream(EnergySegmenter(chunk.sample_rate), deque(),
                                                                  input_key=self._input_key())
            while len(self._speech_state) > 16:
                self._speech_state.popitem(last=False)
        if state.failed:
            return out
        segments = state.segmenter.feed(chunk)
        probes, state.segmenter.probes = state.segmenter.probes, []
        if segments:
            state.probing = None  # the closed segment's own transcript decides
        elif (probes and getattr(self._speech, "supports_probe", False) and state.held_wake is None
              and state.probing is None):  # at most one probe in flight: no recognizer backlog
            window = self._window_at(probes[-1].start_frame)
            if window is not None and window.end is None and window.kind in ("recording", "armed"):
                self._segment_count += 1
                state.probing = SpeechJob(f"{stream_id}:probe-{self._segment_count}", stream_id, chunk.clock_id,
                                          probes[-1], research_epoch=self._research_epoch, probe=True)
                self._speech.submit(state.probing)
        for segment in segments:
            self._segment_count += 1
            job = SpeechJob(f"{stream_id}:speech-{self._segment_count}", stream_id, chunk.clock_id, segment,
                            research_epoch=self._research_epoch)
            state.pending.append(job)
            self._speech.submit(job)  # transcribed off the event loop; see speech_result
        out.extend(self._advance_speech(stream_id, chunk.clock_id, now))
        return out

    def speech_result(self, job: SpeechJob, text: Optional[str | Transcript], error: Optional[str], now: float) -> list[dict]:
        """A transcript (or failure) for one segment, delivered on the event loop by the service.

        Order: the segment's command-span and command/error first, then any watermark it
        releases. A failure stops coverage for that stream and reports it unavailable.
        """
        if self._closed:
            return []
        state = self._speech_state.get(job.stream_id)
        if job.probe:
            return self._probe_result(state, job, text, error, now)
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
        if state.refused_through is not None:
            tokens = tokenize(text)
            continuing = (job.segment.start_frame - state.refused_through <= self._wake_join_frames()
                          and not (tokens and tokens[0] in WAKE_WORDS)
                          and not (tokens and all(token in SUNG_SYLLABLES for token in tokens)))
            if continuing:
                state.refused_through = job.segment.last_frame
                # Never acted on alone. During a take it is not cut out either: it may be singing, and a
                # lost melody is worse than a few words of a refused request left in the take.
                out.append(self._transcript(job, text, [], outcome="refused", detail="part of a request that was too long"))
                return out + self._advance_speech(job.stream_id, job.clock_id, now)
            state.refused_through = None
        held = state.held_wake
        if held is not None and text:
            state.held_wake = None
            held_job, held_text = held
            joined = f"{held_text} {text}"
            if (job.segment.start_frame - held_job.segment.last_frame <= self._wake_join_frames()
                    and self._continues(held_job, held_text, text, joined)):
                job = replace(held_job, segment=replace(held_job.segment, last_frame=job.segment.last_frame,
                                                        cut=job.segment.cut))
                text = joined
            else:
                out.extend(self._speech_utterance(held_job, held_text, now))
        if text and state.held_wake is None and self.speech_requires_wake and not _addressed(text):
            # Always-on microphone: only speech that starts with "Groove" can act (typed text is exempt).
            out.append(self._transcript(job, text, [], outcome="ignored", detail="not addressed to Groove"))
            text = ""
        if text:
            if self._unfinished(job, text):
                state.held_wake = (job, text)
                out.append(self._transcript(job, text, [], outcome="held", detail="waiting for the rest of the sentence"))
            else:
                out.extend(self._speech_utterance(job, text, now))
        out.extend(self._advance_speech(job.stream_id, job.clock_id, now))
        return out

    def _speech_utterance(self, job: SpeechJob, text: str, now: float, end: Optional[int] = None) -> list[dict]:
        """Act on one recognized segment, then report what was heard and done (speech-transcript)."""
        out = self._speech_commands(job, text, now, end)
        return out + [self._transcript(job, text, out, end)]

    def _transcript(self, job: SpeechJob, text: str, out: Sequence[dict], end: Optional[int] = None,
                    outcome: Optional[str] = None, detail: Optional[str] = None) -> dict:
        """Display-only record of one segment (PLAYTEST-CONTROLS-CONTRACT.md): never a command or coverage."""
        if outcome is None:
            mine = [m for m in out if str(m.get("requestId") or m.get("utteranceId") or "").startswith(job.job_id)
                    or str((m.get("command") or {}).get("id", "")).startswith(job.job_id)
                    or str(m.get("id", "")).startswith(job.job_id)]
            commands = [m for m in mine if m["type"] in ("command", "browser-action", "candidate-preview")]
            research = [m for m in mine if m["type"] == "research-context"]
            errors = [m for m in mine if m["type"] == "error"]
            if research:
                outcome, detail = "research", f"searching: {research[0]['description']}"
            elif commands:
                outcome, detail = "command", "; ".join(_describe(m) for m in commands)
            elif errors:
                outcome, detail = "refused", errors[0]["message"]
            elif job.job_id in self._language_pending:
                outcome, detail = "interpreting", "sent to the language model"
            else:
                outcome = "ignored"
        message = {"type": "speech-transcript", "utteranceId": job.job_id, "streamId": job.stream_id,
                   "clockId": job.clock_id, "startFrame": job.segment.start_frame,
                   "endFrame": max(job.segment.start_frame, job.segment.last_frame if end is None else end),
                   "text": (text or "")[:1000], "outcome": outcome}
        if detail:
            message["detail"] = detail[:300]
        return message

    def _speech_commands(self, job: SpeechJob, text: str, now: float, end: Optional[int] = None) -> list[dict]:
        """Every command in the segment, in spoken order; the segment's span is sent once, first."""
        segment = job.segment
        context_start = job.context_start_frame if job.context_start_frame is not None else segment.start_frame
        window = self._window_at(context_start)  # actual wake onset before exclusion pre-roll
        out: list[dict] = []
        for index, command in enumerate(split_commands(text)):
            out.extend(self._on_utterance({
                "type": "utterance", "id": job.job_id if index == 0 else f"{job.job_id}:{index}", "text": command,
                "clockId": job.clock_id, "startFrame": segment.start_frame,
                "endFrame": segment.last_frame if end is None else end,
                "duringRecording": window is not None and window.kind == "recording"}, now,
                take_armed=(window is not None and window.kind == "armed") or (index > 0 and self._take_armed()),
                obsolete=self._obsolete(window),
                recording_target=window.target if window is not None and window.kind == "recording" else None,
                research_obsolete=(job.research_epoch < self._research_epoch or self._older_research_intent(job.clock_id, context_start)),
                emit_span=not any(m["type"] == "command-span" for m in out)))
        return out

    def _probe_result(self, state: Optional[_SpeechStream], job: SpeechJob, text, error: Optional[str],
                      now: float) -> list[dict]:
        """Act on a probe only when it is exactly a stop of the current take; then split the open
        segment there so the stop is not repeated and following singing stays in the take."""
        if state is None or state.probing is not job:
            return []  # a stale probe never clears or acts for a newer one
        state.probing = None  # this probe is finished, whatever its result: later dips may probe again
        if state.failed or error is not None or state.pending:
            return []
        located, words = locate_command(job, text or "")
        if not words or len(split_commands(words)) != 1:
            return []
        result = self._parses(located, words)
        if not isinstance(result, Command) or result.operation != {"type": "stop-recording"}:
            return []
        if not state.segmenter.split_after(job.segment.start_frame, located.segment.last_frame):
            return []
        return self._speech_utterance(located, words, now) + self._advance_speech(job.stream_id, job.clock_id, now)

    def _refused_span(self, job: SpeechJob) -> list[dict]:
        """During a take, refused addressed speech is still command audio: exclude it, act on nothing."""
        recording, _, _ = self._speech_context(job)
        if not recording or self._obsolete(self._window_at(job.segment.start_frame)):
            return []
        return [{"type": "command-span", "utteranceId": job.job_id, "clockId": job.clock_id,
                 "startFrame": job.segment.start_frame, "endFrame": job.segment.last_frame}]

    def _speech_context(self, job: SpeechJob) -> tuple[bool, bool, Optional[dict]]:
        start = job.context_start_frame if job.context_start_frame is not None else job.segment.start_frame
        window = self._window_at(start)
        recording = window is not None and window.kind == "recording"
        return recording, window is not None and window.kind == "armed", window.target if recording else None

    def _parses(self, job: SpeechJob, text: str) -> Interpretation:
        recording, armed, target = self._speech_context(job)
        return self._interpret(text, self.session, recording, take_armed=armed, recording_target=target)

    def _hold_lag_exceeded(self, job: SpeechJob) -> bool:
        rate = (self.transport or {}).get("sampleRate", 44100)
        received = self._received_capture.get(job.clock_id, job.segment.last_frame)
        return received - job.segment.start_frame > HOLD_LAG_BUDGET_SECONDS * rate

    def _unfinished(self, job: SpeechJob, text: str) -> bool:
        """Hold a bare wake word, a cut segment, an open-ended sound description, or a sentence that
        does not yet parse. A stop is never held, even inside a cut segment."""
        if _bare_wake(text):
            return True
        if self.session is None or len(split_commands(text)) != 1:
            return False  # several commands: run them now rather than delaying a stop behind a fragment
        # No budget shortcut here: a late recognition result past the hold budget is still held, and
        # _advance_speech then refuses it if the sentence is open or transcribing, or acts on it if
        # the sentence has ended (WS1 late-result review).
        result = self._parses(job, text)
        if isinstance(result, Ignored):
            return False  # singing/performance (not addressed to Groove) is never held, refused or cut
        if isinstance(result, Command) and result.operation["type"] in ("stop-recording", "play"):
            return False
        return job.segment.cut or isinstance(result, (NotUnderstood, SoundSearch))

    def _continues(self, held_job: SpeechJob, held_text: str, text: str, joined: str) -> bool:
        """Whether the next segment completes the held sentence rather than being separate audio."""
        tokens = tokenize(text)
        if tokens and tokens[0] in WAKE_WORDS:
            return False  # a new addressed command, not the rest of this one
        if tokens and all(token in SUNG_SYLLABLES for token in tokens):
            return False  # singing after the sentence is music, never part of the request
        if _bare_wake(held_text):
            return True
        recording, _, _ = self._speech_context(held_job)
        if not recording or held_job.segment.cut:
            return True
        # During a take, never stretch a command span over singing that merely followed a refused
        # fragment: join only when the result is an actual command.
        return not isinstance(self._parses(held_job, joined), NotUnderstood)

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
        if (state.held_wake is not None and self._hold_lag_exceeded(state.held_wake[0])
                and (state.pending or state.segmenter.speaking)):
            # The browser's coverage-stall bound is reached while the sentence may still be going on:
            # refuse truthfully instead of acting on an unfinished request, and treat its
            # continuation as part of it. Unclassified audio after it stays unverified.
            held_job, held_text = state.held_wake
            state.held_wake = None
            state.refused_through = held_job.segment.last_frame
            out.extend(self._refused_span(held_job))
            out.append(_error(held_job.job_id, "that request was too long to hold while listening; nothing was changed. "
                                               f"Say it again as one sentence of under {HOLD_LAG_BUDGET_SECONDS - 1:g} seconds"))
            out.append(self._transcript(held_job, held_text, out, outcome="refused", detail=out[-1]["message"]))
        elif state.held_wake is not None and not state.pending and (
                decided >= state.held_wake[0].segment.last_frame + self._wake_join_frames()
                # At the budget with nothing open or transcribing, the sentence has ended: act on it.
                or (self._hold_lag_exceeded(state.held_wake[0]) and not state.segmenter.speaking
                    and decided >= state.held_wake[0].segment.last_frame)):
            wake_job, wake_text = state.held_wake  # nothing followed: act on it (or report it) as heard
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
            self._windows.append(_Window("recording", start, target=transport.get("recordingTarget")))
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
        if self._closed:
            return []
        out: list[dict] = self._previews.tick(now)
        for command_id, queued_at in list(self._external_queued.items()):
            if now - queued_at >= self._ack_timeout_s:
                del self._external_queued[command_id]
                out.append(_error(command_id, "queued browser edit has no final acknowledgment"))
        for action_id, request in list(self._browser_requests.items()):
            limit = BROWSER_ACTION_START_TIMEOUT_S if request.status == "sent" else BROWSER_ACTION_RUN_TIMEOUT_S
            if now - request.sent_at >= limit:
                del self._browser_requests[action_id]
                kind = _INPUT_ACTION_KIND[request.action["operation"]["type"]]
                out.append(_error(request.utterance_id, f"the browser did not finish the {kind}; no result was received"))
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

    def observe_research(self, message: Mapping[str, Any]) -> Optional[list[dict]]:
        """Record a research message on its way to the browser, so spoken accept/refine can refer to it."""
        if self._closed:
            return None
        search = self._searches.get(message["jobId"])
        if search is None or (search.status == "cancelled" and message["status"] != "cancelled"):
            return None  # a late worker must not revive a retired connection-owned job
        if search is not None:
            search.status = message["status"]
            if self._voice_research or message["candidates"] or message["status"] != "cancelled":
                search.candidates = message["candidates"]
            return self._previews.prune(search.job_id, list(search.candidates)) + self._auto_load(search, message)
        return None

    def _auto_load(self, search: "_Search", message: Mapping[str, Any]) -> list[dict]:
        """Load the best candidate of a spoken search: once retrieval is complete (fast, about a second),
        and again with the final best when optimization finishes, unless the track's patch was changed
        by something else in between (a manual pick wins)."""
        if not self.auto_load_sounds or not search.auto_load or not message["candidates"] or self.session is None or search is not self._latest_search():
            return []
        # Exactly two loads with distinct command ids (a repeated id is a duplicate to the browser):
        # the best retrieved match as soon as the list is complete, then the final best on completion.
        if message["status"] == "complete" and search.load_stage != "final":
            stage = "final"
        elif message["status"] == "running" and not search.load_stage and len(message["candidates"]) >= CANDIDATES:
            stage = "retrieval"
        else:
            return []
        search.load_stage = stage
        best = message["candidates"][0]
        best_patch = json.dumps(best["patch"], sort_keys=True)
        if best_patch == search.loaded_patch:
            return []
        track = next(t for t in self.session["tracks"] if t["id"] == search.track_id)
        current = json.dumps(track["patch"], sort_keys=True)
        if search.loaded_patch is not None and current != search.loaded_patch:
            return []  # the user (or another request) chose a different sound meanwhile
        if self._patch_acceptance_pending():
            return []
        search.loaded_patch = best_patch
        proposal = _Proposal(f"{search.job_id}:load-{stage}",
                             {"type": "apply-patch", "trackId": search.track_id, "patch": best["patch"]}, BOUNDARY["apply-patch"])
        return [self._issue(proposal, time.monotonic())]

    def _latest_search(self, with_candidates: bool = False) -> Optional[_Search]:
        """Newest search; with_candidates skips ones that ended (or were cancelled) before producing any."""
        for search in reversed(self._searches.values()):
            if search.candidates or not with_candidates:
                return search
        return None

    def _start_search(self, job_id: str, track_id: str, description: str, seeds: Optional[Sequence[dict]],
                      voice_request_id: Optional[str] = None) -> list[dict]:
        if voice_request_id is not None and (self._research is None or not self._voice_research):
            # The browser only displays research for jobs it knows: its own requests, or ones
            # announced by research-context (voice research). Never start a spoken job it would
            # silently ignore; say why instead.
            reason = (f"{NOT_CONFIGURED}; no sound was searched" if self._research is None else
                      "spoken sound search is off on this service (start it with GROOVE_VOICE_RESEARCH=1); "
                      "use the Sound panel to search, no sound was searched")
            return [_error(voice_request_id, reason)]
        accepted = False
        def failed(reason: str) -> list[dict]:
            if self._voice_research and voice_request_id is not None and not accepted:
                return [_error(voice_request_id, reason)]
            return [{"type": "research", "jobId": job_id, "status": "failed", "progress": 0, "candidates": [],
                     "error": reason}]
        binding = (track_id, description, voice_request_id)
        if job_id in self._seen_searches:
            return [] if self._seen_searches[job_id] == binding else failed("research job ID is already bound to another request")
        self._seen_searches[job_id] = binding
        while len(self._seen_searches) > 256:
            self._seen_searches.popitem(last=False)
        if not description.strip():
            return failed("describe the sound before starting research")
        if track_id not in MELODIC_TRACKS:
            return failed("sound search works on the three synth tracks; select one first")
        if self._research is None:
            return failed("sound research is not available in this build")
        if self._patch_acceptance_pending():
            return failed("a patch acceptance or queued browser edit is pending; wait for its final acknowledgment")
        out: list[dict] = []
        if self._voice_research:
            for previous in self._searches.values():
                if previous.status == "running":
                    self._research.cancel(previous.job_id)
                    previous.status = "cancelled"
            out.extend(self._previews.cancel("preview research job was superseded"))
        if voice_request_id is None:
            self._mark_ui_research_intent()
        self._searches[job_id] = _Search(job_id, track_id, description, auto_load=voice_request_id is not None)
        accepted = True
        self._language_epoch += 1
        while len(self._searches) > 16:
            self._searches.popitem(last=False)
        if self._voice_research and voice_request_id is not None:
            out.append({"type": "research-context", "requestId": voice_request_id, "jobId": job_id,
                        "trackId": track_id, "description": description, "origin": "voice"})
        # Context is returned synchronously to the socket loop; worker callbacks are queued
        # onto that loop and cannot run until after these frames enter its outbox.
        try:
            self._research.start(job_id, description, seeds)
        except Exception:
            self._searches[job_id].status = "failed"
            out.extend(failed("sound research could not start"))
        return out

    def _patch_acceptance_pending(self) -> bool:
        own = any(f.proposal.operation["type"] == "apply-patch" for f in self._in_flight.values())
        own = own or any(p.operation["type"] == "apply-patch" for p in self._backlog)
        # UI command acks do not disclose the operation. Conservatively wait for unknown
        # queued edits too, rather than replacing a possibly pending UI patch acceptance.
        unknown = any(cid not in self._in_flight for cid in (self.transport or {}).get("pendingCommandIds", []))
        return own or bool(self._external_queued) or unknown

    def _older_research_intent(self, clock_id: str, frame: int) -> bool:
        cutoff = self._ui_research_cutoff
        # Equal frames are possible for a fresh manual transcript while the engine is
        # stopped/offline. Socket order breaks that tie; already-pending speech jobs
        # are independently protected by research_epoch.
        return cutoff is not None and cutoff[0] == clock_id and frame < cutoff[1]

    def _mark_ui_research_intent(self) -> None:
        self._research_epoch += 1
        if self.transport is not None:
            clock = self.transport["clockId"]
            self._ui_research_cutoff = (clock, max(self.transport["currentFrame"], self._received_capture.get(clock, -1)))

    def _on_sound_intent(self, utterance_id: str, result: Interpretation, now: float) -> Union[list, _Proposal]:
        if isinstance(result, CancelSearch):
            running = self._latest_search()
            if (running is None or running.status != "running" or self._research is None
                    or not self._research.cancel(running.job_id)):
                return [_error(utterance_id, "no sound search is running")]
            self._language_epoch += 1
            running.status = "cancelled"
            return self._previews.cancel("preview research job was cancelled", running.job_id)
        latest = self._latest_search(with_candidates=not self._voice_research)
        if isinstance(result, AuditionCandidate):
            if not self._voice_research:
                return [_error(utterance_id, "voice preview is not enabled; use the browser preview controls")]
            if latest is None or not 1 <= result.index <= len(latest.candidates):
                return [_error(utterance_id, "that candidate is not currently available to audition")]
            candidate = latest.candidates[result.index - 1]
            if sum(item["id"] == candidate["id"] for item in latest.candidates) != 1:
                return [_error(utterance_id, "candidate ID is ambiguous; request fresh candidates")]
            return self._previews.request(f"{utterance_id}:preview", latest.job_id, candidate, now)
        if isinstance(result, AcceptCandidate):
            if latest is None or not latest.candidates:
                return [_error(utterance_id, "there are no sound candidates to accept yet")]
            if result.index > len(latest.candidates):
                return [_error(utterance_id, f"there are only {len(latest.candidates)} candidates")]
            patch = latest.candidates[result.index - 1]["patch"]
            return _Proposal(utterance_id, {"type": "apply-patch", "trackId": latest.track_id, "patch": patch}, BOUNDARY["apply-patch"])
        assert isinstance(result, SoundSearch)
        if result.refine:
            if latest is None or not latest.candidates:
                return [_error(utterance_id, "describe a sound first, for example: make it sound like an electric piano")]
            return self._start_search(f"{utterance_id}:job", latest.track_id, f"{latest.description}, {result.description}",
                                      [candidate["patch"] for candidate in latest.candidates], voice_request_id=utterance_id)
        return self._start_search(f"{utterance_id}:job", self.session["selected"]["trackId"], result.description, None,
                                  voice_request_id=utterance_id)

    # -- utterances --------------------------------------------------------------

    def _on_utterance(self, message: Mapping[str, Any], now: float, take_armed: Optional[bool] = None,
                      obsolete: bool = False, emit_span: bool = True,
                      recording_target: Optional[dict] = None, research_obsolete: Optional[bool] = None) -> list[dict]:
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
        if recording_target is None and during_recording:
            recording_target = (self.transport or {}).get("recordingTarget")  # typed/transcript path
        result = self._interpret(message["text"], self.session, during_recording, take_armed=armed,
                                 recording_target=recording_target)
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
        if research_obsolete is None:
            research_obsolete = self._older_research_intent(message["clockId"], message["startFrame"])
        if research_obsolete and isinstance(result, (SoundSearch, AcceptCandidate, AuditionCandidate, CancelSearch, NotUnderstood)):
            return out + [_error(utterance_id, "newer UI research supersedes this older voice intent; not applied")]
        if isinstance(result, NotUnderstood):
            # Familiar commands and explicit parser refusals never wait on a provider. Only
            # unknown addressed speech takes the optional bounded async interpretation path.
            if self._language is not None and result.reason == "command not recognized":
                unavailable = getattr(self._language, "unavailable", None)
                blocked = unavailable() if unavailable is not None else None
                if blocked is not None:
                    return out + [_error(utterance_id, blocked)]  # cooldown: no provider call at all
                normalized = " ".join(tokenize(message["text"]))
                if any(" ".join(tokenize(job.text)) == normalized for job, _ in self._language_pending.values()):
                    return out + [_error(utterance_id, "the same request is already being interpreted")]
                if len(self._language_pending) >= 5:
                    return out + [_error(utterance_id, "language queue is full; try again shortly")]
                latest = self._latest_search(with_candidates=not self._voice_research)
                research = ({"jobId": latest.job_id, "trackId": latest.track_id, "description": latest.description,
                             "status": latest.status, "candidates": [
                                 {"index": i + 1, "id": item["id"], "provenance": item.get("provenance", "")}
                                 for i, item in enumerate(latest.candidates[:CANDIDATES])]} if latest else {})
                job = LanguageJob(utterance_id, message["text"], deepcopy(self.session), during_recording, armed, research)
                self._language_pending[utterance_id] = (job, self._language_token())
                if not self._language.submit(job):
                    del self._language_pending[utterance_id]
                    return out + [_error(utterance_id, "language queue is full; try again shortly")]
                return out  # wake span is already excluded; coverage need not wait for inference
            return out + [_error(utterance_id, result.reason)]
        return out + self._apply_interpretation(utterance_id, result, now)

    def _run_music_tool(self, utterance_id: str, tool: MusicTool, now: float) -> list[dict]:
        """Compute a whole-song edit from the current session and issue it as ordinary commands, in order
        (key setting immediately, pattern edits at the next loop, one at a time)."""
        if self.session is None:
            return [_error(utterance_id, "no session snapshot received yet")]
        try:
            operations, _label = run_tool(tool.name, tool.args, self.session)
        except (ToolRefusal, ValueError, KeyError, TypeError, StopIteration) as error:
            return [_error(utterance_id, str(error) if isinstance(error, ToolRefusal) else "could not apply that edit; nothing changed")]
        out: list[dict] = []
        for index, operation in enumerate(operations):
            command_id = utterance_id if index == 0 else f"{utterance_id}:{index}"
            try:
                validate("SessionCommand", {"id": command_id, "expectedRevision": self.revision or 0,
                                             "boundary": BOUNDARY[operation["type"]], "operation": operation})
            except ContractError:
                return out + [_error(utterance_id, "that edit did not fit the song format; nothing changed")]
            proposal = _Proposal(command_id, operation, BOUNDARY[operation["type"]])
            if self._must_wait(proposal) or (index and operation["type"] == "edit-pattern"):
                if len(self._backlog) >= MAX_BACKLOG:
                    return out + [_error(utterance_id, "too many edits are waiting; try again after the next loop")]
                self._backlog.append(proposal)
            else:
                out.append(self._issue(proposal, now))
        return out + self._drain(now)

    def _capture_signature(self) -> tuple:
        transport = self.transport or {}
        return (transport.get("clockId"), transport.get("recordingState", "recording" if transport.get("recording") else "idle"),
                transport.get("recordingStartFrame"), transport.get("recordingEpoch"), transport.get("captureStartFrame"),
                transport.get("playing"), tuple(sorted((transport.get("recordingTarget") or {}).items())),
                tuple(sorted((transport.get("armedTarget") or {}).items())),
                # A provisional-only erase leaves the revision unchanged but must still invalidate
                # an older model intention (PLAYTEST-REPAIR-CONTRACT.md).
                (transport.get("captureErasure") or {}).get("commandId"))

    def _language_token(self) -> tuple:
        latest = self._latest_search(with_candidates=not self._voice_research)
        candidates = tuple((item["id"], json.dumps(item["patch"], sort_keys=True)) for item in latest.candidates) if latest else ()
        return (self._language_epoch, self.revision, self._capture_signature(), self._input_key(),
                latest.job_id if latest else None, candidates)

    def language_result(self, job: LanguageJob, result: Optional[Interpretation], error: Optional[str], now: float) -> list[dict]:
        if self._closed:
            return []
        pending = self._language_pending.pop(job.request_id, None)
        if pending is None or pending[0] is not job:
            return []
        if pending[1] != self._language_token():
            return [_error(job.request_id, "session or take changed while interpreting; no change applied")]
        if error is not None:
            return [_error(job.request_id, error)]
        if result is None or isinstance(result, (Ignored, NotUnderstood)):
            return [_error(job.request_id, "language agent could not resolve the request; no change applied")]
        if not isinstance(result, (Command, SoundSearch, AcceptCandidate, AuditionCandidate, CancelSearch, MusicTool, InputAction)):
            return [_error(job.request_id, "invalid language proposal; no change applied")]
        if isinstance(result, (AcceptCandidate, AuditionCandidate)) and (type(result.index) is not int or not 1 <= result.index <= CANDIDATES):
            return [_error(job.request_id, "invalid candidate index; no change applied")]
        if isinstance(result, SoundSearch) and (not isinstance(result.description, str)
                                               or not 0 < len(result.description.strip()) <= 500):
            return [_error(job.request_id, "invalid sound request; no change applied")]
        return self._apply_interpretation(job.request_id, result, now)

    def _apply_interpretation(self, utterance_id: str, result: Interpretation, now: float) -> list[dict]:
        out: list[dict] = []
        if isinstance(result, InputAction):
            return self._request_browser_action(utterance_id, dict(result.operation), now)
        if isinstance(result, MusicTool):
            return self._run_music_tool(utterance_id, result, now)
        if isinstance(result, Command):
            try:
                validate("SessionCommand", {"id": utterance_id, "expectedRevision": self.revision,
                                             "boundary": result.boundary, "operation": result.operation})
            except ContractError:
                return [_error(utterance_id, "invalid command proposal; no change applied")]
            allowed_boundaries = ("immediate", "next-loop") if result.operation["type"] == "apply-patch" else (BOUNDARY.get(result.operation["type"]),)
            if result.boundary not in allowed_boundaries:
                return [_error(utterance_id, "invalid command scheduling boundary; no change applied")]
            problem = validate_operation(result.operation)
            if problem is not None:
                return out + [_error(utterance_id, problem)]
            proposal: Optional[_Proposal] = _Proposal(utterance_id, result.operation, result.boundary)
        else:
            outcome = self._on_sound_intent(utterance_id, result, now)
            if isinstance(outcome, _Proposal):
                proposal = outcome
            elif outcome:
                return out + outcome  # refused: still excluded, no mutation
            else:
                proposal = None

        if proposal is None:
            return out
        if self._must_wait(proposal):
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
        next-loop command. Immediate controls are never held back; patch acceptances serialize separately.
        """
        return any(flight.proposal.boundary in ("next-loop", "next-beat") for flight in self._in_flight.values())

    def _must_wait(self, proposal: _Proposal) -> bool:
        # Interactive patches apply immediately once issued, but two acceptances
        # must not race against the same revision. Keep emergency/transport edits
        # on their existing immediate path.
        if proposal.operation["type"] == "apply-patch":
            return self._queued_in_flight() or any(
                flight.proposal.operation["type"] == "apply-patch"
                for flight in self._in_flight.values())
        return proposal.boundary == "next-loop" and self._queued_in_flight()

    def _issue(self, proposal: _Proposal, now: float) -> dict:
        self._language_epoch += 1  # even discard-only Undo can invalidate a late interpretation
        # Derived from the utterance so a repeated delivery maps to the same command ID,
        # which the browser answers with its previous acknowledgment instead of applying twice.
        command_id = f"{proposal.utterance_id}:cmd"
        self._in_flight[command_id] = _InFlight(proposal, command_id, now)
        return {"type": "command", "command": {"id": command_id, "expectedRevision": self.revision,
                                               "boundary": proposal.boundary, "operation": proposal.operation}}

    def _drain(self, now: float) -> list[dict]:
        """Issue the next waiting edit once its revision dependency has resolved.

        Next-loop commands are issued one at a time: the browser rechecks
        `expectedRevision` when a queued command is applied, so two issued
        against the same revision would make the second one stale.
        """
        if self._backlog and self.session is not None and not self._must_wait(self._backlog[0]):
            return [self._issue(self._backlog.popleft(), now)]
        return []

    def _on_ack(self, message: Mapping[str, Any], now: float) -> list[dict]:
        self.revision = message["revision"] if self.revision is None else max(self.revision, message["revision"])
        flight = self._in_flight.get(message["commandId"])
        if message["status"] != "queued":
            self._external_queued.pop(message["commandId"], None)
        if flight is None:
            if message["status"] == "queued":
                self._external_queued.setdefault(message["commandId"], now)
                while len(self._external_queued) > 256:
                    self._external_queued.popitem(last=False)
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

    # -- browser input executor --------------------------------------------------

    def _input_key(self) -> Optional[tuple]:
        status = self.browser_status
        return None if status is None else (status["clockId"], status["inputRevision"])

    def _on_browser_status(self, message: Mapping[str, Any]) -> list[dict]:
        """Track the executor's advertised capability and input configuration.

        A new clock or input revision (device, profile, calibration, offset) retires older speech
        streams and invalidates pending model decisions: the browser restarts speech on the new
        input path, and nothing recognized on the old one may act or be verified afterwards."""
        previous = self.browser_status
        if self.transport is not None and message["clockId"] != self.transport["clockId"]:
            return []  # status for another audio clock: not the current input
        if (previous is not None and previous["clockId"] == message["clockId"]
                and message["inputRevision"] < previous["inputRevision"]):
            return []  # stale snapshot delivered late; revisions never move backwards on one clock
        before = self._input_key()
        self.browser_status = dict(message)
        if before is not None and before != self._input_key():
            self._language_epoch += 1
            for state in self._speech_state.values():
                if state.input_key is not None and state.input_key != self._input_key():
                    state.failed = True  # its audio came from the previous input configuration
                    state.pending.clear()
                    state.held_wake = None
        return []

    def _on_browser_ack(self, message: Mapping[str, Any]) -> list[dict]:
        """Only acknowledgments for our own requests on the same clock count; others are ignored."""
        request = self._browser_requests.get(message["id"])
        if request is None or request.action["clockId"] != message["clockId"]:
            return []
        status = message["status"]
        if status == "running":
            request.status = "running"
            return []
        del self._browser_requests[message["id"]]
        kind = _INPUT_ACTION_KIND[request.action["operation"]["type"]]
        reason = message.get("reason")
        if status == "rejected":
            return [_error(request.utterance_id, f"{kind} was rejected: {reason or 'no reason given'}")]
        if status == "cancelled":
            return [_error(request.utterance_id, f"{kind} was cancelled" + (f": {reason}" if reason else ""))]
        return []  # complete: the browser shows the real result in its own status

    def _request_browser_action(self, utterance_id: str, operation: dict, now: float) -> list[dict]:
        status = self.browser_status
        transport = self.transport or {}
        if status is None or not status["available"] or (transport and status["clockId"] != transport.get("clockId")):
            return [_error(utterance_id, "browser input controls are not available yet; use the on-screen input controls")]
        active = status["activeAction"]
        if operation["type"] == "cancel-input-action":
            if active is None:
                return [_error(utterance_id, "no input calibration or change is running")]
            operation = {"type": "cancel-input-action", "actionId": active["id"]}
        else:
            if active is not None or any(r.action["operation"]["type"] != "cancel-input-action"
                                         for r in self._browser_requests.values()):
                return [_error(utterance_id, "an input action is already running; say cancel calibration first")]
            if transport.get("recordingState") in ("armed", "recording") or transport.get("recording"):
                return [_error(utterance_id, "stop recording before changing input settings")]
            if operation["type"] == "calibrate-input":
                if transport.get("playing"):
                    return [_error(utterance_id, "stop playback first, then calibrate")]
                if status["microphone"] == "off":
                    return [_error(utterance_id, "turn the microphone on before calibrating")]
        action = {"type": "browser-action", "id": f"{utterance_id}:input-{self._nonce}", "clockId": status["clockId"],
                  "expectedInputRevision": status["inputRevision"], "operation": operation}
        try:
            validate("ServerMessage", action)
        except ContractError:
            return [_error(utterance_id, "invalid input action; nothing was changed")]
        if action["id"] in self._browser_requests:
            return []
        self._browser_requests[action["id"]] = _BrowserRequest(utterance_id, action, now)
        while len(self._browser_requests) > 64:
            self._browser_requests.popitem(last=False)
        self._language_epoch += 1
        return [action]

    def close(self) -> None:
        self._closed = True
        self._browser_requests.clear()
        self._language_pending.clear()
        self._speech_state.clear()
        self._previews.clear()
        self._in_flight.clear()
        self._backlog.clear()
