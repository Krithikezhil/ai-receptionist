"""Unit tests for twilio/signature.py.

Expected signatures are computed with a second, independent
implementation of Twilio's algorithm (raw hashlib/hmac/base64, not by
calling verify_twilio_signature or reusing any of its internals) -- a test
that only ever asked the function under test to also produce its own
expected value could never catch a shared bug in that logic. No network,
no real Twilio account, no real credentials.
"""

from __future__ import annotations

import hashlib
import hmac
from base64 import b64encode

from voice_agent.twilio.signature import verify_twilio_signature

AUTH_TOKEN = "test-twilio-auth-token"  # noqa: S105
URL = "https://voice.example.com/twilio/voice"


def _independently_signed(url: str, params: dict[str, str], auth_token: str) -> str:
    """A from-scratch reimplementation of Twilio's signing algorithm, used
    only to construct test fixtures -- deliberately not sharing any code
    with signature.py."""
    concatenated = url
    for key in sorted(params):
        concatenated += key + params[key]
    digest = hmac.new(auth_token.encode(), concatenated.encode(), hashlib.sha1).digest()
    return b64encode(digest).decode()


def test_accepts_a_correctly_signed_request() -> None:
    params = {"CallSid": "CA123", "From": "+15550001111", "To": "+15559998888"}
    signature = _independently_signed(URL, params, AUTH_TOKEN)
    assert verify_twilio_signature(URL, params, signature, AUTH_TOKEN) is True


def test_rejects_the_same_signature_checked_against_a_different_url() -> None:
    """The single most important real-world failure mode: a misconfigured
    VOICE_AGENT_PUBLIC_BASE_URL (or a proxy that rewrites the path) means
    the canonical URL this process computes doesn't match what Twilio
    actually signed -- must fail closed, not fall back to trusting it."""
    params = {"CallSid": "CA123"}
    signature = _independently_signed(URL, params, AUTH_TOKEN)
    different_url = "https://voice.example.com/some/other/path"
    assert verify_twilio_signature(different_url, params, signature, AUTH_TOKEN) is False


def test_rejects_a_tampered_parameter() -> None:
    params = {"CallSid": "CA123", "From": "+15550001111"}
    signature = _independently_signed(URL, params, AUTH_TOKEN)
    tampered = {**params, "From": "+19998887777"}
    assert verify_twilio_signature(URL, tampered, signature, AUTH_TOKEN) is False


def test_rejects_an_added_parameter_not_covered_by_the_signature() -> None:
    params = {"CallSid": "CA123"}
    signature = _independently_signed(URL, params, AUTH_TOKEN)
    extra = {**params, "InjectedParam": "malicious"}
    assert verify_twilio_signature(URL, extra, signature, AUTH_TOKEN) is False


def test_rejects_the_wrong_auth_token() -> None:
    params = {"CallSid": "CA123"}
    signature = _independently_signed(URL, params, AUTH_TOKEN)
    assert verify_twilio_signature(URL, params, signature, "a-different-auth-token") is False


def test_rejects_an_empty_signature() -> None:
    params = {"CallSid": "CA123"}
    assert verify_twilio_signature(URL, params, "", AUTH_TOKEN) is False


def test_rejects_a_malformed_signature_value_without_raising() -> None:
    params = {"CallSid": "CA123"}
    assert verify_twilio_signature(URL, params, "not-valid-base64!!!", AUTH_TOKEN) is False


def test_is_independent_of_the_order_params_are_supplied_in() -> None:
    """Twilio's algorithm sorts by key before concatenating -- a dict built
    in a different insertion order must still validate against the same
    signature."""
    params_a = {"CallSid": "CA123", "From": "+15550001111", "To": "+15559998888"}
    params_b = {"To": "+15559998888", "CallSid": "CA123", "From": "+15550001111"}
    signature = _independently_signed(URL, params_a, AUTH_TOKEN)
    assert verify_twilio_signature(URL, params_b, signature, AUTH_TOKEN) is True


def test_handles_no_form_params_at_all() -> None:
    signature = _independently_signed(URL, {}, AUTH_TOKEN)
    assert verify_twilio_signature(URL, {}, signature, AUTH_TOKEN) is True
