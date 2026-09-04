"""Unit tests for providers/factory.py — the one place provider choice is
decided. No network calls: "fake" is asserted as the safe default, and
missing-API-key/unrecognized-provider paths are asserted without ever
constructing a real provider client.
"""

from __future__ import annotations

import pytest

from voice_agent.providers.factory import (
    ProviderConfigurationError,
    create_llm_service,
    create_stt_service,
    create_tts_service,
)
from voice_agent.providers.fakes import FakeLLMService, FakeSTTService, FakeTTSService


def test_fake_is_the_default_stt_provider() -> None:
    assert isinstance(create_stt_service("fake"), FakeSTTService)


def test_fake_is_the_default_llm_provider() -> None:
    assert isinstance(create_llm_service("fake"), FakeLLMService)


def test_fake_is_the_default_tts_provider() -> None:
    assert isinstance(create_tts_service("fake"), FakeTTSService)


def test_unrecognized_stt_provider_raises_a_clear_error() -> None:
    with pytest.raises(ProviderConfigurationError, match="Unrecognized STT_PROVIDER"):
        create_stt_service("not-a-real-provider")


def test_unrecognized_llm_provider_raises_a_clear_error() -> None:
    with pytest.raises(ProviderConfigurationError, match="Unrecognized LLM_PROVIDER"):
        create_llm_service("not-a-real-provider")


def test_unrecognized_tts_provider_raises_a_clear_error() -> None:
    with pytest.raises(ProviderConfigurationError, match="Unrecognized TTS_PROVIDER"):
        create_tts_service("not-a-real-provider")


def test_deepgram_without_api_key_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    with pytest.raises(ProviderConfigurationError, match="DEEPGRAM_API_KEY"):
        create_stt_service("deepgram")


def test_openai_without_api_key_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ProviderConfigurationError, match="OPENAI_API_KEY"):
        create_llm_service("openai")


def test_cartesia_without_api_key_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CARTESIA_API_KEY", raising=False)
    with pytest.raises(ProviderConfigurationError, match="CARTESIA_API_KEY"):
        create_tts_service("cartesia")
