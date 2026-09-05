"""Direct unit tests for tools/search_knowledge.py's handler logic, isolated
from the full LLM/pipeline machinery. See tests/test_pipeline.py for the
end-to-end proof that Pipecat's real function-calling machinery actually
invokes this handler, not just that it's shaped correctly.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from pipecat.services.llm_service import FunctionCallParams

from voice_agent.clients.api_client import ApiClient
from voice_agent.tools.search_knowledge import (
    SEARCH_KNOWLEDGE_FUNCTION_NAME,
    build_search_knowledge_schema,
)

ORG_ID = "11111111-1111-1111-1111-111111111111"
ORG_TOKEN = "test-org-token"


def _make_params(arguments: dict[str, Any]) -> tuple[FunctionCallParams, list[Any]]:
    results: list[Any] = []

    async def result_callback(result: Any, *, properties: Any = None) -> None:
        results.append(result)

    params = FunctionCallParams(
        function_name=SEARCH_KNOWLEDGE_FUNCTION_NAME,
        tool_call_id="test-call-id",
        arguments=arguments,
        llm=None,  # type: ignore[arg-type]
        pipeline_worker=None,  # type: ignore[arg-type]
        context=None,  # type: ignore[arg-type]
        result_callback=result_callback,
    )
    return params, results


@pytest.mark.asyncio
async def test_schema_name_description_and_required_query_param() -> None:
    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})),
    ) as api_client:
        schema = build_search_knowledge_schema(api_client, ORG_ID)

        assert schema.name == SEARCH_KNOWLEDGE_FUNCTION_NAME
        assert "query" in schema.properties
        assert schema.required == ["query"]
        assert schema.handler is not None


@pytest.mark.asyncio
async def test_handler_delivers_matching_entries_via_result_callback() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
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

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_search_knowledge_schema(api_client, ORG_ID)
        assert schema.handler is not None
        params, results = _make_params({"query": "parking"})
        await schema.handler(params)

    assert len(results) == 1
    assert results[0]["results"][0]["title"] == "Parking"


@pytest.mark.asyncio
async def test_handler_delivers_an_error_result_instead_of_raising_on_api_failure() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Organization not found."})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_search_knowledge_schema(api_client, ORG_ID)
        assert schema.handler is not None
        params, results = _make_params({"query": "parking"})
        # Must not raise — a tool failure should never take down the session.
        await schema.handler(params)

    assert len(results) == 1
    assert "error" in results[0]


@pytest.mark.asyncio
async def test_handler_ignores_a_blank_query_and_only_applies_category() -> None:
    seen: dict[str, str] = {}

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={"knowledge": []})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_search_knowledge_schema(api_client, ORG_ID)
        assert schema.handler is not None
        params, _ = _make_params({"query": "", "category": "policy"})
        await schema.handler(params)

    assert seen == {"category": "policy"}


@pytest.mark.asyncio
async def test_handler_ignores_a_spoofed_organization_id_in_arguments() -> None:
    """A malicious/unexpected organizationId (or organization_id) in the
    tool-call arguments must never redirect the query to a different
    organization — organization_id is bound once, when the schema is built
    (see pipeline.py), never read from the LLM-controlled arguments dict.
    Both key spellings are planted at once so this proves neither is read,
    not just that one specific spelling is ignored."""
    seen_paths: list[str] = []

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        return httpx.Response(200, json={"knowledge": []})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_search_knowledge_schema(api_client, ORG_ID)
        assert schema.handler is not None
        params, _ = _make_params(
            {
                "query": "parking",
                "organizationId": "22222222-2222-2222-2222-222222222222",
                "organization_id": "33333333-3333-3333-3333-333333333333",
            }
        )
        await schema.handler(params)

    assert seen_paths == [f"/internal/v1/organizations/{ORG_ID}/knowledge"]


@pytest.mark.asyncio
async def test_handler_returns_an_empty_results_list_when_nothing_matches() -> None:
    """A query with no matching knowledge entries must come back as an
    honest, empty result — never fabricated content — so the LLM has a
    clear, truthful signal to say it doesn't know rather than invent an
    answer (see runtime/context.py's honesty guardrails)."""

    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"knowledge": []})),
    ) as api_client:
        schema = build_search_knowledge_schema(api_client, ORG_ID)
        assert schema.handler is not None
        params, results = _make_params({"query": "do you offer underwater basket weaving"})
        await schema.handler(params)

    assert results == [{"results": []}]
