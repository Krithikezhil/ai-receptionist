"""Unit tests for config.py's environment parsing — specifically the M6
idle-timeout validation (VOICE_AGENT_IDLE_TIMEOUT_SECS) and the
DEEPGRAM_MODEL/OPENAI_MODEL defaults/overrides. No network, no real
credentials.
"""

from __future__ import annotations

import pytest

from voice_agent.config import ConfigurationError, get_settings


def test_idle_timeout_defaults_to_45_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VOICE_AGENT_IDLE_TIMEOUT_SECS", raising=False)
    assert get_settings().idle_timeout_secs == 45.0


def test_idle_timeout_accepts_a_valid_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_AGENT_IDLE_TIMEOUT_SECS", "20")
    assert get_settings().idle_timeout_secs == 20.0


def test_idle_timeout_rejects_a_non_numeric_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_AGENT_IDLE_TIMEOUT_SECS", "not-a-number")
    with pytest.raises(ConfigurationError, match="VOICE_AGENT_IDLE_TIMEOUT_SECS"):
        get_settings()


def test_idle_timeout_rejects_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_AGENT_IDLE_TIMEOUT_SECS", "0")
    with pytest.raises(ConfigurationError, match="positive"):
        get_settings()


def test_idle_timeout_rejects_a_negative_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_AGENT_IDLE_TIMEOUT_SECS", "-5")
    with pytest.raises(ConfigurationError, match="positive"):
        get_settings()


def test_deepgram_model_defaults_to_nova_3_general(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEEPGRAM_MODEL", raising=False)
    assert get_settings().deepgram_model == "nova-3-general"


def test_deepgram_model_can_be_overridden(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPGRAM_MODEL", "nova-2-general")
    assert get_settings().deepgram_model == "nova-2-general"


def test_openai_model_defaults_to_gpt_4_1(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    assert get_settings().openai_model == "gpt-4.1"


def test_openai_model_can_be_overridden(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
    assert get_settings().openai_model == "gpt-4o-mini"
