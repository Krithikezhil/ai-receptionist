"""Twilio webhook signature verification (M7).

Implements Twilio's own documented request-validation algorithm directly
with the standard library (hmac/hashlib/base64) rather than adding the
official `twilio` Python SDK -- the algorithm is small, stable, and
well-documented, and pulling in the full SDK (with its own set of
transitive dependencies) for one HMAC computation isn't justified. See the
approved M7 plan sections 5 and 17.

The caller is responsible for constructing the exact canonical URL Twilio
actually signed (VOICE_AGENT_PUBLIC_BASE_URL + the fixed webhook path --
never derived from request headers such as X-Forwarded-*, which are not a
trusted boundary in this deployment; see routes/twilio.py and the plan's
canonical-URL discussion in section 5). This module only implements the
generic verification algorithm given an already-decided URL string -- it
has no opinion on where that URL comes from.
"""

from __future__ import annotations

import hashlib
import hmac
from base64 import b64encode
from collections.abc import Mapping


def verify_twilio_signature(
    url: str,
    form_params: Mapping[str, str],
    signature: str,
    auth_token: str,
) -> bool:
    """Verifies an `X-Twilio-Signature` header value.

    Twilio's documented algorithm (SHA-1 is mandated by Twilio's own
    scheme here, not a general recommendation elsewhere in this codebase):

        expected = base64(hmac_sha1(auth_token, url + sorted_params))

    where `sorted_params` is every form parameter's key immediately
    followed by its value (no separator), concatenated in ascending key
    order. Comparison is timing-safe (hmac.compare_digest). There is no
    partial-success case -- any mismatch (wrong url, wrong/tampered
    params, wrong auth_token, or a malformed signature string) returns
    False.
    """
    concatenated = url + "".join(f"{key}{form_params[key]}" for key in sorted(form_params))
    digest = hmac.new(
        auth_token.encode("utf-8"),
        concatenated.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    expected = b64encode(digest).decode("utf-8")
    return hmac.compare_digest(expected, signature)
