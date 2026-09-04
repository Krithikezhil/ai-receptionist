"""Unit tests for clients/api_client.py against a mocked HTTP transport —
no real network, no real apps/api instance needed.
"""

from __future__ import annotations

import httpx
import pytest

from voice_agent.clients.api_client import (
    ApiClient,
    ApiConfigurationError,
    ApiForbiddenError,
    ApiNotFoundError,
    ApiUnauthorizedError,
    ApiUnreachableError,
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
