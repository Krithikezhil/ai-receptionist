"""FastAPI routes for Twilio inbound calls (M7).

POST /twilio/voice and WS /twilio/media-stream both live here. Wired into
the running app only once fully built and tested (see main.py).
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, WebSocket
from pipecat.runner.utils import parse_telephony_websocket
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport

from voice_agent.clients.api_client import ApiClientError, lookup_organization_by_phone_number
from voice_agent.config import Settings
from voice_agent.logging_config import get_logger
from voice_agent.session import run_session
from voice_agent.twilio.call_credential import CallCredentialError, verify_call_credential
from voice_agent.twilio.signature import verify_twilio_signature
from voice_agent.twilio.webhook import (
    build_failure_twiml,
    build_success_twiml,
    canonical_voice_webhook_url,
)

logger = get_logger(__name__)

# WebSocket close code for any pre-session rejection (missing/invalid
# credential, malformed handshake, unsupported provider) -- RFC 6455
# "Policy Violation", matching the approved M7 plan section 8.
_POLICY_VIOLATION_CLOSE_CODE = 1008


def create_twilio_router(settings: Settings) -> APIRouter:
    """Builds the Twilio routes bound to one Settings instance -- mirrors
    apps/api's createXRouter(deps) factory pattern (the Node side of this
    system) for the same reason: explicit dependencies, no hidden global
    state, easy to test with a throwaway Settings instance mounted on a
    throwaway FastAPI app (see tests/test_twilio_webhook.py).
    """
    router = APIRouter()

    @router.post("/twilio/voice")
    async def voice_webhook(request: Request) -> Response:
        # STRICT ORDER (see the approved M7 plan section 12): signature
        # validation happens before anything else. No organization lookup,
        # no credential minting, nothing else runs on failure.
        if not settings.twilio_auth_token or not settings.voice_agent_public_base_url:
            logger.error(
                "twilio voice webhook: TWILIO_AUTH_TOKEN or VOICE_AGENT_PUBLIC_BASE_URL "
                "not configured, rejecting"
            )
            return Response(status_code=403)

        form = await request.form()
        form_params = {key: str(value) for key, value in form.items()}
        signature = request.headers.get("X-Twilio-Signature", "")
        canonical_url = canonical_voice_webhook_url(settings.voice_agent_public_base_url)

        if not verify_twilio_signature(
            canonical_url, form_params, signature, settings.twilio_auth_token
        ):
            logger.warning("twilio voice webhook: signature rejected")
            return Response(status_code=403)

        # Only reached once the signature is verified -- To/CallSid below
        # are now trusted as genuinely from Twilio, not attacker-suppliable
        # on their own (see twilio/signature.py).
        to_number = form_params.get("To", "")
        call_sid = form_params.get("CallSid", "")
        if not to_number or not call_sid:
            logger.error("twilio voice webhook: validly signed request missing To/CallSid")
            return Response(
                content=build_failure_twiml(), media_type="application/xml", status_code=200
            )

        try:
            lookup = await lookup_organization_by_phone_number(
                settings.api_base_url, settings.internal_service_key, to_number, call_sid
            )
        except ApiClientError as exc:
            # Never a raw error or 500 to the caller -- a generic spoken
            # failure message + hangup either way. The phone number itself
            # is never logged (closer to PII than an organization id or
            # business name -- see the approved M7 plan section 8); only
            # the exception's class name and the call_sid are safe to log.
            logger.info(
                "twilio voice webhook: phone-number lookup failed for call %s (%s)",
                call_sid,
                type(exc).__name__,
            )
            return Response(
                content=build_failure_twiml(), media_type="application/xml", status_code=200
            )

        logger.info("twilio voice webhook: resolved call %s to an organization", call_sid)
        twiml = build_success_twiml(
            lookup.organization_id,
            lookup.call_credential,
            settings.voice_agent_public_base_url,
        )
        return Response(content=twiml, media_type="application/xml", status_code=200)

    @router.websocket("/twilio/media-stream")
    async def media_stream(websocket: WebSocket) -> None:
        """Bridges one Twilio Media Stream into the unmodified M6 runtime.

        Tenant identity comes ONLY from the verified call credential
        (verify_call_credential's return value) -- the WS handshake's own
        "organization_id" custom parameter, if present at all, is read
        only for an observability cross-check log line and NEVER used to
        decide which organization this session runs for. See the approved
        M7 plan section 2; the adversarial test proving this
        (org A credential + org B metadata) lives in
        tests/test_twilio_media_stream.py.

        Ordering matters: the credential is verified LOCALLY (pure HMAC,
        no network, no DB) before any Pipecat object is constructed and
        before session.run_session() is ever called -- so an unauthenticated
        connection can cost at most one WS handshake, two small JSON reads,
        and one HMAC computation, never a real pipeline or provider call.
        See the approved M7 plan sections 7 and 8.
        """
        await websocket.accept()

        try:
            transport_type, call_data = await parse_telephony_websocket(websocket)
        except ValueError as exc:
            logger.warning("twilio media-stream: handshake parse failed (%s)", type(exc).__name__)
            await websocket.close(code=_POLICY_VIOLATION_CLOSE_CODE)
            return

        if transport_type != "twilio":
            logger.warning(
                "twilio media-stream: unsupported/undetected provider %r", transport_type
            )
            await websocket.close(code=_POLICY_VIOLATION_CLOSE_CODE)
            return

        call_credential = call_data.body.get("call_credential")
        real_call_sid = call_data.call_id or ""
        if (
            not isinstance(call_credential, str)
            or not call_credential
            or not settings.twilio_call_credential_secret
        ):
            logger.warning("twilio media-stream: missing credential or secret not configured")
            await websocket.close(code=_POLICY_VIOLATION_CLOSE_CODE)
            return

        try:
            verified = verify_call_credential(
                call_credential, settings.twilio_call_credential_secret, real_call_sid
            )
        except CallCredentialError as exc:
            logger.warning("twilio media-stream: credential rejected (%s)", type(exc).__name__)
            await websocket.close(code=_POLICY_VIOLATION_CLOSE_CODE)
            return

        # The verified credential is the SOLE source of organization
        # identity from here on -- never call_data.body's own
        # "organization_id", which is untrusted WS metadata (see the
        # docstring above and the approved M7 plan section 2).
        organization_id = verified.organization_id

        metadata_organization_id = call_data.body.get("organization_id")
        if (
            isinstance(metadata_organization_id, str)
            and metadata_organization_id
            and metadata_organization_id != organization_id
        ):
            # organization ids are safe to log (same trust tier as M6's
            # existing business-name precedent) -- this is observability
            # only, it never influences which organization the session
            # actually runs for.
            logger.warning(
                "twilio media-stream: WS metadata organization_id (%s) disagreed with the "
                "verified credential (%s); using the verified credential",
                metadata_organization_id,
                organization_id,
            )

        # auto_hang_up=False deliberately: relies on the documented
        # <Connect><Stream> TwiML semantics (the call ends when the
        # connected stream disconnects) rather than an explicit Twilio
        # REST hangup call, which would require TWILIO_ACCOUNT_SID/
        # TWILIO_AUTH_TOKEN as additional secrets neither this route nor
        # config.py currently has. See the approved M7 plan sections 8/13
        # -- if the manual live-call test shows the call doesn't reliably
        # end this way, auto_hang_up=True is the documented fallback.
        serializer = TwilioFrameSerializer(
            stream_sid=call_data.stream_id or "",
            call_sid=real_call_sid,
            params=TwilioFrameSerializer.InputParams(auto_hang_up=False),
        )
        transport = FastAPIWebsocketTransport(
            websocket=websocket,
            params=FastAPIWebsocketParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                add_wav_header=False,
                serializer=serializer,
            ),
        )

        logger.info("twilio media-stream: starting session for call %s", real_call_sid)
        await run_session(
            organization_id=organization_id,
            organization_service_token=call_credential,
            transport=transport,
            settings=settings,
        )

    return router
