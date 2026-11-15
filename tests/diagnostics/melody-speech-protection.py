"""Proposed musical-vocalization guard, not proof of the user's exact ASR transcript.

Real Connection/parser, scripted transcript boundary and queued language port. No audio/model/API.
Run explicitly with PYTHONPATH=services/agent and pytest; these proposed acceptance cases currently fail.
"""
import pytest
from groove_agent.connection import Connection
from groove_agent.contracts import load_fixture

class PendingLanguage:
    def __init__(self):self.jobs=[]
    def submit(self,job):self.jobs.append(job);return True

def setup():
    language=PendingLanguage();connection=Connection(language=language)
    session=load_fixture('SessionState');session['selected']={'trackId':'synth-1'}
    connection.handle({'type':'session','session':session},0.)
    connection.handle({'type':'transport','transport':{'clockId':'music','sampleRate':44100,'currentFrame':220500,'loopStartFrame':0,'playing':True,'recording':True,'recordingState':'recording','recordingStartFrame':0,'recordingTarget':{'trackId':'synth-1'},'pendingCommandIds':[]}},0.)
    return connection,language

def say(connection,text):
    return connection.handle({'type':'utterance','id':'vocalization','text':text,'clockId':'music','startFrame':44100,'endFrame':176400,'duringRecording':True},0.)

@pytest.mark.parametrize('text',['Groove, duh duh duh duh','Groove, da da da','Groove, doo doo'])
def test_only_musical_syllables_after_a_possible_wake_word_do_not_delete_a_take_or_call_a_model(text):
    connection,language=setup();replies=say(connection,text)
    assert not any(m['type']=='command-span' for m in replies),f'proposed performance guard: {replies}; queued model jobs={len(language.jobs)}'
    assert not any(m['type']=='command' for m in replies)
    assert not language.jobs

def test_unaddressed_musical_syllables_are_already_performance():
    connection,language=setup();assert say(connection,'duh duh duh duh')==[];assert not language.jobs

def test_real_spoken_stop_still_excludes_its_measured_span_and_ends_only_capture():
    connection,language=setup();replies=say(connection,'Groove stop')
    assert any(m['type']=='command-span' for m in replies)
    assert [m['command']['operation'] for m in replies if m['type']=='command']==[{'type':'stop-recording'}]
    assert not language.jobs
