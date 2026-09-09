"""Direct unit tests for tools/book_appointment.py's handler logic,
isolated from the full LLM/pipeline machinery -- mirrors
tests/test_capture_lead_tool.py's own structure.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from pipecat.services.llm_service import FunctionCallParams

from voice_agent.clients.api_client import ApiClient
from voice_agent.clients.models import ServiceItem
from voice_agent.tools.book_appointment import (
    BOOK_APPOINTMENT_FUNCTION_NAME,
    build_book_appointment_schema,
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


def _make_params(arguments: dict[str, Any]) -> tuple[FunctionCallParams, list[Any]]:
    results: list[Any] = []

    async def result_callback(result: Any, *, properties: Any = None) -> None:
        results.append(result)

    params = FunctionCallParams(
        function_name=BOOK_APPOINTMENT_FUNCTION_NAME,
        tool_call_id="test-call-id",
        arguments=arguments,
        llm=None,  # type: ignore[arg-type]
        pipeline_worker=None,  # type: ignore[arg-type]
        context=None,  # type: ignore[arg-type]
        result_callback=result_callback,
    )
    return params, results


def _booked_response() -> httpx.Response:
    return httpx.Response(
        201,
        json={
            "appointment": {
                "id": "appt-1",
                "startTime": "2026-06-01T09:00:00.000Z",
                "endTime": "2026-06-01T09:30:00.000Z",
            }
        },
    )


@pytest.mark.asyncio
async def test_unknown_service_name_returns_structured_error_with_zero_api_calls() -> None:
    call_count = 0

    def handler_fn(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return _booked_response()

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {
                "service_name": "Massage",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
            }
        )
        await schema.handler(params)

    assert call_count == 0
    assert len(results) == 1
    assert "error" in results[0]


@pytest.mark.asyncio
async def test_missing_customer_name_and_phone_returns_error_zero_calls() -> None:
    call_count = 0

    def handler_fn(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return _booked_response()

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {"service_name": "Haircut", "date": "2026-06-01", "time": "09:00"}
        )
        await schema.handler(params)

    assert call_count == 0
    assert len(results) == 1
    assert "error" in results[0]


@pytest.mark.asyncio
async def test_customer_phone_alone_is_sufficient() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return _booked_response()

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_phone": "555-1234",
            }
        )
        await schema.handler(params)

    assert results == [{"booked": True}]


@pytest.mark.asyncio
async def test_resolved_service_id_is_sent_to_the_api_never_the_name() -> None:
    seen_body: dict[str, object] = {}

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return _booked_response()

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, _ = _make_params(
            {
                "service_name": "haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
            }
        )
        await schema.handler(params)

    assert seen_body["serviceId"] == _HAIRCUT.id


@pytest.mark.asyncio
async def test_organization_id_is_bound_never_from_arguments() -> None:
    seen_paths: list[str] = []

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        return _booked_response()

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, _ = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
                "organizationId": "99999999-9999-9999-9999-999999999999",
                "organization_id": "88888888-8888-8888-8888-888888888888",
            }
        )
        await schema.handler(params)

    assert seen_paths == [f"/internal/v1/organizations/{ORG_ID}/appointments"]


@pytest.mark.asyncio
async def test_call_sid_is_bound_never_from_arguments() -> None:
    """call_sid is bound once at pipeline-build time (see pipeline.py),
    exactly like organization_id -- the LLM never supplies or overrides it
    via tool-call arguments, mirroring capture_lead's own precedent."""
    seen_body: dict[str, object] = {}

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return _booked_response()

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, _ = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
                "call_sid": "CA-spoofed",
            }
        )
        await schema.handler(params)

    assert seen_body["callSid"] == "CA123"


@pytest.mark.asyncio
async def test_call_sid_omitted_from_body_when_not_bound() -> None:
    seen_body: dict[str, object] = {}

    def handler_fn(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return _booked_response()

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, None, [_HAIRCUT])
        assert schema.handler is not None
        params, _ = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
            }
        )
        await schema.handler(params)

    assert "callSid" not in seen_body


@pytest.mark.asyncio
async def test_successful_booking_returns_booked_true() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return _booked_response()

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
            }
        )
        await schema.handler(params)

    assert results == [{"booked": True}]


@pytest.mark.asyncio
async def test_unavailable_result_includes_alternatives() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409, json={"status": "unavailable", "alternatives": ["10:00", "10:15"]}
        )

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
            }
        )
        await schema.handler(params)

    assert len(results) == 1
    assert "error" in results[0]
    assert results[0]["alternatives"] == ["10:00", "10:15"]


@pytest.mark.asyncio
async def test_unavailable_result_without_alternatives_omits_the_key() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"status": "unavailable"})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
            }
        )
        await schema.handler(params)

    assert "alternatives" not in results[0]


@pytest.mark.asyncio
async def test_duplicate_booking_returns_structured_error() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"status": "duplicate_booking"})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
            }
        )
        await schema.handler(params)

    assert len(results) == 1
    assert "error" in results[0]


@pytest.mark.asyncio
async def test_calendar_not_connected_returns_structured_error() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "calendar_not_connected"})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
            }
        )
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
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
            }
        )
        await schema.handler(params)

    assert len(results) == 1
    assert "error" in results[0]


@pytest.mark.asyncio
async def test_api_client_error_delivers_structured_result_instead_of_raising() -> None:
    def handler_fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "Invalid appointment data."})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler_fn)
    ) as api_client:
        schema = build_book_appointment_schema(api_client, ORG_ID, "CA123", [_HAIRCUT])
        assert schema.handler is not None
        params, results = _make_params(
            {
                "service_name": "Haircut",
                "date": "2026-06-01",
                "time": "09:00",
                "customer_name": "Jane Caller",
            }
        )
        # Must not raise -- a tool failure should never take down the session.
        await schema.handler(params)

    assert len(results) == 1
    assert "error" in results[0]
