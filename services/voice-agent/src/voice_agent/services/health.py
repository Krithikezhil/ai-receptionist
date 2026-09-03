"""Health check business logic, kept framework-agnostic like apps/api's equivalent."""

from __future__ import annotations

import time
from typing import Literal, TypedDict

_START_TIME = time.monotonic()


class HealthStatus(TypedDict):
    status: Literal["ok"]
    service: Literal["voice-agent"]
    uptime_seconds: int


def get_health_status() -> HealthStatus:
    """Return liveness status.

    M1 intentionally does not check any external dependency (no Pipecat,
    no telephony provider, no database) — none are wired up yet.
    """
    return {
        "status": "ok",
        "service": "voice-agent",
        "uptime_seconds": int(time.monotonic() - _START_TIME),
    }
