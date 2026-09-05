"""Structural test for pipeline.build_pipeline: proves it is genuinely
transport-agnostic (accepts any BaseTransport, no telephony-specific code)
and returns a valid Pipecat Pipeline, using fakes throughout.
"""

from __future__ import annotations

import httpx
import pytest
from pipecat.pipeline.pipeline import Pipeline
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.transports.base_transport import BaseTransport

from voice_agent.clients.api_client import ApiClient
from voice_agent.clients.models import ReceptionistConfig, RuntimeContext
from voice_agent.pipeline import build_pipeline
from voice_agent.providers.fakes import FakeLLMService, FakeSTTService, FakeTTSService


class _FakeTransport(BaseTransport):
    """Minimal BaseTransport double — proves build_pipeline only depends on
    the transport's public input()/output() contract, nothing
    telephony-specific."""

    def input(self) -> FrameProcessor:
        return FrameProcessor(name="fake-transport-input")

    def output(self) -> FrameProcessor:
        return FrameProcessor(name="fake-transport-output")


def _fake_runtime_context() -> RuntimeContext:
    return RuntimeContext(
        organization_id="11111111-1111-1111-1111-111111111111",
        receptionist_config=ReceptionistConfig(
            enabled=True,
            display_name="AI Receptionist",
            greeting="Thanks for calling.",
            tone="friendly",
            instructions="",
            fallback_message="Let me have someone follow up.",
            after_hours_message="We're closed right now.",
            call_transfer_enabled=False,
            call_transfer_phone=None,
            language="en",
        ),
        business_profile=None,
        business_hours=[],
        services=[],
    )


ORG_TOKEN = "test-org-token"


@pytest.mark.asyncio
async def test_build_pipeline_is_transport_agnostic_and_returns_a_pipeline() -> None:
    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={})),
    ) as api_client:
        pipeline = build_pipeline(
            transport=_FakeTransport(),
            stt=FakeSTTService(),
            llm=FakeLLMService(),
            tts=FakeTTSService(),
            runtime_context=_fake_runtime_context(),
            api_client=api_client,
        )

        assert isinstance(pipeline, Pipeline)


@pytest.mark.asyncio
async def test_build_pipeline_includes_a_vad_stage() -> None:
    """A VADProcessor must sit between the transport input and STT — real-
    time turn-taking/interruption detection, added in M6. Local ONNX model
    only (SileroVADAnalyzer) — no network, no provider credentials."""
    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={})),
    ) as api_client:
        pipeline = build_pipeline(
            transport=_FakeTransport(),
            stt=FakeSTTService(),
            llm=FakeLLMService(),
            tts=FakeTTSService(),
            runtime_context=_fake_runtime_context(),
            api_client=api_client,
        )

        processor_names = [type(p).__name__ for p in pipeline.processors]
        assert "VADProcessor" in processor_names
        assert processor_names.index("VADProcessor") < processor_names.index("FakeSTTService")
