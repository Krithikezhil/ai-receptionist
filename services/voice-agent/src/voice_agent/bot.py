"""Manual, local-only entry point for talking to the receptionist bot in a
browser via Pipecat's SmallWebRTCTransport.

NOT part of CI, NOT a production entry point, NOT imported by main.py — no
telephony transport is defined here or anywhere else in M6. Uses Pipecat's
own official development runner (`pipecat.runner.run`) and
`create_transport` factory-dict pattern rather than hand-rolling WebRTC
signaling. Session orchestration (fetching runtime context, building
providers/pipeline, lifecycle handling) lives in session.py, not here —
this file only resolves dev-only config and builds the transport, then
hands off. A future M7 Twilio entry point calls session.run_session() the
same way, with a different transport and organization-id source; it does
not require changing session.py or pipeline.py.

Run from services/voice-agent (requires real STT/LLM/TTS provider keys to
be worth talking to — with the default "fake" providers it hears nothing
and always replies with the same canned sentence):

    uv run python -m pipecat.runner.run --transport webrtc src/voice_agent/bot.py

Then open the printed URL and set DEV_SESSION_ORGANIZATION_ID and
DEV_SESSION_ORGANIZATION_SERVICE_TOKEN (the raw token shown once when that
organization was created — see apps/api's POST /organizations response)
first. See README.md "Manual smoke test".
"""

from __future__ import annotations

import os

from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.transports.base_transport import TransportParams

from voice_agent.config import get_settings
from voice_agent.session import run_session

_DEV_ORGANIZATION_ID_ENV = "DEV_SESSION_ORGANIZATION_ID"
_DEV_ORGANIZATION_SERVICE_TOKEN_ENV = "DEV_SESSION_ORGANIZATION_SERVICE_TOKEN"
_INTERNAL_SERVICE_KEY_ENV = "INTERNAL_SERVICE_KEY"

_TRANSPORT_PARAMS = {
    "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
}


async def bot(runner_args: RunnerArguments) -> None:
    """Entry point Pipecat's development runner discovers and calls."""
    organization_id = os.environ.get(_DEV_ORGANIZATION_ID_ENV)
    if not organization_id:
        raise RuntimeError(
            f"Set {_DEV_ORGANIZATION_ID_ENV} to a real organization id before running "
            "the dev session — see README.md."
        )

    organization_service_token = os.environ.get(_DEV_ORGANIZATION_SERVICE_TOKEN_ENV)
    if not organization_service_token:
        raise RuntimeError(
            f"Set {_DEV_ORGANIZATION_SERVICE_TOKEN_ENV} to that organization's service "
            "credential (shown once at creation) before running the dev session — see README.md."
        )

    if not os.environ.get(_INTERNAL_SERVICE_KEY_ENV):
        raise RuntimeError(
            f"Set {_INTERNAL_SERVICE_KEY_ENV} (must match apps/api's value exactly) before "
            "running the dev session — see README.md."
        )

    settings = get_settings()
    transport = await create_transport(runner_args, _TRANSPORT_PARAMS)

    await run_session(
        organization_id=organization_id,
        organization_service_token=organization_service_token,
        transport=transport,
        settings=settings,
    )
