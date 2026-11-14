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
