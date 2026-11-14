"""Validation against the shared v1 JSON Schemas exported by Workstream 1.

The Zod source in packages/contracts is authoritative. This module only reads
the committed schema files; it never redefines a contract.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match

SCHEMA_NAMES = (
    "SessionState",
    "SessionCommand",
    "PerformanceEvent",
    "PatchCandidate",
    "ClientMessage",
    "ServerMessage",
)


class ContractError(ValueError):
    """A payload does not match its shared contract."""


def contracts_dir() -> Path:
    override = os.environ.get("GROOVE_CONTRACTS_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[3] / "packages" / "contracts"


@lru_cache(maxsize=None)
def _validator(name: str) -> Draft202012Validator:
    if name not in SCHEMA_NAMES:
        raise KeyError(name)
    schema = json.loads((contracts_dir() / f"{name}.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validate(name: str, payload: Any) -> None:
    """Raise ContractError when payload is not a valid instance of the named contract."""
    error = best_match(_validator(name).iter_errors(payload))
    if error is not None:
        location = "/".join(str(part) for part in error.absolute_path) or "(root)"
        raise ContractError(f"{name} at {location}: {error.message}")


def is_valid(name: str, payload: Any) -> bool:
    return _validator(name).is_valid(payload)


def load_fixture(name: str) -> Any:
    return json.loads((contracts_dir() / "fixtures" / f"{name}.json").read_text(encoding="utf-8"))
