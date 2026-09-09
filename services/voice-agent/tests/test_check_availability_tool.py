"""Direct unit tests for tools/check_availability.py's handler logic,
isolated from the full LLM/pipeline machinery -- mirrors
tests/test_capture_lead_tool.py's own structure.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from pipecat.services.llm_service import FunctionCallParams

from voice_agent.clients.api_client import ApiClient
from voice_agent.clients.models import ServiceItem
from voice_agent.tools.check_availability import (
    CHECK_AVAILABILITY_FUNCTION_NAME,
    build_check_availability_schema,
    resolve_service_id,
)

ORG_ID = "11111111-1111-1111-1111-111111111111"
ORG_TOKEN = "test-org-token"

_HAIRCUT = ServiceItem(
    id="22222222-2222-2222-2222-222222222222",
    name="Haircut",
    description=None,
    duration_minutes=30,
    price=None,
    active=True,
)
_INACTIVE = ServiceItem(
    id="33333333-3333-3333-3333-333333333333",
    name="Retired Service",
    description=None,
    duration_minutes=30,
    price=None,
    active=False,
)


def _make_params(arguments: dict[str, Any]) -> tuple[FunctionCallParams, list[Any]]:
    results: list[Any] = []

    async def result_callback(result: Any, *, properties: Any = None) -> None:
        results.append(result)

    params = FunctionCallParams(
        function_name=CHECK_AVAILABILITY_FUNCTION_NAME,
        tool_call_id="test-call-id",
        arguments=arguments,
        llm=None,  # type: ignore[arg-type]
        pipeline_worker=None,  # type: ignore[arg-type]
        context=None,  # type: ignore[arg-type]
        result_callback=result_callback,
    )
    return params, results


def test_resolve_service_id_exact_match() -> None:
    assert resolve_service_id([_HAIRCUT], "Haircut") == _HAIRCUT.id


def test_resolve_service_id_is_case_insensitive() -> None:
    assert resolve_service_id([_HAIRCUT], "haircut") == _HAIRCUT.id
    assert resolve_service_id([_HAIRCUT], "HAIRCUT") == _HAIRCUT.id


def test_resolve_service_id_no_match_returns_none() -> None:
    assert resolve_service_id([_HAIRCUT], "Massage") is None


def test_resolve_service_id_ignores_inactive_services() -> None:
    assert resolve_service_id([_INACTIVE], "Retired Service") is None


@pytest.mark.asyncio
async def test_unknown_service_name_returns_structured_error_with_zero_api_calls() -> None:
    call_count = 0

    def handler_fn(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(200, json={"status": "ok", "slots": []})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_check_availability_schema(api_client, ORG_ID, [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params({"service_name": "Massage", "date": "2026-06-01"})
        await schema.handler(params)

    assert call_count == 0
    assert len(results) == 1
    assert "error" in results[0]


@pytest.mark.asyncio
async def test_resolved_service_id_is_sent_to_the_api_never_the_name() -> None:
    seen: dict[str, str] = {}

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={"status": "ok", "slots": ["09:00"]})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_check_availability_schema(api_client, ORG_ID, [_HAIRCUT])
        assert schema.handler is not None
        params, _ = _make_params({"service_name": "haircut", "date": "2026-06-01"})
        await schema.handler(params)

    assert seen["serviceId"] == _HAIRCUT.id
    assert "haircut" not in seen.values()


@pytest.mark.asyncio
async def test_organization_id_is_bound_never_from_arguments() -> None:
    seen_paths: list[str] = []

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        return httpx.Response(200, json={"status": "ok", "slots": []})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_check_availability_schema(api_client, ORG_ID, [_HAIRCUT])
        assert schema.handler is not None
        params, _ = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "organizationId": "99999999-9999-9999-9999-999999999999",
                "organization_id": "88888888-8888-8888-8888-888888888888",
            }
        )
        await schema.handler(params)

    assert seen_paths == [f"/internal/v1/organizations/{ORG_ID}/appointments/availability"]


@pytest.mark.asyncio
async def test_successful_availability_returns_available_times() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "ok", "slots": ["09:00", "09:15"]})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_check_availability_schema(api_client, ORG_ID, [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params({"service_name": "Haircut", "date": "2026-06-01"})
        await schema.handler(params)

    assert results == [{"available_times": ["09:00", "09:15"]}]


@pytest.mark.asyncio
async def test_requested_time_unavailable_returns_alternatives() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "status": "ok",
                "slots": ["09:00"],
                "requestedTimeAvailable": False,
                "alternatives": ["09:00"],
            },
        )

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_check_availability_schema(api_client, ORG_ID, [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {"service_name": "Haircut", "date": "2026-06-01", "time": "10:00"}
        )
        await schema.handler(params)

    assert results == [
        {"available_times": ["09:00"], "requested_time_available": False, "alternatives": ["09:00"]}
    ]


@pytest.mark.asyncio
async def test_calendar_not_connected_returns_structured_error() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "calendar_not_connected"})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_check_availability_schema(api_client, ORG_ID, [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params({"service_name": "Haircut", "date": "2026-06-01"})
        await schema.handler(params)

    assert len(results) == 1
    assert "error" in results[0]


@pytest.mark.asyncio
async def test_calendar_unavailable_returns_structured_error() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "calendar_unavailable"})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_check_availability_schema(api_client, ORG_ID, [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params({"service_name": "Haircut", "date": "2026-06-01"})
        await schema.handler(params)

    assert len(results) == 1
    assert "error" in results[0]


@pytest.mark.asyncio
async def test_api_client_error_delivers_structured_result_instead_of_raising() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Service not found."})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_check_availability_schema(api_client, ORG_ID, [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params({"service_name": "Haircut", "date": "2026-06-01"})
        # Must not raise -- a tool failure should never take down the session.
        await schema.handler(params)

    assert len(results) == 1
    assert "error" in results[0]
