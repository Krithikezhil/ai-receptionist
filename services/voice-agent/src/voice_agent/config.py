"""Environment configuration for the voice-agent service.

Nothing in this module should ever be logged in full — see SECURITY.md.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    env: str
    port: int
    log_level: str

    # Internal voice API (apps/api) — see clients/api_client.py.
    api_base_url: str
    internal_service_key: str | None

    # STT/LLM/TTS provider selection — see providers/factory.py. Each
    # defaults to "fake" (a deterministic, no-network double), so the
    # service boots and every automated test passes with zero provider
    # credentials configured. A real value here also requires the matching
    # provider API key (OPENAI_API_KEY / DEEPGRAM_API_KEY /
    # CARTESIA_API_KEY, read directly by the provider SDKs, not by this
    # module) to actually be set.
    stt_provider: str
    llm_provider: str
    tts_provider: str


def get_settings() -> Settings:
    return Settings(
        env=os.environ.get("NODE_ENV", "development"),
        port=int(os.environ.get("VOICE_AGENT_PORT", "8000")),
        log_level=os.environ.get("VOICE_AGENT_LOG_LEVEL", "info"),
        api_base_url=os.environ.get("API_BASE_URL", "http://localhost:4000"),
        # Deliberately no default — see ApiClient, which fails closed if this
        # is unset when a real internal-API call is actually attempted, the
        # same "assert only when the feature is used" pattern apps/api uses
        # for its own secrets.
        internal_service_key=os.environ.get("INTERNAL_SERVICE_KEY"),
        stt_provider=os.environ.get("STT_PROVIDER", "fake"),
        llm_provider=os.environ.get("LLM_PROVIDER", "fake"),
        tts_provider=os.environ.get("TTS_PROVIDER", "fake"),
    )
