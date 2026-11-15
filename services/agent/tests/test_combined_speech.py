"""Cross-capability checks for the three pending WS3 PRs, using scripted transcripts."""
from groove_agent.intents import Command
from groove_agent.speech_pipeline import Transcript, Word
from test_speech_harness import ScriptedWorker, synth_take, chunks_from_wav, connect, flat, stream, frame_at
from test_language import PendingLanguage


def joined_take(tmp_path):
    return synth_take(tmp_path / "combined.wav", hits=(), speech=(1, 2.5), more_speech=((3, 3.7),), seconds=5)


def test_aligned_compound_commands_preserve_music_and_share_one_span(tmp_path):
    text = "Groove record kick. Groove stop."
    words = (Word("Groove", 2, 2.1), Word("record kick.", 2.1, 2.3), Word("Groove", 2.4, 2.5), Word("stop.", 2.5, 2.7))
    worker = ScriptedWorker([Transcript(text, words)])
    replies = flat(stream(connect(worker), worker, chunks_from_wav(joined_take(tmp_path))))
    spans = [r for r in replies if r["type"] == "command-span"]
    assert len(spans) == 1 and frame_at(2.5) < spans[0]["startFrame"] <= frame_at(3)
    commands = [r["command"] for r in replies if r["type"] == "command"]
    assert [c["operation"]["type"] for c in commands] == ["record", "stop-recording"]
    covering = next(i for i, r in enumerate(replies) if r["type"] == "speech-verified" and r["throughFrame"] >= spans[0]["endFrame"])
    assert max(i for i, r in enumerate(replies) if r["type"] == "command") < covering


def test_stop_in_compound_segment_invalidates_earlier_delayed_language_proposal(tmp_path):
    worker = ScriptedWorker([Transcript("Groove transform this into glassy bells. Groove stop.", (
        Word("Groove", 2, 2.1), Word("transform this into glassy bells.", 2.1, 2.3),
        Word("Groove", 2.4, 2.5), Word("stop.", 2.5, 2.7)))])
    connection = connect(worker)
    connection._language = language = PendingLanguage()
    replies = flat(stream(connection, worker, chunks_from_wav(joined_take(tmp_path))))
    assert len(language.jobs) == 1
    assert [r["command"]["operation"] for r in replies if r["type"] == "command"] == [{"type": "stop-recording"}]
    late = connection.language_result(language.jobs[0], Command({"type": "tempo", "bpm": 135}, "next-loop"), None, 2)
    assert late[0]["type"] == "error" and "changed" in late[0]["message"]
