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
