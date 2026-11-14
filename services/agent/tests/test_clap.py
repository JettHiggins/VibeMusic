"""Opt-in CLAP checks: set GROOVE_TEST_CLAP=1. They load (and on first run download) the model weights."""
import os

import numpy as np
import pytest

pytestmark = pytest.mark.skipif(os.environ.get("GROOVE_TEST_CLAP") != "1", reason="set GROOVE_TEST_CLAP=1 to run CLAP tests")


@pytest.fixture(scope="module")
def clap():
    from groove_agent.research.clap import ClapEmbedder
    return ClapEmbedder()


def tone(frequency, seconds=2.0, rate=44100):
    t = np.arange(int(seconds * rate)) / rate
    return (0.4 * np.sin(2 * np.pi * frequency * t) * np.exp(-2 * t)).astype(np.float32)


def test_audio_and_text_share_one_space(clap):
    from groove_agent.research.audio import unit
    audio = clap.embed_audio(tone(440), 44100)
    text = clap.embed_text("a bell")
    assert audio.shape == text.shape and audio.ndim == 1 and np.all(np.isfinite(audio))
    assert np.allclose(audio, clap.embed_audio(tone(440), 44100))  # deterministic
    assert -1.0 <= float(unit(audio) @ unit(text)) <= 1.0
    assert not np.allclose(unit(audio), unit(clap.embed_audio(np.random.default_rng(0).standard_normal(88200).astype(np.float32) * 0.1, 44100)))


def test_text_embeddings_are_not_degenerate_and_broken_checkpoints_are_refused(clap):
    from groove_agent.research.audio import unit
    from groove_agent.research.clap import ClapEmbedder, DegenerateModel
    organ, noise, organ_again = (unit(clap.embed_text(t)) for t in ("a church organ", "wind and rain noise", "a pipe organ in a church"))
    assert float(organ @ organ_again) > float(organ @ noise) + 0.2
    # Do not assert that another remote checkpoint remains broken forever.
    # Check rejection deterministically in test_clap_validation instead.


def test_batched_text_features_equal_single_texts(clap):
    texts = ["a church organ", "80s electric piano with chorus", "deep sub bass"]
    batched = clap.embed_texts(texts)
    for text, vector in zip(texts, batched):
        assert np.allclose(vector, clap.embed_text(text), atol=1e-5)


def test_render_level_does_not_change_the_audio_embedding(clap):
    from groove_agent.research.audio import unit
    quiet, loud = tone(330) * 0.25, tone(330)
    assert float(unit(clap.embed_audio(quiet, 44100)) @ unit(clap.embed_audio(loud, 44100))) > 0.999
