"""Tests for WS /twilio/media-stream (routes/twilio.py).

session.run_session is monkeypatched at the point routes/twilio.py imports
it (same pattern as tests/test_session.py's `recorded` fixture patches
PipelineWorker/WorkerRunner) -- a real Pipecat pipeline is never started,
so these tests verify this route's own wiring: which organization_id and
credential run_session is called with, and that nothing beyond a WS
handshake + one HMAC check ever happens for an invalid connection. No real
Twilio account, no network, no real pipeline.

Every test sends a realistic two-message handshake (a "connected" event
then a "start" event) matching Twilio's real Media Streams wire protocol
-- parse_telephony_websocket() (Pipecat) always attempts to read two
messages before completing, so a test that sends only one message and
then tries to receive would deadlock: the server blocks waiting for a
second frame the client never sends, while the client blocks waiting for
a reply the server never sends until parsing completes. Sending both
messages up front lets the server finish parsing and reach its own
decision (close or proceed) without waiting on further client input.

Credentials are minted with a from-scratch reimplementation of the signing
algorithm (not by importing anything from twilio/call_credential.py's own
internals beyond what a real caller would use), matching the
interoperability-test discipline already established in
tests/test_twilio_call_credential.py.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from voice_agent.config import Settings
from voice_agent.routes.twilio import create_twilio_router

SECRET = "test-call-credential-secret"  # noqa: S105
ORG_A = "11111111-1111-1111-1111-111111111111"
ORG_B = "22222222-2222-2222-2222-222222222222"
CALL_SID = "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
STREAM_SID = "MZaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


def _settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = dict(
        env="test",
        port=8000,
        log_level="info",
        api_base_url="http://internal-api.test",
        internal_service_key="test-internal-key",
        stt_provider="fake",
        llm_provider="fake",
        tts_provider="fake",
        deepgram_model="nova-3-general",
        openai_model="gpt-4.1",
        idle_timeout_secs=45.0,
        twilio_auth_token="test-twilio-auth-token",
        voice_agent_public_base_url="https://voice.example.com",
        twilio_call_credential_secret=SECRET,
    )
    base.update(overrides)
    return Settings(**base)


def _client(settings: Settings) -> TestClient:
    app = FastAPI()
    app.include_router(create_twilio_router(settings))
    return TestClient(app)


def _mint(organization_id: str, call_sid: str, secret: str, ttl_seconds: float = 3600) -> str:
    payload = {
        "organization_id": organization_id,
        "call_sid": call_sid,
        "exp": int(time.time()) + int(ttl_seconds),
    }
    payload_b64 = (
        base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        .decode("ascii")
        .rstrip("=")
    )
    sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")
    return f"{payload_b64}.{sig_b64}"


def _connected_message() -> dict[str, Any]:
    """Twilio's real first Media Streams message -- sent before "start" on
    a genuine connection. Its exact shape doesn't matter for detection
    (it isn't Twilio-shaped by parse_telephony_websocket's own heuristic),
    it only needs to exist so the second ("start") message can be read
    without the server blocking on a message that never arrives."""
    return {"event": "connected", "protocol": "Call", "version": "1.0.0"}


def _start_message(custom_parameters: dict[str, str]) -> dict[str, Any]:
    return {
        "event": "start",
        "start": {
            "streamSid": STREAM_SID,
            "callSid": CALL_SID,
            "customParameters": custom_parameters,
        },
    }


def _send_handshake(ws: Any, custom_parameters: dict[str, str]) -> None:
    ws.send_json(_connected_message())
    ws.send_json(_start_message(custom_parameters))


@pytest.fixture
def recorded(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    async def fake_run_session(
        *, organization_id: str, organization_service_token: str, transport: Any, settings: Any
    ) -> None:
        calls.append(
            {
                "organization_id": organization_id,
                "organization_service_token": organization_service_token,
            }
        )

    monkeypatch.setattr("voice_agent.routes.twilio.run_session", fake_run_session)
    return calls


def test_valid_credential_starts_a_session_for_the_credentials_own_organization(
    recorded: list[dict[str, Any]],
) -> None:
    token = _mint(ORG_A, CALL_SID, SECRET)
    with _client(_settings()).websocket_connect("/twilio/media-stream") as ws:
        _send_handshake(ws, {"organization_id": ORG_A, "call_credential": token})

    assert recorded == [{"organization_id": ORG_A, "organization_service_token": token}]


def test_organization_a_credential_with_organization_b_metadata_uses_credential_org(
    recorded: list[dict[str, Any]],
) -> None:
    """The core adversarial case: WS metadata actively claims org B, but
    the credential is validly signed for org A. run_session must be
    called with org A -- the metadata parameter is never authoritative,
    even when it lies. See the approved M7 plan section 2."""
    token_for_org_a = _mint(ORG_A, CALL_SID, SECRET)
    with _client(_settings()).websocket_connect("/twilio/media-stream") as ws:
        _send_handshake(ws, {"organization_id": ORG_B, "call_credential": token_for_org_a})

    assert recorded == [{"organization_id": ORG_A, "organization_service_token": token_for_org_a}]


def test_missing_credential_closes_with_policy_violation_and_never_starts_a_session(
    recorded: list[dict[str, Any]],
) -> None:
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with _client(_settings()).websocket_connect("/twilio/media-stream") as ws:
            _send_handshake(ws, {})
            ws.receive_text()

    assert exc_info.value.code == 1008
    assert recorded == []


def test_expired_credential_closes_with_policy_violation_and_never_starts_a_session(
    recorded: list[dict[str, Any]],
) -> None:
    token = _mint(ORG_A, CALL_SID, SECRET, ttl_seconds=-1)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with _client(_settings()).websocket_connect("/twilio/media-stream") as ws:
            _send_handshake(ws, {"call_credential": token})
            ws.receive_text()

    assert exc_info.value.code == 1008
    assert recorded == []


def test_credential_for_a_different_call_sid_closes_and_never_starts_a_session(
    recorded: list[dict[str, Any]],
) -> None:
    """The credential is validly signed and unexpired, but for a
    different call_sid than the one Twilio's own start event carries --
    must be rejected (replay-across-calls protection)."""
    token = _mint(ORG_A, "CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", SECRET)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with _client(_settings()).websocket_connect("/twilio/media-stream") as ws:
            _send_handshake(ws, {"call_credential": token})  # real CallSid is CALL_SID
            ws.receive_text()

    assert exc_info.value.code == 1008
    assert recorded == []


def test_tampered_credential_closes_and_never_starts_a_session(
    recorded: list[dict[str, Any]],
) -> None:
    token = _mint(ORG_A, CALL_SID, SECRET)
    payload_b64, _sig = token.split(".")
    tampered = f"{payload_b64}.not-a-real-signature"

    with pytest.raises(WebSocketDisconnect) as exc_info:
        with _client(_settings()).websocket_connect("/twilio/media-stream") as ws:
            _send_handshake(ws, {"call_credential": tampered})
            ws.receive_text()

    assert exc_info.value.code == 1008
    assert recorded == []


def test_misconfigured_secret_closes_without_attempting_verification(
    recorded: list[dict[str, Any]],
) -> None:
    token = _mint(ORG_A, CALL_SID, SECRET)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with _client(_settings(twilio_call_credential_secret=None)).websocket_connect(
            "/twilio/media-stream"
        ) as ws:
            _send_handshake(ws, {"call_credential": token})
            ws.receive_text()

    assert exc_info.value.code == 1008
    assert recorded == []


def test_malformed_first_message_closes_cleanly_without_a_session(
    recorded: list[dict[str, Any]],
) -> None:
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with _client(_settings()).websocket_connect("/twilio/media-stream") as ws:
            ws.send_text("not valid json at all, not even a Twilio-shaped message")
            ws.send_json(_start_message({"call_credential": "irrelevant"}))
            ws.receive_text()

    assert exc_info.value.code == 1008
    assert recorded == []


def test_unsupported_provider_shaped_message_closes_cleanly(
    recorded: list[dict[str, Any]],
) -> None:
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with _client(_settings()).websocket_connect("/twilio/media-stream") as ws:
            # Shaped like nothing parse_telephony_websocket recognizes, on
            # either message.
            ws.send_json({"hello": "world"})
            ws.send_json({"still": "not recognized"})
            ws.receive_text()

    assert exc_info.value.code == 1008
    assert recorded == []


def test_never_logs_the_credential_or_secret(caplog: pytest.LogCaptureFixture) -> None:
    token = _mint(ORG_A, CALL_SID, SECRET)
    with caplog.at_level("DEBUG"):
        with _client(_settings()).websocket_connect("/twilio/media-stream") as ws:
            _send_handshake(ws, {"organization_id": ORG_B, "call_credential": token})

    logged_text = " ".join(r.message for r in caplog.records)
    assert token not in logged_text
    assert SECRET not in logged_text
