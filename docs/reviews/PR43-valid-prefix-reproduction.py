from test_speech_harness import ScriptedWorker, connect, synth_take, chunks_from_wav, stream, frame_at
from test_research import FakePort


def test_forced_cut_sound_request_does_not_start_research_from_a_valid_prefix(tmp_path):
    worker=ScriptedWorker(['Groove make it sound like a warm piano','with a soft attack'])
    connection=connect(worker,recording=False)
    connection.session['selected']={'trackId':'synth-1'}
    connection._research=port=FakePort()
    connection._voice_research=True
    take=synth_take(tmp_path/'long.wav',hits=(),speech=(1,6),seconds=9)
    log=stream(connection,worker,chunks_from_wav(take))
    early=[r for chunk,replies in log if chunk['endFrame']<frame_at(6) for r in replies if r['type']=='research-context']
    assert early==[], 'must not start a research job from a recognized prefix while its segment is explicitly cut'
    assert len(port.started)==1 and 'soft attack' in port.started[0][1]
