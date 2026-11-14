"""Ordinary tests must not opt into providers through a developer's shell or ignored .env.

Set these before collection imports app.py. Tests may explicitly monkeypatch providers;
GROOVE_TEST_STT/CLAP opt-ins remain separate and instantiate their own local test models.
"""
import os

for name in ('GROOVE_LLM', 'OPENROUTER_API_KEY', 'GROOVE_STT', 'GROOVE_RESEARCH'):
    os.environ[name] = ''
os.environ["GROOVE_VOICE_RESEARCH"] = "0"
