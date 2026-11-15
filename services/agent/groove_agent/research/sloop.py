"""Research-facing adapter to Workstream 1's canonical browser-DSP renderer.

Keep the service's from_directory seam; use shared TypeScript patch validation,
sample-timed native note events and recipe velocities rather than duplicating
firmwareSnapshot in Python. Each render runs in a separate Node process.
"""
import sys
from pathlib import Path

# The renderer lives in WS1's root tools/ package. The documented service command
# (uvicorn --app-dir services/agent) does not put the repository root on sys.path, which made
# GROOVE_RESEARCH=sloop fail to import before any spoken or typed search could run.
_ROOT = Path(__file__).resolve().parents[4]
if (_ROOT / "tools" / "sloop_renderer.py").is_file() and str(_ROOT) not in sys.path:
    sys.path.append(str(_ROOT))

from tools.sloop_renderer import ENGINE_REVISION, SloopRenderer as EngineRenderer


class SloopRenderer(EngineRenderer):
    @classmethod
    def from_directory(cls, directory: Path, engine_revision: str) -> 'SloopRenderer':
        if engine_revision != ENGINE_REVISION:
            raise ValueError('renderer is pinned to a different engine revision')
        return cls(assets=directory)
