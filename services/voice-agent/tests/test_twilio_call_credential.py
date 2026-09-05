"""Unit tests for twilio/call_credential.py.

Includes an interoperability test that reimplements apps/api's exact
Node.js minting algorithm (auth/call-credential.ts's generateCallCredential)
from scratch in Python -- not by importing or calling anything from
call_credential.py -- and verifies the resulting token with
verify_call_credential(). That proves the two independent implementations
actually agree on the wire format, not just that this module is internally
self-consistent. No network, no real Twilio account, no real credentials.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import pytest

from voice_agent.twilio.call_credential import (
    CallSidMismatchError,
    ExpiredCallCredentialError,
    InvalidCallCredentialSignatureError,
    MalformedCallCredentialError,
    VerifiedCallCredential,
    verify_call_credential,
)

SECRET = "test-call-credential-secret"  # noqa: S105
ORG_ID = "11111111-1111-1111-1111-111111111111"
CALL_SID = "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OTHER_CALL_SID = "CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"


def _b64url_no_pad(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _sign_payload(payload_b64: str, secret: str) -> str:
    sig = hmac.new(secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    return _b64url_no_pad(sig)


def _mint_from_raw_payload(payload: dict[str, object], secret: str) -> str:
    """Encodes and correctly signs an arbitrary payload dict, bypassing
    the "exp must be a real unix-timestamp int" contract entirely -- used
    to construct payloads that are correctly signed but violate the
    contract in a specific, deliberate way (e.g. exp as a float or bool)."""
    payload_b64 = _b64url_no_pad(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{payload_b64}.{_sign_payload(payload_b64, secret)}"


def _node_style_mint(
    organization_id: str,
    call_sid: str,
    secret: str,
    ttl_seconds: float = 4 * 60 * 60,
) -> str:
    """Reimplements apps/api's generateCallCredential (auth/call-credential.ts)
    from scratch -- deliberately not sharing code with call_credential.py,
    so this genuinely tests cross-implementation interoperability rather
    than self-consistency."""
    payload = {
        "organization_id": organization_id,
        "call_sid": call_sid,
        "exp": int(time.time()) + int(ttl_seconds),
    }
    return _mint_from_raw_payload(payload, secret)


def test_a_token_minted_by_the_node_style_algorithm_verifies_correctly_here() -> None:
    token = _node_style_mint(ORG_ID, CALL_SID, SECRET)
    result = verify_call_credential(token, SECRET, CALL_SID)
    assert result == VerifiedCallCredential(organization_id=ORG_ID, call_sid=CALL_SID)


def test_rejects_a_token_signed_with_a_different_secret() -> None:
    token = _node_style_mint(ORG_ID, CALL_SID, "a-different-secret")
    with pytest.raises(InvalidCallCredentialSignatureError):
        verify_call_credential(token, SECRET, CALL_SID)


def test_rejects_an_expired_token() -> None:
    token = _node_style_mint(ORG_ID, CALL_SID, SECRET, ttl_seconds=-1)
    with pytest.raises(ExpiredCallCredentialError):
        verify_call_credential(token, SECRET, CALL_SID)


def test_rejects_a_mismatched_call_sid() -> None:
    token = _node_style_mint(ORG_ID, CALL_SID, SECRET)
    with pytest.raises(CallSidMismatchError):
        verify_call_credential(token, SECRET, OTHER_CALL_SID)


def test_rejects_a_tampered_payload() -> None:
    token = _node_style_mint(ORG_ID, CALL_SID, SECRET)
    payload_b64, sig_b64 = token.split(".")
    tampered_json = json.dumps(
        {"organization_id": "attacker-org", "call_sid": CALL_SID, "exp": int(time.time()) + 3600},
        separators=(",", ":"),
    ).encode("utf-8")
    tampered_payload_b64 = _b64url_no_pad(tampered_json)
    tampered_token = f"{tampered_payload_b64}.{sig_b64}"

    with pytest.raises(InvalidCallCredentialSignatureError):
        verify_call_credential(tampered_token, SECRET, CALL_SID)
    assert payload_b64 != tampered_payload_b64


def test_rejects_a_token_with_no_dot_separator() -> None:
    with pytest.raises(MalformedCallCredentialError):
        verify_call_credential("not-a-valid-token", SECRET, CALL_SID)


def test_rejects_a_token_with_more_than_one_dot() -> None:
    with pytest.raises(MalformedCallCredentialError):
        verify_call_credential("a.b.c", SECRET, CALL_SID)


def test_rejects_a_payload_that_is_not_valid_base64_json() -> None:
    _, sig_b64 = _node_style_mint(ORG_ID, CALL_SID, SECRET).split(".")
    with pytest.raises((MalformedCallCredentialError, InvalidCallCredentialSignatureError)):
        verify_call_credential(f"not-valid-base64-json.{sig_b64}", SECRET, CALL_SID)


def test_rejects_a_payload_missing_required_claims_even_if_correctly_signed() -> None:
    token = _mint_from_raw_payload({"organization_id": ORG_ID}, SECRET)
    with pytest.raises(MalformedCallCredentialError):
        verify_call_credential(token, SECRET, CALL_SID)


def test_rejects_a_float_exp_even_if_correctly_signed() -> None:
    """The payload contract fixes exp as a unix-timestamp int -- a
    correctly signed payload with exp as a float must still be rejected
    as malformed, not silently accepted via Python's numeric coercion."""
    future = time.time() + 3600
    token = _mint_from_raw_payload(
        {"organization_id": ORG_ID, "call_sid": CALL_SID, "exp": future}, SECRET
    )
    assert isinstance(future, float)
    with pytest.raises(MalformedCallCredentialError):
        verify_call_credential(token, SECRET, CALL_SID)


def test_rejects_a_bool_exp_even_if_correctly_signed() -> None:
    """Python's bool is a subclass of int, so isinstance(x, int) alone
    would silently accept True/False as 1/0 -- must be rejected too."""
    token = _mint_from_raw_payload(
        {"organization_id": ORG_ID, "call_sid": CALL_SID, "exp": True}, SECRET
    )
    with pytest.raises(MalformedCallCredentialError):
        verify_call_credential(token, SECRET, CALL_SID)


def test_failure_never_exposes_the_token_or_claims_in_the_exception_message() -> None:
    token = _node_style_mint(ORG_ID, CALL_SID, SECRET)
    with pytest.raises(CallSidMismatchError) as exc_info:
        verify_call_credential(token, SECRET, OTHER_CALL_SID)

    message = str(exc_info.value)
    assert ORG_ID not in message
    assert CALL_SID not in message
    assert token not in message
