"""Alignment guards: invalid timing remains conservative, conversation stays wake-gated."""
import numpy as np
import pytest

from groove_agent.speech_alignment import locate_command
from groove_agent.speech_pipeline import Segment, SpeechJob, Transcript, Word


def job():
    return SpeechJob("j", "s", "ctx", Segment(1000, 177399, np.zeros(64000, np.float32), 16000))


@pytest.mark.parametrize("words", [(), (Word("Groove", float("nan"), 3.5),),
    (Word("Groove", 3, 2),), (Word("Groove", -1, 1),), (Word("Groove", 3, 5),),
    (Word("Groove", 3, 3),), (Word("Groove", 3, 3.5), Word("stop", 3.4, 3.9))])
def test_missing_or_bad_alignment_never_narrows_exclusion(words):
    original = job()
    located, _ = locate_command(original, Transcript("Groove stop", words))
    assert located is original


def test_ordinary_conversation_does_not_become_a_command_at_an_interior_wake_word():
    original = job()
    text = "I said Groove stop"
    words = (Word("I said", 0, 2), Word("Groove", 2, 3), Word("stop", 3, 4))
    located, result = locate_command(original, Transcript(text, words))
    assert located is original and result == text


def test_sung_syllables_can_precede_addressed_speech():
    located, text = locate_command(job(), Transcript("la la Groove stop", (
        Word("la la", 0, 1.5), Word("Groove", 3, 3.5), Word("stop", 3.5, 4))))
    assert text == "Groove stop"
    assert located.segment.start_frame == 1000 + round(2.88 * 44100)
    assert located.context_start_frame == 1000 + 3 * 44100
    assert located.segment.last_frame == 177399



def test_local_adapter_aligns_one_full_decode_without_redecoding_a_phantom_tail():
    import threading
    from types import SimpleNamespace
    from groove_agent.stt import FasterWhisperTranscriber
    options = {}
    class Model:
        def transcribe(self, audio, **kwargs):
            options.update(kwargs)
            def segments():
                yield SimpleNamespace(text="Groove, record kick. Groove, stop.", words=[
                    SimpleNamespace(word=" Groove,", start=1.0, end=1.2),
                    SimpleNamespace(word=" record kick. Groove, stop.", start=1.2, end=2.5)])
                raise AssertionError("short no-timestamps window must not decode its tail again")
            return segments(), None
    stt = object.__new__(FasterWhisperTranscriber)
    stt._lock, stt._model = threading.Lock(), Model()
    result = stt.transcribe_timed(np.zeros(64000, np.float32), 16000)
    assert result.text == "Groove, record kick. Groove, stop."
    assert result.words[0] == Word(" Groove,", 1, 1.2)
    assert options["word_timestamps"] and options["without_timestamps"]
