"""Manual, local-only entry point for talking to the receptionist bot in a
browser via Pipecat's SmallWebRTCTransport.

NOT part of CI, NOT a production entry point, NOT imported by main.py — no
telephony transport is defined here or anywhere else in M5. Uses Pipecat's
own official development runner (`pipecat.runner.run`) and
`create_transport` factory-dict pattern rather than hand-rolling WebRTC
signaling. A future M6 Twilio transport is added by adding a `"twilio"` key
to `_TRANSPORT_PARAMS` below and passing the appropriate runner args — this
file's `bot()` function and pipeline.py do not change.

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

from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.transports.base_transport import TransportParams
from pipecat.workers.runner import WorkerRunner

from voice_agent.clients.api_client import ApiClient
from voice_agent.config import get_settings
from voice_agent.pipeline import build_pipeline
from voice_agent.providers.factory import (
    create_llm_service,
    create_stt_service,
    create_tts_service,
)

_DEV_ORGANIZATION_ID_ENV = "DEV_SESSION_ORGANIZATION_ID"
_DEV_ORGANIZATION_SERVICE_TOKEN_ENV = "DEV_SESSION_ORGANIZATION_SERVICE_TOKEN"

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

    settings = get_settings()
    transport = await create_transport(runner_args, _TRANSPORT_PARAMS)

    async with ApiClient(
        settings.api_base_url,
        settings.internal_service_key,
        organization_service_token,
    ) as api_client:
        runtime_context = await api_client.get_runtime_context(organization_id)

        pipeline = build_pipeline(
            transport=transport,
            stt=create_stt_service(settings.stt_provider),
            llm=create_llm_service(settings.llm_provider),
            tts=create_tts_service(settings.tts_provider),
            runtime_context=runtime_context,
            api_client=api_client,
        )

        worker = PipelineWorker(pipeline, params=PipelineParams())
        runner = WorkerRunner()
        await runner.add_workers(worker)
        await runner.run()
