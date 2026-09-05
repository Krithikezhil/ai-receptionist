"""TwiML generation and URL helpers for the Twilio voice webhook (M7).

Pure functions only -- no HTTP, no Settings object, no I/O. The actual
route handler (routes/twilio.py) reads settings, calls
verify_twilio_signature and lookup_organization_by_phone_number, and
decides what to do and which status code to return; keeping this module
pure makes TwiML/URL construction independently testable. See the approved
M7 plan sections 5 and 12.
"""

from __future__ import annotations

from xml.sax.saxutils import escape

_VOICE_WEBHOOK_PATH = "/twilio/voice"
_MEDIA_STREAM_PATH = "/twilio/media-stream"

_GENERIC_FAILURE_MESSAGE = "We're sorry, we can't take your call right now. Please try again later."


def canonical_voice_webhook_url(public_base_url: str) -> str:
    """The exact URL Twilio's own signature was computed over: always
    VOICE_AGENT_PUBLIC_BASE_URL (an explicitly operator-configured value,
    never derived from request headers such as X-Forwarded-* -- those are
    not a trusted boundary in this deployment) plus this webhook's fixed
    path. See the approved M7 plan section 5."""
    return public_base_url.rstrip("/") + _VOICE_WEBHOOK_PATH


def media_stream_websocket_url(public_base_url: str) -> str:
    """Builds the wss:// URL embedded in the success TwiML's <Stream url>,
    from the same VOICE_AGENT_PUBLIC_BASE_URL used for signature
    verification -- one operator-configured value, not two that could
    drift apart. Scheme is swapped http(s) -> ws(s)."""
    base = public_base_url.rstrip("/")
    if base.startswith("https://"):
        ws_base = "wss://" + base[len("https://") :]
    elif base.startswith("http://"):
        ws_base = "ws://" + base[len("http://") :]
    else:
        ws_base = base
    return ws_base + _MEDIA_STREAM_PATH


def build_success_twiml(organization_id: str, call_credential: str, public_base_url: str) -> str:
    """The TwiML returned once signature validation and the phone-number
    lookup both succeed. organization_id is included only as metadata --
    voice-agent's own WebSocket handler never treats it as authoritative;
    the verified call_credential is the sole source of organization
    identity (see the approved M7 plan section 2)."""
    stream_url = media_stream_websocket_url(public_base_url)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Connect>"
        f'<Stream url="{escape(stream_url)}">'
        f'<Parameter name="organization_id" value="{escape(organization_id)}"/>'
        f'<Parameter name="call_credential" value="{escape(call_credential)}"/>'
        "</Stream></Connect></Response>"
    )


def build_failure_twiml() -> str:
    """A generic, honest spoken failure message + hangup -- used for every
    failure mode that can occur AFTER signature validation succeeds
    (number not mapped to any organization, apps/api unreachable, etc.),
    so a caller never hears a raw error or dead silence. Deliberately does
    not distinguish the failure reason in what the caller hears."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f"<Say>{escape(_GENERIC_FAILURE_MESSAGE)}</Say>"
        "<Hangup/>"
        "</Response>"
    )
