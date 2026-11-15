from test_speech_harness import ScriptedWorker, connect, synth_take, chunks_from_wav, stream, frame_at, flat
from test_research import FakePort


def test_long_valid_prefix_never_executes_while_sentence_still_open(tmp_path):
    worker=ScriptedWorker(['Groove make it sound like a warm piano','with a soft attack and a mellow tone','and a little chorus'])
    connection=connect(worker,recording=False)
    connection.session['selected']={'trackId':'synth-1'}
    connection._research=port=FakePort()
    connection._voice_research=True
    take=synth_take(tmp_path/'long.wav',hits=(),speech=(1,9.5),seconds=13)
    log=stream(connection,worker,chunks_from_wav(take))
    early=[(chunk['endFrame'],r) for chunk,replies in log if chunk['endFrame']<frame_at(9.5) for r in replies if r['type']=='research-context']
    assert early==[], 'coverage budget must refuse safely rather than start research from an unfinished valid prefix: '+str(early)


def test_failed_probe_releases_inflight_slot_for_later_stop(tmp_path):
    class ProbeWorker(ScriptedWorker):
        supports_probe=True
        def __init__(self):
            super().__init__(['la la la'])
            self.probes=[]
        def finish(self,connection):
            replies=[]
            while self.jobs:
                job=self.jobs.pop(0)
                if job.probe:
                    self.probes.append(job)
                    if len(self.probes)==1:
                        replies+=connection.speech_result(job,None,'temporary probe failure',0.)
                    else:
                        replies+=connection.speech_result(job,'Groove stop',None,0.)
                else:
                    self.transcribed.append(job)
                    replies+=connection.speech_result(job,self.texts.pop(0) if self.texts else '',None,0.)
            return replies
    worker=ProbeWorker();connection=connect(worker,recording=True)
    take=synth_take(tmp_path/'dips.wav',hits=(),speech=(1,1.4),more_speech=((1.7,2.1),(2.4,2.8),(3.1,3.5)),seconds=4.8)
    replies=flat(stream(connection,worker,chunks_from_wav(take)))
    assert len(worker.probes)>=2, 'a completed failed probe must not permanently occupy the inflight slot for this open segment'
    assert any(r['type']=='command' and r['command']['operation']=={'type':'stop-recording'} for r in replies)
