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


def get_settings() -> Settings:
    return Settings(
        env=os.environ.get("NODE_ENV", "development"),
        port=int(os.environ.get("VOICE_AGENT_PORT", "8000")),
        log_level=os.environ.get("VOICE_AGENT_LOG_LEVEL", "info"),
    )
