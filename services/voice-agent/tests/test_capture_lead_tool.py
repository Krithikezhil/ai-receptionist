"""Direct unit tests for tools/capture_lead.py's handler logic, isolated
from the full LLM/pipeline machinery. See tests/test_search_knowledge_tool.py
for the sibling read-only tool's equivalent tests.

Not covered here (flagged, not silently skipped): an end-to-end proof that
Pipecat's real function-calling machinery invokes this handler (the way
tests/test_pipeline.py does for search_knowledge) -- that would require
relying on FakeLLMService's tool-triggering heuristic, which this session
has not inspected. The handler-level coverage below is otherwise equivalent
to search_knowledge's own test file.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from pipecat.services.llm_service import FunctionCallParams

from voice_agent.clients.api_client import ApiClient
from voice_agent.tools.capture_lead import CAPTURE_LEAD_FUNCTION_NAME, build_capture_lead_schema

ORG_ID = "11111111-1111-1111-1111-111111111111"
ORG_TOKEN = "test-org-token"


def _make_params(arguments: dict[str, Any]) -> tuple[FunctionCallParams, list[Any]]:
    results: list[Any] = []

    async def result_callback(result: Any, *, properties: Any = None) -> None:
        results.append(result)

    params = FunctionCallParams(
        function_name=CAPTURE_LEAD_FUNCTION_NAME,
        tool_call_id="test-call-id",
        arguments=arguments,
        llm=None,  # type: ignore[arg-type]
        pipeline_worker=None,  # type: ignore[arg-type]
        context=None,  # type: ignore[arg-type]
        result_callback=result_callback,
    )
    return params, results


@pytest.mark.asyncio
async def test_schema_name_and_no_required_fields() -> None:
    """No field is JSON-schema-required -- forcing a required field would
    pressure the LLM to invent a value just to call the tool at all."""
    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(lambda r: httpx.Response(201, json={"lead": {}})),
    ) as api_client:
        schema = build_capture_lead_schema(api_client, ORG_ID, None)

        assert schema.name == CAPTURE_LEAD_FUNCTION_NAME
        assert schema.required == []
        assert set(schema.properties) == {
            "contact_name",
            "contact_phone",
            "contact_email",
            "intent",
            "notes",
        }
        assert schema.handler is not None


@pytest.mark.asyncio
async def test_handler_sends_only_the_provided_fields() -> None:
    seen_body: dict[str, object] = {}

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"lead": {"id": "lead-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_capture_lead_schema(api_client, ORG_ID, None)
        assert schema.handler is not None
        params, results = _make_params({"contact_name": "Jane Caller", "intent": "Wants a quote"})
        await schema.handler(params)

    assert seen_body == {"contactName": "Jane Caller", "intent": "Wants a quote"}
    assert results == [{"captured": True}]


@pytest.mark.asyncio
async def test_handler_includes_call_sid_when_bound_but_never_from_arguments() -> None:
    """call_sid is bound once at pipeline-build time (see pipeline.py),
    exactly like organization_id -- the LLM never supplies or overrides it
    via tool-call arguments."""
    seen_body: dict[str, object] = {}

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"lead": {"id": "lead-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_capture_lead_schema(api_client, ORG_ID, "CA123")
        assert schema.handler is not None
        params, _ = _make_params({"contact_name": "Jane Caller", "call_sid": "CA-spoofed"})
        await schema.handler(params)

    assert seen_body == {"contactName": "Jane Caller", "callSid": "CA123"}


@pytest.mark.asyncio
async def test_handler_omits_call_sid_when_not_bound() -> None:
    seen_body: dict[str, object] = {}

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"lead": {"id": "lead-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_capture_lead_schema(api_client, ORG_ID, None)
        assert schema.handler is not None
        params, _ = _make_params({"notes": "Wants a callback tomorrow"})
        await schema.handler(params)

    assert seen_body == {"notes": "Wants a callback tomorrow"}
    assert "callSid" not in seen_body


@pytest.mark.asyncio
async def test_handler_treats_blank_or_whitespace_only_arguments_as_not_provided() -> None:
    seen_body: dict[str, object] = {}

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"lead": {"id": "lead-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_capture_lead_schema(api_client, ORG_ID, None)
        assert schema.handler is not None
        params, _ = _make_params(
            {"contact_name": "  ", "contact_email": "", "intent": "Wants a quote"}
        )
        await schema.handler(params)

    assert seen_body == {"intent": "Wants a quote"}


@pytest.mark.asyncio
async def test_handler_delivers_an_error_result_instead_of_raising_on_api_failure() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "Invalid lead data."})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_capture_lead_schema(api_client, ORG_ID, None)
        assert schema.handler is not None
        params, results = _make_params({"intent": "Wants a quote"})
        # Must not raise -- a tool failure should never take down the session.
        await schema.handler(params)

    assert len(results) == 1
    assert "error" in results[0]


@pytest.mark.asyncio
async def test_handler_ignores_a_spoofed_organization_id_in_arguments() -> None:
    """A malicious/unexpected organizationId (or organization_id) in the
    tool-call arguments must never redirect the write to a different
    organization -- organization_id is bound once, when the schema is
    built (see pipeline.py), never read from the LLM-controlled arguments
    dict. Both key spellings are planted at once so this proves neither is
    read, not just that one specific spelling is ignored."""
    seen_paths: list[str] = []

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        return httpx.Response(201, json={"lead": {"id": "lead-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_capture_lead_schema(api_client, ORG_ID, None)
        assert schema.handler is not None
        params, _ = _make_params(
            {
                "intent": "Wants a quote",
                "organizationId": "22222222-2222-2222-2222-222222222222",
                "organization_id": "33333333-3333-3333-3333-333333333333",
            }
        )
        await schema.handler(params)

    assert seen_paths == [f"/internal/v1/organizations/{ORG_ID}/leads"]
