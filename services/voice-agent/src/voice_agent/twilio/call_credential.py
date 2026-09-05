"""Verifies M7 call credentials minted by apps/api (Twilio inbound calls).

Mirrors apps/api's src/auth/call-credential.ts algorithm exactly (HMAC-SHA256
over a base64url-encoded JSON payload), using only stdlib
hmac/hashlib/json/base64 -- same "no new dependency for one small,
well-documented algorithm" reasoning as twilio/signature.py. See the
approved M7 plan sections 6 and 17.

voice-agent never mints a call credential -- only apps/api does, at the
Twilio phone-number-lookup internal endpoint. This module is verify-only,
used by routes/twilio.py's media-stream WebSocket handler to establish
organization identity LOCALLY, before session.run_session() is ever
called. The organization_id returned by a successful verify() call here --
never a separate, unauthenticated WebSocket parameter -- is the sole
source of truth for which organization a session belongs to; see the
approved M7 plan section 2.

The payload contract is fixed:
{"organization_id": "<uuid>", "call_sid": "<Twilio CallSid>",
"exp": <unix_timestamp_int>} -- exp must be an actual int, not a float and
not a bool (Python's bool is a subclass of int, so isinstance(x, int)
alone would silently accept True/False as 1/0; both checks are explicit
below).

Node's base64url encoding omits padding; Python's base64.urlsafe_b64encode
includes it and urlsafe_b64decode requires correctly padded input -- this
module adds/strips padding explicitly so tokens minted by the Node
implementation verify correctly here. See
tests/test_twilio_call_credential.py's interoperability test, which mints
a token using an independent reimplementation of the Node algorithm and
verifies it with this module.

Every exception below carries only a short, fixed, safe-to-log message
(never the token or its claims) -- but callers should still log only
type(exc).__name__, matching this codebase's established
never-log-raw-exception-text discipline (see session.py, logging_config.py).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any


class CallCredentialError(Exception):
    """Base class for all call-credential verification failures."""


class MalformedCallCredentialError(CallCredentialError):
    """Not two dot-separated parts, invalid base64, invalid JSON, or a
    payload missing/mistyping a required claim (including exp being a
    float or a bool instead of a plain int)."""


class InvalidCallCredentialSignatureError(CallCredentialError):
    """The HMAC signature does not match -- wrong secret, or the payload
    was tampered with after signing."""


class ExpiredCallCredentialError(CallCredentialError):
    """The credential's exp claim is in the past."""


class CallSidMismatchError(CallCredentialError):
    """The credential's call_sid claim does not match the real Twilio
    call_sid for the connection presenting it."""


@dataclass(frozen=True)
class VerifiedCallCredential:
    """The two claims voice-agent actually needs, extracted only once
    verification has fully succeeded."""

    organization_id: str
    call_sid: str


def _b64url_encode_no_pad(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode_no_pad(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def verify_call_credential(
    token: str,
    secret: str,
    expected_call_sid: str,
) -> VerifiedCallCredential:
    """Verifies a call credential minted by apps/api's generateCallCredential.

    Raises a specific CallCredentialError subclass on any failure -- there
    is no partial-success case, matching apps/api's own verifyCallCredential.
    `expected_call_sid` must be the real Twilio call_sid for the connection
    presenting this token (from parse_telephony_websocket()'s call_data,
    never from a value the token itself claims to be) -- this is what
    scopes a credential to one specific call rather than being replayable
    against any future connection.
    """
    parts = token.split(".")
    if len(parts) != 2:
        raise MalformedCallCredentialError("malformed")
    payload_b64, sig_b64 = parts

    expected_sig_b64 = _b64url_encode_no_pad(
        hmac.new(secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(expected_sig_b64, sig_b64):
        raise InvalidCallCredentialSignatureError("signature")

    try:
        payload: Any = json.loads(_b64url_decode_no_pad(payload_b64))
    except (ValueError, UnicodeDecodeError) as exc:
        raise MalformedCallCredentialError("malformed") from exc

    # exp must be an actual int -- isinstance(x, int) alone would also
    # accept a bool (True/False are ints in Python) or would need a
    # separate float check, so both are explicit and separate here.
    if (
        not isinstance(payload, dict)
        or not isinstance(payload.get("organization_id"), str)
        or not isinstance(payload.get("call_sid"), str)
        or not isinstance(payload.get("exp"), int)
        or isinstance(payload.get("exp"), bool)
    ):
        raise MalformedCallCredentialError("malformed")

    if payload["call_sid"] != expected_call_sid:
        raise CallSidMismatchError("call_mismatch")

    if payload["exp"] < time.time():
        raise ExpiredCallCredentialError("expired")

    return VerifiedCallCredential(
        organization_id=payload["organization_id"],
        call_sid=payload["call_sid"],
    )
