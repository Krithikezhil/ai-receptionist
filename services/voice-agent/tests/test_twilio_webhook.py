"""Tests for POST /twilio/voice (routes/twilio.py + twilio/webhook.py).

apps/api's internal phone-lookup endpoint is mocked via respx at the HTTP
transport layer (same pattern as tests/test_session.py's
_mock_runtime_context()) -- lookup_organization_by_phone_number itself is
never monkeypatched, so these tests exercise the real HTTP call path
end-to-end against a mocked network, not a mocked function. No real
Twilio account, no real apps/api instance, no network.
"""

from __future__ import annotations

import hashlib
import hmac
from base64 import b64encode
from typing import Any
from urllib.parse import quote

import httpx
import pytest
import respx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from voice_agent.config import Settings
from voice_agent.routes.twilio import create_twilio_router

AUTH_TOKEN = "test-twilio-auth-token"  # noqa: S105
PUBLIC_BASE_URL = "https://voice.example.com"
CANONICAL_URL = f"{PUBLIC_BASE_URL}/twilio/voice"
API_BASE_URL = "http://internal-api.test"
ORG_ID = "11111111-1111-1111-1111-111111111111"
CALL_SID = "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
TO_NUMBER = "+15551234567"
FROM_NUMBER = "+15559998888"


def _settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = dict(
        env="test",
        port=8000,
        log_level="info",
        api_base_url=API_BASE_URL,
        internal_service_key="test-internal-key",
        stt_provider="fake",
        llm_provider="fake",
        tts_provider="fake",
        deepgram_model="nova-3-general",
        openai_model="gpt-4.1",
        idle_timeout_secs=45.0,
        twilio_auth_token=AUTH_TOKEN,
        voice_agent_public_base_url=PUBLIC_BASE_URL,
    )
    base.update(overrides)
    return Settings(**base)


def _sign(url: str, params: dict[str, str], auth_token: str) -> str:
    concatenated = url + "".join(f"{key}{params[key]}" for key in sorted(params))
    digest = hmac.new(auth_token.encode(), concatenated.encode(), hashlib.sha1).digest()
    return b64encode(digest).decode()


def _client(settings: Settings) -> TestClient:
    app = FastAPI()
    app.include_router(create_twilio_router(settings))
    return TestClient(app)


def _form_params(**overrides: str) -> dict[str, str]:
    base = {"CallSid": CALL_SID, "To": TO_NUMBER, "From": FROM_NUMBER}
    base.update(overrides)
    return base


def _phone_lookup_path() -> str:
    return f"/internal/v1/twilio/phone-numbers/{quote(TO_NUMBER, safe='')}"


