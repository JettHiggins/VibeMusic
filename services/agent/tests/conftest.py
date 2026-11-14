"""The normal test suite never enables a live provider from a developer's .env.

Graph/SDK tests inject their own scripted models or mock HTTP transports. Actual
provider measurement is explicit through scripts/language_check.py --live.
"""
import os

os.environ["GROOVE_LLM"] = ""
os.environ["GROOVE_STT"] = ""
os.environ["GROOVE_RESEARCH"] = ""
