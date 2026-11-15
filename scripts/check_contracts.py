"""Validate the shared examples with the same JSON Schemas backend code consumes."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator
root = Path(__file__).resolve().parents[1] / 'packages/contracts'
for name in ('SessionState', 'SessionCommand', 'PerformanceEvent', 'PatchCandidate', 'ClientMessage', 'ServerMessage'):
    schema = json.loads((root / f'{name}.schema.json').read_text())
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(json.loads((root / 'fixtures' / f'{name}.json').read_text()))
print('All six contract fixtures pass Python JSON Schema validation.')
Draft202012Validator(json.loads((root / 'SessionCommand.schema.json').read_text())).validate(json.loads((root / 'fixtures/PerformanceBatch.json').read_text()))
print('Performance-batch example passes Python command validation.')
for name, schema_name in (('SpeechAudio', 'ClientMessage'), ('SpeechStatus', 'ServerMessage'), ('SpeechVerified', 'ServerMessage')):
    Draft202012Validator(json.loads((root / f'{schema_name}.schema.json').read_text())).validate(
        json.loads((root / 'fixtures' / f'{name}.json').read_text()))
print('Speech transport examples pass Python message validation.')

for example in json.loads((root / 'fixtures/RecordingUsability.json').read_text()):
    name = 'ClientMessage' if example['type'] == 'transport' else 'ServerMessage'
    Draft202012Validator(json.loads((root / f'{name}.schema.json').read_text())).validate(example)
print('Recording-usability examples pass Python message validation.')

for example in json.loads((root / 'fixtures/VoiceResearch.json').read_text()):
    name = 'ClientMessage' if example['type'] == 'preview-ack' else 'ServerMessage'
    Draft202012Validator(json.loads((root / f'{name}.schema.json').read_text())).validate(example)
print('Voice research/preview examples pass Python message validation.')

voice_examples = json.loads((root / 'fixtures/VoiceResearch.json').read_text())
client = Draft202012Validator(json.loads((root / 'ClientMessage.schema.json').read_text()))
server = Draft202012Validator(json.loads((root / 'ServerMessage.schema.json').read_text()))
context = next(m for m in voice_examples if m['type'] == 'research-context')
preview = next(m for m in voice_examples if m['type'] == 'candidate-preview')
ack = next(m for m in voice_examples if m['type'] == 'preview-ack')
for base, validator, invalids in [
    (context, server, [{'trackId': 'drums'}, {'origin': 'model'}, {'jobId': ''}, {'patch': {}}]),
    (preview, server, [{'candidateId': ''}, {'previewUrl': 'https://example.com'}, {'expectedRevision': 1}]),
    (ack, client, [{'status': 'applied'}, {'jobId': ''}, {'revision': 1}]),
]:
    for fields in invalids:
        assert not validator.is_valid({**base, **fields}), fields
assert not client.is_valid(context) and not client.is_valid(preview) and not server.is_valid(ack)
print('Voice research malformed/wrong-direction examples are rejected by Python schemas.')

for example in json.loads((root / 'fixtures/PlaytestRepair.json').read_text()):
    name = 'ClientMessage' if example['type'] == 'transport' else 'ServerMessage'
    Draft202012Validator(json.loads((root / f'{name}.schema.json').read_text())).validate(example)
print('Playtest repair examples pass Python message validation.')

for example in json.loads((root / 'fixtures/MusicalControls.json').read_text()):
    name = 'ServerMessage' if example['type'] in ('command', 'browser-action') else 'ClientMessage'
    Draft202012Validator(json.loads((root / f'{name}.schema.json').read_text())).validate(example)
print('Musical control and browser-action examples pass Python message validation.')

for example in json.loads((root / 'fixtures/PlaytestControls.json').read_text()):
    name = 'ClientMessage' if example['type'] == 'session' else 'ServerMessage'
    Draft202012Validator(json.loads((root / f'{name}.schema.json').read_text())).validate(example)
print('Playtest-round (rhythm snap, chord mode, transcript) examples pass Python message validation.')