def test_valid_signature_and_found_number_returns_stream_twiml() -> None:
    params = _form_params()
    signature = _sign(CANONICAL_URL, params, AUTH_TOKEN)

    with respx.mock(base_url=API_BASE_URL) as mock:
        mock.get(_phone_lookup_path(), params={"callSid": CALL_SID}).mock(
            return_value=httpx.Response(
                200, json={"organizationId": ORG_ID, "callCredential": "signed-cred"}
            )
        )
        response = _client(_settings()).post(
            "/twilio/voice", data=params, headers={"X-Twilio-Signature": signature}
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/xml")
    body = response.text
    assert "<Connect>" in body
    assert "wss://voice.example.com/twilio/media-stream" in body
    assert f'name="organization_id" value="{ORG_ID}"' in body
    assert 'name="call_credential" value="signed-cred"' in body


def test_invalid_signature_returns_403_and_never_calls_apps_api() -> None:
    params = _form_params()

    # assert_all_called=False -- this test's whole point is proving the
    # registered route is NEVER called (see the explicit call_count == 0
    # assertion below); respx's own default exit-time check would
    # otherwise fail for exactly the outcome being verified.
    with respx.mock(base_url=API_BASE_URL, assert_all_called=False) as mock:
        route = mock.get(_phone_lookup_path())
        response = _client(_settings()).post(
            "/twilio/voice", data=params, headers={"X-Twilio-Signature": "wrong-signature"}
        )
        assert route.call_count == 0

    assert response.status_code == 403


def test_missing_signature_header_returns_403() -> None:
    response = _client(_settings()).post("/twilio/voice", data=_form_params())
    assert response.status_code == 403


def test_tampered_form_param_after_signing_returns_403() -> None:
    params = _form_params()
    signature = _sign(CANONICAL_URL, params, AUTH_TOKEN)
    tampered = {**params, "To": "+19998887777"}

    response = _client(_settings()).post(
        "/twilio/voice", data=tampered, headers={"X-Twilio-Signature": signature}
    )
    assert response.status_code == 403


def test_number_not_mapped_returns_generic_failure_twiml_not_a_500() -> None:
    params = _form_params()
    signature = _sign(CANONICAL_URL, params, AUTH_TOKEN)

    with respx.mock(base_url=API_BASE_URL) as mock:
        mock.get(_phone_lookup_path(), params={"callSid": CALL_SID}).mock(
            return_value=httpx.Response(404, json={"error": "No organization is mapped."})
        )
        response = _client(_settings()).post(
            "/twilio/voice", data=params, headers={"X-Twilio-Signature": signature}
        )

    assert response.status_code == 200
    assert "<Hangup/>" in response.text
    assert "<Connect>" not in response.text


def test_apps_api_unreachable_returns_generic_failure_twiml_not_a_500() -> None:
    params = _form_params()
    signature = _sign(CANONICAL_URL, params, AUTH_TOKEN)

    with respx.mock(base_url=API_BASE_URL) as mock:
        mock.get(_phone_lookup_path(), params={"callSid": CALL_SID}).mock(
            side_effect=httpx.ConnectError("connection refused")
        )
        response = _client(_settings()).post(
            "/twilio/voice", data=params, headers={"X-Twilio-Signature": signature}
        )

    assert response.status_code == 200
    assert "<Hangup/>" in response.text


def test_misconfigured_service_returns_403_without_attempting_a_lookup() -> None:
    params = _form_params()
    signature = _sign(CANONICAL_URL, params, AUTH_TOKEN)

    # assert_all_called=False -- see the comment on the analogous test
    # above; the explicit call_count == 0 assertion below is the real
    # verification.
    with respx.mock(base_url=API_BASE_URL, assert_all_called=False) as mock:
        route = mock.get(_phone_lookup_path())
        response = _client(_settings(twilio_auth_token=None)).post(
            "/twilio/voice", data=params, headers={"X-Twilio-Signature": signature}
        )
        assert route.call_count == 0

    assert response.status_code == 403


def test_missing_call_sid_in_a_validly_signed_request_returns_failure_twiml() -> None:
    params = {"To": TO_NUMBER, "From": FROM_NUMBER}  # no CallSid at all
    signature = _sign(CANONICAL_URL, params, AUTH_TOKEN)

    # assert_all_called=False -- see the comment on the analogous test
    # above; the explicit call_count == 0 assertion below is the real
    # verification.
    with respx.mock(base_url=API_BASE_URL, assert_all_called=False) as mock:
        route = mock.get(url__startswith=f"{API_BASE_URL}/internal/v1/twilio/phone-numbers/")
        response = _client(_settings()).post(
            "/twilio/voice", data=params, headers={"X-Twilio-Signature": signature}
        )
        assert route.call_count == 0

    assert response.status_code == 200
    assert "<Hangup/>" in response.text


def test_never_logs_the_dialed_phone_number(caplog: pytest.LogCaptureFixture) -> None:
    params = _form_params()
    signature = _sign(CANONICAL_URL, params, AUTH_TOKEN)

    with respx.mock(base_url=API_BASE_URL) as mock:
        mock.get(_phone_lookup_path(), params={"callSid": CALL_SID}).mock(
            return_value=httpx.Response(404, json={"error": "No organization is mapped."})
        )
        with caplog.at_level("DEBUG"):
            response = _client(_settings()).post(
                "/twilio/voice", data=params, headers={"X-Twilio-Signature": signature}
            )

    assert response.status_code == 200
    logged_text = " ".join(r.message for r in caplog.records)
    assert TO_NUMBER not in logged_text
    assert AUTH_TOKEN not in logged_text
