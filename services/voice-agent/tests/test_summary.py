"""Tests for summary.generate_call_summary (M12 Step 6).

Uses FakeLLMService's run_inference() override (see providers/fakes.py) --
no real provider, no network. See summary.py for the exact filtering
contract these tests verify against the Pipecat message shapes actually
produced by pipeline.py / llm_response_universal.py.
"""

from __future__ import annotations

import json

import pytest
from pipecat.processors.aggregators.llm_context import LLMContext

from voice_agent.clients.api_client import ApiClientError
from voice_agent.providers.fakes import FakeLLMService
from voice_agent.summary import generate_call_summary


@pytest.mark.asyncio
async def test_returns_the_llm_result_on_success() -> None:
    context = LLMContext(
        messages=[
            {"role": "user", "content": "What are your hours?"},
            {"role": "assistant", "content": "We're open 9 to 5."},
        ]
    )
    llm = FakeLLMService(inference_result="Caller asked about business hours.")

    result = await generate_call_summary(llm, context)

    assert result == "Caller asked about business hours."


@pytest.mark.asyncio
async def test_none_llm_result_becomes_none() -> None:
    context = LLMContext(messages=[{"role": "user", "content": "Hello"}])
    llm = FakeLLMService(inference_result=None)

    result = await generate_call_summary(llm, context)

    assert result is None


@pytest.mark.asyncio
async def test_empty_string_llm_result_becomes_none() -> None:
    context = LLMContext(messages=[{"role": "user", "content": "Hello"}])
    llm = FakeLLMService(inference_result="   ")

    result = await generate_call_summary(llm, context)

    assert result is None


@pytest.mark.asyncio
async def test_llm_inference_failure_becomes_none_and_does_not_propagate() -> None:
    context = LLMContext(messages=[{"role": "user", "content": "Hello"}])
    llm = FakeLLMService(inference_error=RuntimeError("boom"))

    result = await generate_call_summary(llm, context)

    assert result is None


@pytest.mark.asyncio
async def test_system_prompt_is_excluded_from_summary_input() -> None:
    context = LLMContext(
        messages=[
            {"role": "system", "content": "SENTINEL-SYSTEM-PROMPT"},
            {"role": "user", "content": "What are your hours?"},
        ]
    )
    llm = FakeLLMService()

    await generate_call_summary(llm, context)

    assert llm.last_context is not None
    sent_messages = llm.last_context.get_messages()
    assert all("SENTINEL-SYSTEM-PROMPT" not in str(m) for m in sent_messages)
    assert all(m.get("role") != "system" for m in sent_messages if isinstance(m, dict))


@pytest.mark.asyncio
async def test_tool_call_messages_and_results_are_excluded() -> None:
    context = LLMContext(
        messages=[
            {"role": "user", "content": "Check availability for tomorrow."},
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call-1",
                        "function": {
                            "name": "check_availability",
                            "arguments": "SENTINEL-TOOL-ARGS",
                        },
                        "type": "function",
                    }
                ],
            },
            {"role": "tool", "content": "SENTINEL-TOOL-RESULT", "tool_call_id": "call-1"},
        ]
    )
    llm = FakeLLMService()

    await generate_call_summary(llm, context)

    assert llm.last_context is not None
    sent_messages = llm.last_context.get_messages()
    assert all("SENTINEL-TOOL-ARGS" not in str(m) for m in sent_messages)
    assert all("SENTINEL-TOOL-RESULT" not in str(m) for m in sent_messages)
    assert all(m.get("role") != "tool" for m in sent_messages if isinstance(m, dict))


@pytest.mark.asyncio
async def test_raw_api_client_error_text_is_excluded() -> None:
    error_text = str(ApiClientError("SENTINEL-API-ERROR-DETAIL"))
    context = LLMContext(
        messages=[
            {"role": "user", "content": "Book me an appointment."},
            {
                "role": "tool",
                "content": json.dumps({"error": error_text}),
                "tool_call_id": "call-1",
            },
        ]
    )
    llm = FakeLLMService()

    await generate_call_summary(llm, context)

    assert llm.last_context is not None
    sent_messages = llm.last_context.get_messages()
    assert all("SENTINEL-API-ERROR-DETAIL" not in str(m) for m in sent_messages)


@pytest.mark.asyncio
async def test_normal_user_and_assistant_content_is_retained() -> None:
    context = LLMContext(
        messages=[
            {"role": "system", "content": "system prompt"},
            {"role": "user", "content": "What are your hours?"},
            {"role": "assistant", "content": "We're open 9 to 5."},
        ]
    )
    llm = FakeLLMService()

    await generate_call_summary(llm, context)

    assert llm.last_context is not None
    sent_messages = llm.last_context.get_messages()
    assert {"role": "user", "content": "What are your hours?"} in sent_messages
    assert {"role": "assistant", "content": "We're open 9 to 5."} in sent_messages


@pytest.mark.asyncio
async def test_summary_output_is_trimmed() -> None:
    context = LLMContext(messages=[{"role": "user", "content": "Hello"}])
    llm = FakeLLMService(inference_result="  Caller asked about business hours.  ")

    result = await generate_call_summary(llm, context)

    assert result == "Caller asked about business hours."


@pytest.mark.asyncio
async def test_empty_conversation_returns_none_without_calling_run_inference() -> None:
    context = LLMContext(messages=[{"role": "system", "content": "system prompt only"}])
    llm = FakeLLMService()

    result = await generate_call_summary(llm, context)

    assert result is None
    assert llm.last_context is None
