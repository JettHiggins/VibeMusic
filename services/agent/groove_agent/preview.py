"""Connection-local non-mutating preview requests, bound to exact research candidates."""
from collections import OrderedDict
from dataclasses import dataclass
import json


def candidate_fingerprint(candidate: dict) -> str:
    return json.dumps({"patch": candidate["patch"], "previewUrl": candidate["previewUrl"]}, sort_keys=True)


def error(request_id: str, reason: str) -> dict:
    return {"type": "error", "requestId": request_id, "message": reason}


@dataclass
class Preview:
    job_id: str
    candidate_id: str
    fingerprint: str
    deadline: float
    status: str = "requested"


class PreviewRequests:
    def __init__(self, start_timeout: float = 10, finish_timeout: float = 135) -> None:
        self.start_timeout, self.finish_timeout = start_timeout, finish_timeout
        self.pending: dict[str, Preview] = {}
        self.retired: OrderedDict[str, tuple[str, str]] = OrderedDict()

    def _retire(self, request_id: str) -> None:
        preview = self.pending.pop(request_id)
        self.retired[request_id] = (preview.job_id, preview.candidate_id)
        while len(self.retired) > 256:
            self.retired.popitem(last=False)

    def cancel(self, reason: str, job_id: str | None = None) -> list[dict]:
        out = []
        for request_id, preview in list(self.pending.items()):
            if job_id is None or preview.job_id == job_id:
                self._retire(request_id)
                out.append(error(request_id, reason))
        return out

    def request(self, request_id: str, job_id: str, candidate: dict, now: float) -> list[dict]:
        binding = (job_id, candidate["id"])
        previous = self.pending.get(request_id)
        if previous is not None:
            if (previous.job_id, previous.candidate_id) == binding and previous.fingerprint == candidate_fingerprint(candidate):
                return []
            return [error(request_id, "preview ID is already bound to a different candidate")]
        if request_id in self.retired:
            return [] if self.retired[request_id] == binding else [error(request_id, "preview ID was already used")]
        if not candidate.get("previewUrl", "").strip():
            return [error(request_id, "candidate preview is unavailable")]
        out = self.cancel("preview replaced by a newer audition")
        self.pending[request_id] = Preview(job_id, candidate["id"], candidate_fingerprint(candidate), now + self.start_timeout)
        return out + [{"type": "candidate-preview", "id": request_id, "jobId": job_id, "candidateId": candidate["id"]}]

    def acknowledge(self, message: dict, now: float) -> list[dict]:
        request_id = message["id"]
        binding = (message["jobId"], message["candidateId"])
        preview = self.pending.get(request_id)
        if preview is None:
            return [] if self.retired.get(request_id) == binding else [error(request_id, "no matching preview request")]
        if (preview.job_id, preview.candidate_id) != binding:
            return [error(request_id, "preview acknowledgment does not match its request/job/candidate")]
        status = message["status"]
        if status == "started":
            if preview.status == "requested":
                preview.status, preview.deadline = "started", now + self.finish_timeout
            return []  # duplicate started never extends the finish deadline
        if status == "ended" and preview.status != "started":
            return [error(request_id, "preview cannot end before playback has started")]
        if status not in ("ended", "rejected"):
            return [error(request_id, "invalid preview acknowledgment lifecycle")]
        self._retire(request_id)
        if status == "rejected":
            return [error(request_id, "preview rejected: " + (message.get("reason") or "browser playback unavailable")[:500])]
        return []

    def prune(self, job_id: str, candidates: list[dict]) -> list[dict]:
        available = {candidate["id"]: candidate_fingerprint(candidate) for candidate in candidates}
        out = []
        for request_id, preview in list(self.pending.items()):
            if preview.job_id == job_id and available.get(preview.candidate_id) != preview.fingerprint:
                self._retire(request_id)
                out.append(error(request_id, "preview candidate was removed or replaced"))
        return out

    def tick(self, now: float) -> list[dict]:
        out = []
        for request_id, preview in list(self.pending.items()):
            if now >= preview.deadline:
                self._retire(request_id)
                out.append(error(request_id, "preview " + ("start" if preview.status == "requested" else "finish") + " acknowledgment timed out"))
        return out

    def clear(self) -> None:
        self.pending.clear()
        self.retired.clear()
