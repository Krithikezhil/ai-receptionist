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
