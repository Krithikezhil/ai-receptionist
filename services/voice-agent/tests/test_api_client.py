"""Unit tests for clients/api_client.py against a mocked HTTP transport —
no real network, no real apps/api instance needed.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta, timezone

import httpx
import pytest

from voice_agent.clients.api_client import (
    ApiClient,
    ApiClientError,
    ApiConfigurationError,
    ApiForbiddenError,
    ApiNotFoundError,
    ApiUnauthorizedError,
    ApiUnreachableError,
    lookup_organization_by_phone_number,
)

ORG_ID = "11111111-1111-1111-1111-111111111111"
ORG_TOKEN = "test-org-token"


def test_missing_internal_service_key_fails_closed() -> None:
    with pytest.raises(ApiConfigurationError):
        ApiClient("http://internal-api.test", None, ORG_TOKEN)
    with pytest.raises(ApiConfigurationError):
        ApiClient("http://internal-api.test", "", ORG_TOKEN)


def test_missing_organization_service_token_fails_closed() -> None:
    with pytest.raises(ApiConfigurationError):
        ApiClient("http://internal-api.test", "test-key", None)
    with pytest.raises(ApiConfigurationError):
        ApiClient("http://internal-api.test", "test-key", "")


@pytest.mark.asyncio
async def test_get_runtime_context_parses_camelcase_json_into_the_model() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-key"
        return httpx.Response(
            200,
            json={
                "runtimeContext": {
                    "organizationId": ORG_ID,
                    "receptionistConfig": {
                        "enabled": True,
                        "displayName": "AI Receptionist",
                        "greeting": "Hi!",
                        "tone": "friendly",
                        "instructions": "",
                        "fallbackMessage": "Let me get someone.",
                        "afterHoursMessage": "We're closed.",
                        "callTransferEnabled": False,
                        "callTransferPhone": None,
                        "language": "en",
                    },
                    "businessProfile": {
                        "businessName": "Acme Dental",
                        "description": None,
                        "phone": None,
                        "email": None,
                        "website": None,
                        "address": None,
                        "timezone": "UTC",
                    },
                    "businessHours": [
                        {"dayOfWeek": 1, "isOpen": True, "openTime": "09:00", "closeTime": "17:00"}
                    ],
                    "services": [],
                }
            },
        )

    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(handler),
    ) as client:
        context = await client.get_runtime_context(ORG_ID)

    assert context.organization_id == ORG_ID
    assert context.receptionist_config.display_name == "AI Receptionist"
    assert context.business_profile is not None
    assert context.business_profile.business_name == "Acme Dental"
    assert context.business_hours[0].day_of_week == 1


@pytest.mark.asyncio
async def test_search_knowledge_sends_query_and_category_params() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={"knowledge": []})

    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(handler),
    ) as client:
        await client.search_knowledge(ORG_ID, query="parking", category="faq")

    assert seen == {"q": "parking", "category": "faq"}


@pytest.mark.asyncio
async def test_create_lead_sends_only_the_provided_fields() -> None:
    seen_body: dict[str, object] = {}
    seen_path = ""

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_path
        seen_path = request.url.path
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"lead": {"id": "lead-1"}})

    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(handler),
    ) as client:
        await client.create_lead(ORG_ID, contact_name="Jane Caller", intent="Wants a quote")

    assert seen_path == f"/internal/v1/organizations/{ORG_ID}/leads"
    assert seen_body == {"contactName": "Jane Caller", "intent": "Wants a quote"}


@pytest.mark.asyncio
async def test_create_lead_omits_fields_that_were_not_provided() -> None:
    seen_body: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"lead": {"id": "lead-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        await client.create_lead(ORG_ID, contact_phone="555-1234")

    assert seen_body == {"contactPhone": "555-1234"}


@pytest.mark.asyncio
async def test_create_lead_403_raises_api_forbidden_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "Not authorized for this organization."})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ApiForbiddenError):
            await client.create_lead(ORG_ID, contact_name="Jane Caller")


@pytest.mark.asyncio
async def test_create_lead_400_raises_generic_api_client_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "Invalid lead data."})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ApiClientError):
            await client.create_lead(ORG_ID)


@pytest.mark.asyncio
async def test_create_lead_unreachable_server_raises_api_unreachable_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ApiUnreachableError):
            await client.create_lead(ORG_ID, contact_name="Jane Caller")


@pytest.mark.asyncio
async def test_record_call_sends_expected_path_and_all_five_fields() -> None:
    seen_body: dict[str, object] = {}
    seen_path = ""

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_path
        seen_path = request.url.path
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"call": {"id": "call-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        await client.record_call(
            ORG_ID,
            call_sid="CA-test-1",
            started_at=datetime(2026, 1, 2, 3, 4, 5, 123000, tzinfo=UTC),
            ended_at=datetime(2026, 1, 2, 3, 5, 5, 123000, tzinfo=UTC),
            disposition="completed",
            summary="Caller asked about hours.",
        )

    assert seen_path == f"/internal/v1/organizations/{ORG_ID}/calls"
    assert seen_body == {
        "callSid": "CA-test-1",
        "startedAt": "2026-01-02T03:04:05.123Z",
        "endedAt": "2026-01-02T03:05:05.123Z",
        "disposition": "completed",
        "summary": "Caller asked about hours.",
    }


@pytest.mark.asyncio
async def test_record_call_sends_explicit_null_when_summary_is_none() -> None:
    seen_body: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"call": {"id": "call-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        await client.record_call(
            ORG_ID,
            call_sid="CA-test-2",
            started_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
            ended_at=datetime(2026, 1, 2, 3, 5, 5, tzinfo=UTC),
            disposition="completed",
            summary=None,
        )

    # Distinct from a merely-absent key: dict.get("summary") would also be
    # None if the key were omitted, so the membership check is what actually
    # proves the field was sent as JSON null rather than left out entirely.
    assert "summary" in seen_body
    assert seen_body["summary"] is None


@pytest.mark.asyncio
async def test_record_call_formats_utc_datetime_with_millisecond_precision_and_z_suffix() -> None:
    seen_body: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"call": {"id": "call-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        await client.record_call(
            ORG_ID,
            call_sid="CA-test-3",
            started_at=datetime(2026, 1, 2, 3, 4, 5, 123000, tzinfo=UTC),
            ended_at=datetime(2026, 1, 2, 3, 4, 5, 123000, tzinfo=UTC),
            disposition="completed",
        )

    assert seen_body["startedAt"] == "2026-01-02T03:04:05.123Z"
    assert seen_body["endedAt"] == "2026-01-02T03:04:05.123Z"


@pytest.mark.asyncio
async def test_record_call_converts_non_utc_offset_to_utc() -> None:
    seen_body: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"call": {"id": "call-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        await client.record_call(
            ORG_ID,
            call_sid="CA-test-4",
            # 2026-01-02T03:04:05.123 at -05:00 is 2026-01-02T08:04:05.123Z.
            started_at=datetime(2026, 1, 2, 3, 4, 5, 123000, tzinfo=timezone(timedelta(hours=-5))),
            ended_at=datetime(2026, 1, 2, 3, 4, 5, 123000, tzinfo=timezone(timedelta(hours=-5))),
            disposition="completed",
        )

    assert seen_body["startedAt"] == "2026-01-02T08:04:05.123Z"
    assert seen_body["endedAt"] == "2026-01-02T08:04:05.123Z"


@pytest.mark.asyncio
async def test_record_call_naive_datetime_raises_value_error_without_sending_a_request() -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(201, json={"call": {"id": "call-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ValueError):
            await client.record_call(
                ORG_ID,
                call_sid="CA-test-5",
                started_at=datetime(2026, 1, 2, 3, 4, 5),  # naive -- no tzinfo
                ended_at=datetime(2026, 1, 2, 3, 5, 5, tzinfo=UTC),
                disposition="completed",
            )

    assert called is False


@pytest.mark.asyncio
@pytest.mark.parametrize("disposition", ["completed", "failed", "abandoned"])
async def test_record_call_accepts_all_three_dispositions(disposition: str) -> None:
    seen_body: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_body.update(json.loads(request.content))
        return httpx.Response(201, json={"call": {"id": "call-1"}})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        await client.record_call(
            ORG_ID,
            call_sid="CA-disposition-test",
            started_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
            ended_at=datetime(2026, 1, 2, 3, 5, 5, tzinfo=UTC),
            disposition=disposition,  # type: ignore[arg-type]
        )

    assert seen_body["disposition"] == disposition


@pytest.mark.asyncio
async def test_record_call_403_raises_api_forbidden_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "Not authorized for this organization."})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ApiForbiddenError):
            await client.record_call(
                ORG_ID,
                call_sid="CA-test-7",
                started_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
                ended_at=datetime(2026, 1, 2, 3, 5, 5, tzinfo=UTC),
                disposition="completed",
            )


@pytest.mark.asyncio
async def test_401_raises_api_unauthorized_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "Not authenticated."})

    async with ApiClient(
        "http://internal-api.test",
        "wrong-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(handler),
    ) as client:
        with pytest.raises(ApiUnauthorizedError):
            await client.get_runtime_context(ORG_ID)


@pytest.mark.asyncio
async def test_403_raises_api_forbidden_error() -> None:
    # A valid global key but an organization token that does not authorize ORG_ID (e.g. it
    # belongs to a different organization) — apps/api's requireOrganizationServiceToken
    # rejects this with 403, distinct from a 401 (bad global key) or 404 (no such org).
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "Not authorized for this organization."})

    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(handler),
    ) as client:
        with pytest.raises(ApiForbiddenError):
            await client.get_runtime_context(ORG_ID)


@pytest.mark.asyncio
async def test_404_raises_api_not_found_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "Organization not found."})

    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(handler),
    ) as client:
        with pytest.raises(ApiNotFoundError):
            await client.get_runtime_context(ORG_ID)


@pytest.mark.asyncio
async def test_unreachable_server_raises_api_unreachable_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    async with ApiClient(
        "http://internal-api.test",
        "test-key",
        ORG_TOKEN,
        transport=httpx.MockTransport(handler),
    ) as client:
        with pytest.raises(ApiUnreachableError):
            await client.get_runtime_context(ORG_ID)


@pytest.mark.asyncio
async def test_phone_number_lookup_sends_only_the_service_key_and_call_sid() -> None:
    """No X-Organization-Service-Token is ever sent here -- this call is
    what resolves which organization a call belongs to, before any
    organization-scoped credential exists (see the approved M7 plan
    section 12)."""
    seen_headers: dict[str, str] = {}
    seen_path = ""
    seen_params: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_path
        seen_headers.update(dict(request.headers))
        seen_path = request.url.path
        seen_params.update(dict(request.url.params))
        return httpx.Response(
            200, json={"organizationId": ORG_ID, "callCredential": "signed-credential-value"}
        )

    result = await lookup_organization_by_phone_number(
        "http://internal-api.test",
        "test-key",
        "+15551234567",
        "CA123",
        transport=httpx.MockTransport(handler),
    )

    assert result.organization_id == ORG_ID
    assert result.call_credential == "signed-credential-value"
    assert seen_headers["authorization"] == "Bearer test-key"
    assert "x-organization-service-token" not in seen_headers
    assert seen_path == "/internal/v1/twilio/phone-numbers/+15551234567"
    assert seen_params == {"callSid": "CA123"}


@pytest.mark.asyncio
async def test_phone_number_lookup_missing_internal_service_key_fails_closed() -> None:
    with pytest.raises(ApiConfigurationError):
        await lookup_organization_by_phone_number(
            "http://internal-api.test", None, "+15551234567", "CA123"
        )
    with pytest.raises(ApiConfigurationError):
        await lookup_organization_by_phone_number(
            "http://internal-api.test", "", "+15551234567", "CA123"
        )


@pytest.mark.asyncio
async def test_phone_number_lookup_401_raises_api_unauthorized_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "Not authenticated."})

    with pytest.raises(ApiUnauthorizedError):
        await lookup_organization_by_phone_number(
            "http://internal-api.test",
            "wrong-key",
            "+15551234567",
            "CA123",
            transport=httpx.MockTransport(handler),
        )


@pytest.mark.asyncio
async def test_phone_number_lookup_404_raises_api_not_found_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            404, json={"error": "No organization is mapped to this phone number."}
        )

    with pytest.raises(ApiNotFoundError):
        await lookup_organization_by_phone_number(
            "http://internal-api.test",
            "test-key",
            "+19998887777",
            "CA123",
            transport=httpx.MockTransport(handler),
        )


@pytest.mark.asyncio
async def test_phone_number_lookup_unreachable_server_raises_api_unreachable_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(ApiUnreachableError):
        await lookup_organization_by_phone_number(
            "http://internal-api.test",
            "test-key",
            "+15551234567",
            "CA123",
            transport=httpx.MockTransport(handler),
        )


@pytest.mark.asyncio
async def test_phone_number_lookup_unexpected_status_raises_generic_api_client_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "Internal server error."})

    with pytest.raises(ApiClientError):
        await lookup_organization_by_phone_number(
            "http://internal-api.test",
            "test-key",
            "+15551234567",
            "CA123",
            transport=httpx.MockTransport(handler),
        )


@pytest.mark.asyncio
async def test_check_availability_sends_service_id_date_and_optional_time() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={"status": "ok", "slots": ["09:00", "09:15"]})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        result = await client.check_availability(
            ORG_ID, service_id="service-1", date="2026-06-01", time="09:00"
        )

    assert seen == {"serviceId": "service-1", "date": "2026-06-01", "time": "09:00"}
    assert result.status == "ok"
    assert result.slots == ["09:00", "09:15"]


@pytest.mark.asyncio
async def test_check_availability_omits_time_when_not_given() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={"status": "ok", "slots": []})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        await client.check_availability(ORG_ID, service_id="service-1", date="2026-06-01")

    assert seen == {"serviceId": "service-1", "date": "2026-06-01"}


@pytest.mark.asyncio
async def test_check_availability_parses_calendar_not_connected() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "calendar_not_connected"})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        result = await client.check_availability(ORG_ID, service_id="service-1", date="2026-06-01")

    assert result.status == "calendar_not_connected"
    assert result.slots == []


@pytest.mark.asyncio
async def test_check_availability_parses_requested_time_available_and_alternatives() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "status": "ok",
                "slots": ["09:00"],
                "requestedTimeAvailable": False,
                "alternatives": ["09:00", "09:15"],
            },
        )

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        result = await client.check_availability(
            ORG_ID, service_id="service-1", date="2026-06-01", time="10:00"
        )

    assert result.requested_time_available is False
    assert result.alternatives == ["09:00", "09:15"]


@pytest.mark.asyncio
async def test_book_appointment_sends_only_provided_fields() -> None:
    seen_body: dict[str, object] = {}
    seen_path = ""

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen_path
        seen_path = request.url.path
        seen_body.update(json.loads(request.content))
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

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        result = await client.book_appointment(
            ORG_ID,
            service_id="service-1",
            date="2026-06-01",
            time="09:00",
            customer_name="Jane Caller",
        )

    assert seen_path == f"/internal/v1/organizations/{ORG_ID}/appointments"
    assert seen_body == {
        "serviceId": "service-1",
        "date": "2026-06-01",
        "time": "09:00",
        "customerName": "Jane Caller",
    }
    assert result.status == "booked"
    assert result.appointment is not None
    assert result.appointment.start_time == "2026-06-01T09:00:00.000Z"
    assert result.appointment.end_time == "2026-06-01T09:30:00.000Z"


@pytest.mark.asyncio
async def test_book_appointment_normalizes_the_asymmetric_booked_response() -> None:
    """apps/api returns {"appointment": {...}} with no top-level "status" for
    a successful booking, unlike every other outcome -- this must be
    normalized into a consistent BookAppointmentResult(status="booked", ...)."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            201,
            json={
                "appointment": {
                    "id": "appt-1",
                    "customerName": "Jane Caller",
                    "startTime": "2026-06-01T09:00:00.000Z",
                    "endTime": "2026-06-01T09:30:00.000Z",
                }
            },
        )

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        result = await client.book_appointment(
            ORG_ID,
            service_id="service-1",
            date="2026-06-01",
            time="09:00",
            customer_name="Jane Caller",
        )

    assert result.status == "booked"
    # Only start_time/end_time are surfaced -- customerName etc. are silently
    # ignored by BookedAppointmentSummary, keeping the LLM-facing surface minimal.
    assert result.appointment is not None


