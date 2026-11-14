# Speech pipeline review: delayed capture context

Review target: PR #15 at c8f4ed4620d62005d794f017fe7b4f27f24ed1ba. Use an isolated checkout of that head and an environment with the existing service test dependencies. No model, provider or real microphone is involved.

```sh
PYTHONPATH=services/agent:services/agent/tests python - <<'PYTHON'
import tempfile
from pathlib import Path
from test_speech_harness import ScriptedWorker, connect, synth_take, chunks_from_wav, stream, frame_at
worker = ScriptedWorker(['Groove, stop'])
connection = connect(worker)
with tempfile.TemporaryDirectory() as directory:
    path = synth_take(Path(directory) / 'synthetic.wav')
    stream(connection, worker, chunks_from_wav(path), transcribe_each_chunk=False)
    transport = dict(connection.transport)
    transport.update(recording=False, recordingState='idle', currentFrame=frame_at(4))
    connection.handle({'type': 'transport', 'transport': transport}, 0)
    print(worker.finish(connection))
PYTHON
```

Actual: immediate play(false), then speech-verified, without command-span. Expected: preserve recording-time meaning and exclusion; do not stop playback. The result must use capture-time context even after stop/new-take transitions. Also cover audio/segment closure arriving after stop. The isolated base backend suite passed 133 tests/two optional skips; those tests do not cover this transition. This is a synthetic reproduction, not measured speech recognition.
