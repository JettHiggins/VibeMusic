"""Research-facing adapter to Workstream 1's canonical browser-DSP renderer.

Keep the service's from_directory seam; use shared TypeScript patch validation,
sample-timed native note events and recipe velocities rather than duplicating
firmwareSnapshot in Python. Each render runs in a separate Node process.
"""
from pathlib import Path

from tools.sloop_renderer import ENGINE_REVISION, SloopRenderer as EngineRenderer


class SloopRenderer(EngineRenderer):
    @classmethod
    def from_directory(cls, directory: Path, engine_revision: str) -> 'SloopRenderer':
        if engine_revision != ENGINE_REVISION:
            raise ValueError('renderer is pinned to a different engine revision')
        return cls(assets=directory)