@pytest.mark.asyncio
async def test_book_appointment_409_unavailable_returns_alternatives() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409, json={"status": "unavailable", "alternatives": ["10:00", "10:15"]}
        )

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        result = await client.book_appointment(
            ORG_ID, service_id="service-1", date="2026-06-01", time="09:00", customer_name="Jane"
        )

    assert result.status == "unavailable"
    assert result.alternatives == ["10:00", "10:15"]


@pytest.mark.asyncio
async def test_book_appointment_409_duplicate_booking_does_not_raise() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"status": "duplicate_booking"})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        result = await client.book_appointment(
            ORG_ID, service_id="service-1", date="2026-06-01", time="09:00", customer_name="Jane"
        )

    assert result.status == "duplicate_booking"


@pytest.mark.asyncio
async def test_book_appointment_400_still_raises_generic_api_client_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "Invalid appointment data."})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ApiClientError):
            await client.book_appointment(
                ORG_ID,
                service_id="service-1",
                date="2026-06-01",
                time="09:00",
                customer_name="Jane",
            )


@pytest.mark.asyncio
async def test_book_appointment_500_still_raises_generic_api_client_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "Failed to complete the booking."})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ApiClientError):
            await client.book_appointment(
                ORG_ID,
                service_id="service-1",
                date="2026-06-01",
                time="09:00",
                customer_name="Jane",
            )


@pytest.mark.asyncio
async def test_create_lead_409_still_raises_generic_api_client_error() -> None:
    """Proves the new ok_statuses parameter on _post() defaults to empty and
    leaves every OTHER existing caller's behavior completely unchanged --
    create_lead never opts a 409 out of the default raise-on-non-2xx path."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error": "conflict"})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ApiClientError):
            await client.create_lead(ORG_ID, contact_name="Jane Caller")


@pytest.mark.asyncio
async def test_book_appointment_403_raises_api_forbidden_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "Not authorized for this organization."})

    async with ApiClient(
        "http://internal-api.test", "test-key", ORG_TOKEN, transport=httpx.MockTransport(handler)
    ) as client:
        with pytest.raises(ApiForbiddenError):
            await client.book_appointment(
                ORG_ID,
                service_id="service-1",
                date="2026-06-01",
                time="09:00",
                customer_name="Jane",
            )
