"""Maps env-configured provider names (see config.py) to Pipecat service
instances.

"fake" is the default for every role — the service boots and every
automated test passes with zero provider credentials configured. A real
provider additionally requires its matching API key env var (see
.env.example). Adding a new vendor means adding one branch here — never
touching pipeline.py or the tools, which only see Pipecat's
STTService/LLMService/TTSService base types. See ARCHITECTURE.md "Provider
abstraction".

Real provider imports are local to their branch so importing this module
never requires every provider SDK to be installed/importable — only the one
actually selected.
"""

from __future__ import annotations

import os
from typing import Any

from pipecat.services.llm_service import LLMService
from pipecat.services.stt_service import STTService
from pipecat.services.tts_service import TTSService

from voice_agent.providers.fakes import FakeLLMService, FakeSTTService, FakeTTSService


class ProviderConfigurationError(Exception):
    """An unrecognized provider name, or a real provider selected without its
    required API key set."""


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ProviderConfigurationError(
            f"{name} is not set — required because a real provider is selected. See .env.example."
        )
    return value


def create_stt_service(provider: str) -> STTService:
    if provider == "fake":
        return FakeSTTService()
    if provider == "deepgram":
        from pipecat.services.deepgram.stt import DeepgramSTTService

        return DeepgramSTTService(api_key=_require_env("DEEPGRAM_API_KEY"))
    raise ProviderConfigurationError(f"Unrecognized STT_PROVIDER: {provider!r}")


def create_llm_service(provider: str) -> LLMService[Any]:
    if provider == "fake":
        return FakeLLMService()
    if provider == "openai":
        from pipecat.services.openai.llm import OpenAILLMService

        return OpenAILLMService(api_key=_require_env("OPENAI_API_KEY"))
    raise ProviderConfigurationError(f"Unrecognized LLM_PROVIDER: {provider!r}")


def create_tts_service(provider: str) -> TTSService:
    if provider == "fake":
        return FakeTTSService()
    if provider == "cartesia":
        from pipecat.services.cartesia.tts import CartesiaTTSService

        return CartesiaTTSService(
            api_key=_require_env("CARTESIA_API_KEY"),
            voice_id=os.environ.get("CARTESIA_VOICE_ID"),
        )
    raise ProviderConfigurationError(f"Unrecognized TTS_PROVIDER: {provider!r}")
