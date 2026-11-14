"""Locate addressed speech inside energy segments that can also contain singing.

Alignment is internal; wire spans still use the existing capture-clock contract.
Untimed/scripted providers retain conservative whole-segment exclusion.
"""
from dataclasses import replace
from math import isfinite

from .intents import WAKE_WORDS, tokenize
from .speech_pipeline import SpeechJob, Transcript

PREROLL_SECONDS = 0.12
POSTROLL_SECONDS = 0.12
SUNG_SYLLABLES = frozenset({"ah", "aah", "oh", "ooh", "oo", "la", "na", "da", "do", "doo", "mmm", "mm"})


def locate_command(job: SpeechJob, transcript: str | Transcript,
                   decided_through: int | None = None) -> tuple[SpeechJob, str]:
    if isinstance(transcript, str):
        return job, transcript.strip()
    words = transcript.words
    wake = next((i for i, word in enumerate(words)
                 if any(token in WAKE_WORDS for token in tokenize(word.text))), None)
    if wake is None:
        return job, transcript.text.strip()
    prefix = [token for word in words[:wake] for token in tokenize(word.text)]
    if any(token not in SUNG_SYLLABLES for token in prefix):
        return job, transcript.text.strip()  # ordinary conversation still must begin with Groove
    # Prefix syllables can be sung notes. Only an explicitly recognized whole wake word
    # allows trimming; ordinary speech and providers without alignment keep the old path.
    text = " ".join(word.text.strip() for word in words[wake:]).strip()
    segment = job.segment
    duration = len(segment.samples) / segment.sample_rate
    previous_end = 0.0
    for word in words:
        if (not isfinite(word.start) or not isfinite(word.end) or word.start < previous_end
                or word.end <= word.start or word.end > duration + 0.02):
            return job, text  # uncertain alignment: exclude the whole segment, never leak speech
        previous_end = word.end
    onset = words[wake].start
    # Use the original capture/payload ratio, not Whisper's resampled 16 kHz rate.
    frame_rate = (segment.last_frame - segment.start_frame + 1) / duration if duration else 0
    start = segment.start_frame + round(max(0.0, onset - PREROLL_SECONDS) * frame_rate)
    context_start = segment.start_frame + round(onset * frame_rate)
    # Include weak final consonants below the energy threshold, only within quiet audio
    # already classified by the segmenter. Never extend into an open musical segment.
    end = segment.last_frame
    if decided_through is not None:
        end = max(end, min(decided_through, end + round(POSTROLL_SECONDS * frame_rate)))
    return replace(job, segment=replace(segment, start_frame=start, last_frame=end),
                   context_start_frame=context_start), text
