from test_speech_harness import ScriptedWorker,connect,synth_take,chunks_from_wav,frame_at
from test_research import FakePort

def test_late_first_cut_result_does_not_execute_valid_prefix_after_hold_budget(tmp_path):
    worker=ScriptedWorker(['Groove make it sound like a warm piano','with a soft attack','and a little chorus'])
    conn=connect(worker,recording=False)
    conn.session['selected']={'trackId':'synth-1'}
    conn._research=port=FakePort();conn._voice_research=True
    take=synth_take(tmp_path/'late.wav',hits=(),speech=(1,9.5),seconds=13)
    log=[]
    for chunk in chunks_from_wav(take):
        replies=conn.handle(chunk,0.)
        # The first4s segment is genuinely cut at t5, but the recognizer takes3s to return.
        # At t8 the browser would still be inside its8s coverage bound (7s since speech onset).
        if chunk['endFrame']>=frame_at(8):replies+=worker.finish(conn)
        log.append((chunk,replies))
    early=[r for chunk,replies in log if chunk['endFrame']<frame_at(9.5) for r in replies if r['type']=='research-context']
    assert not early, 'late STT must not bypass the unfinished-cut refusal just because its lag budget already expired: '+str(early)
