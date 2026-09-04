"""Proves the pipeline genuinely wires the search_knowledge tool through
Pipecat's own function-calling machinery — not a bypass.

Uses Pipecat's own `pipecat.tests.utils.run_test` helper (the officially
supported way to test a FrameProcessor's frame flow) rather than hand-rolled
pipeline-execution plumbing. Runs entirely against FakeLLMService and a
mocked HTTP transport — no network, no real STT/LLM/TTS provider, no
audio device, no browser, no Twilio.
"""

from __future__ import annotations

import json

import httpx
import pytest
from pipecat.frames.frames import FunctionCallResultFrame, LLMContextFrame
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.tests.utils import run_test

from voice_agent.clients.api_client import ApiClient
from voice_agent.providers.fakes import FakeLLMService
from voice_agent.tools.search_knowledge import build_search_knowledge_schema

ORG_ID = "11111111-1111-1111-1111-111111111111"
ORG_TOKEN = "test-org-token"


def _mock_knowledge_transport(handler_calls: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        handler_calls.append(request)
        return httpx.Response(
            200,
            json={
                "knowledge": [
                    {
                        "id": "k1",
                        "title": "Parking",
                        "content": "Free parking behind the building.",
                        "category": "faq",
                        "active": True,
                    }
                ]
            },
        )

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_llm_responds_directly_when_no_tool_trigger() -> None:
    llm = FakeLLMService(canned_response="Hello, how can I help?")
    context = LLMContext(messages=[{"role": "user", "content": "Hi there"}])

    down_frames, _ = await run_test(
        llm,
        frames_to_send=[LLMContextFrame(context=context)],
        expected_down_frames=None,
        start_timeout=5.0,
    )

    types = [type(f).__name__ for f in down_frames]
    assert "LLMFullResponseStartFrame" in types
    assert "LLMTextFrame" in types
    assert "LLMFullResponseEndFrame" in types
    assert "FunctionCallsStartedFrame" not in types


@pytest.mark.asyncio
async def test_llm_invokes_search_knowledge_through_real_function_calling_machinery() -> None:
    handler_calls: list[httpx.Request] = []
    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=_mock_knowledge_transport(handler_calls),
    ) as api_client:
        schema = build_search_knowledge_schema(api_client, ORG_ID)
        llm = FakeLLMService()
        context = LLMContext(
            messages=[{"role": "user", "content": "Do you have knowledge about parking?"}],
            tools=[schema],
        )

        down_frames, _ = await run_test(
            llm,
            frames_to_send=[LLMContextFrame(context=context)],
            expected_down_frames=None,
        )

        # The mocked internal API was genuinely called — proves the tool
        # handler executed, not just that a frame was pushed.
        assert len(handler_calls) == 1
        assert handler_calls[0].url.path == f"/internal/v1/organizations/{ORG_ID}/knowledge"

        types = [type(f).__name__ for f in down_frames]
        assert types.index("LLMFullResponseStartFrame") < types.index("FunctionCallsStartedFrame")
        assert "FunctionCallResultFrame" in types

        result_frame = next(f for f in down_frames if isinstance(f, FunctionCallResultFrame))
        assert result_frame.function_name == "search_knowledge"
        result = result_frame.result
        if isinstance(result, str):
            result = json.loads(result)
        assert result["results"][0]["title"] == "Parking"


@pytest.mark.asyncio
async def test_search_knowledge_tool_surfaces_api_errors_without_crashing_the_session() -> None:
    def failing_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "Not authenticated."})

    async with ApiClient(
        "http://internal-api.test",
        "wrong-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(failing_handler),
    ) as api_client:
        schema = build_search_knowledge_schema(api_client, ORG_ID)
        llm = FakeLLMService()
        context = LLMContext(
            messages=[{"role": "user", "content": "Tell me about your knowledge base"}],
            tools=[schema],
        )

        down_frames, _ = await run_test(
            llm,
            frames_to_send=[LLMContextFrame(context=context)],
            expected_down_frames=None,
        )

        result_frame = next(f for f in down_frames if isinstance(f, FunctionCallResultFrame))
        result = result_frame.result
        if isinstance(result, str):
            result = json.loads(result)
        assert "error" in result
