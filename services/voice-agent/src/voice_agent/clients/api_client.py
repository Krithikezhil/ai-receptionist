"""Typed HTTP client for apps/api's internal voice API (/internal/v1/*).

Sends two independent credentials, mirroring the server's two-stage check:
`Authorization: Bearer <key>` (the global INTERNAL_SERVICE_KEY — proves this
process is a trusted internal service at all; see
apps/api/src/middleware/require-service-auth.ts) and
`X-Organization-Service-Token: <token>` (the per-organization token — proves
this specific call is authorized for the requested organization; see
apps/api/src/middleware/require-organization-service-token.ts). Neither
alone is sufficient. Raises typed exceptions rather than letting raw httpx
errors propagate, so callers (the pipeline, tools) can handle each failure
mode deliberately. See ARCHITECTURE.md "Internal voice API" and
SECURITY.md "Failure handling".
"""

from __future__ import annotations

from types import TracebackType
from typing import Any
from urllib.parse import quote

import httpx

from voice_agent.clients.models import KnowledgeEntry, PhoneNumberLookup, RuntimeContext


class ApiClientError(Exception):
    """Base class for all internal-API client errors."""


class ApiConfigurationError(ApiClientError):
    """INTERNAL_SERVICE_KEY or the organization service token is not
    configured — fails closed rather than silently sending an
    unauthenticated/unauthorized request."""


class ApiUnauthorizedError(ApiClientError):
    """The configured INTERNAL_SERVICE_KEY was rejected (401) — this
    process is not recognized as a trusted internal service at all."""


class ApiForbiddenError(ApiClientError):
    """The global service credential was valid, but the organization
    service token does not authorize the requested organization (403) —
    e.g. a token for a different organization, or none at all."""


class ApiNotFoundError(ApiClientError):
    """The requested organization does not exist (404)."""


class ApiUnreachableError(ApiClientError):
    """apps/api could not be reached at all (connection/timeout error)."""


class ApiClient:
    """Async client for GET /internal/v1/organizations/:id/{runtime-context,knowledge}.

    `transport` exists purely so tests can inject an in-process mock
    transport (e.g. respx or httpx.MockTransport) instead of opening a real
    socket — see tests/test_api_client.py.
    """

    def __init__(
        self,
        base_url: str,
        internal_service_key: str | None,
        organization_service_token: str | None,
        *,
        timeout: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not internal_service_key:
            raise ApiConfigurationError(
                "INTERNAL_SERVICE_KEY is not set — cannot call the internal voice API."
            )
        if not organization_service_token:
            raise ApiConfigurationError(
                "organization_service_token is not set — cannot call the internal voice API "
                "without proving which organization this session is authorized for."
            )
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={
                "Authorization": f"Bearer {internal_service_key}",
                "X-Organization-Service-Token": organization_service_token,
            },
            timeout=timeout,
            transport=transport,
        )

    async def __aenter__(self) -> ApiClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def get_runtime_context(self, organization_id: str) -> RuntimeContext:
        data = await self._get(f"/internal/v1/organizations/{organization_id}/runtime-context")
        return RuntimeContext.model_validate(data["runtimeContext"])

    async def search_knowledge(
        self,
        organization_id: str,
        *,
        query: str | None = None,
        category: str | None = None,
    ) -> list[KnowledgeEntry]:
        params: dict[str, str] = {}
        if query:
            params["q"] = query
        if category:
            params["category"] = category
        data = await self._get(
            f"/internal/v1/organizations/{organization_id}/knowledge", params=params
        )
        return [KnowledgeEntry.model_validate(entry) for entry in data["knowledge"]]

    async def _get(self, path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
        try:
            response = await self._client.get(path, params=params)
        except httpx.RequestError as exc:
            raise ApiUnreachableError(f"Could not reach apps/api at {path}: {exc}") from exc

        if response.status_code == 401:
            raise ApiUnauthorizedError("apps/api rejected the internal service credential.")
        if response.status_code == 403:
            raise ApiForbiddenError(
                "apps/api rejected the organization service token for this organization."
            )
        if response.status_code == 404:
            raise ApiNotFoundError(f"Organization not found (requested {path}).")

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ApiClientError(f"apps/api returned {response.status_code} for {path}.") from exc

        result: dict[str, Any] = response.json()
        return result


async def lookup_organization_by_phone_number(
    base_url: str,
    internal_service_key: str | None,
    phone_number: str,
    call_sid: str,
    *,
    timeout: float = 10.0,
    transport: httpx.AsyncBaseTransport | None = None,
) -> PhoneNumberLookup:
    """Calls GET /internal/v1/twilio/phone-numbers/:phoneNumber to resolve
    which organization a dialed Twilio number belongs to, and receive a
    freshly minted call credential for it (see
    apps/api/src/controllers/internal.controller.ts's lookupPhoneNumber).

    Deliberately NOT a method on ApiClient: that class is inherently
    org-scoped from construction (it always sends both INTERNAL_SERVICE_KEY
    and an organization service token -- see __init__'s fail-closed checks
    above, which this function does not touch or weaken). This call
    happens BEFORE any organization is known at all, guarded by
    requireServiceAuth only (see internal.routes.ts), so it has no
    organization-scoped token to send. See the approved M7 plan section 12.
    """
    if not internal_service_key:
        raise ApiConfigurationError(
            "INTERNAL_SERVICE_KEY is not set — cannot call the internal voice API."
        )

    path = f"/internal/v1/twilio/phone-numbers/{quote(phone_number, safe='')}"

    async with httpx.AsyncClient(
        base_url=base_url,
        headers={"Authorization": f"Bearer {internal_service_key}"},
        timeout=timeout,
        transport=transport,
    ) as client:
        try:
            response = await client.get(path, params={"callSid": call_sid})
        except httpx.RequestError as exc:
            raise ApiUnreachableError(
                f"Could not reach apps/api for the phone-number lookup: {exc}"
            ) from exc

        if response.status_code == 401:
            raise ApiUnauthorizedError("apps/api rejected the internal service credential.")
        if response.status_code == 404:
            raise ApiNotFoundError("No organization is mapped to this phone number.")

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ApiClientError(
                f"apps/api returned {response.status_code} for the phone-number lookup."
            ) from exc

        return PhoneNumberLookup.model_validate(response.json())
