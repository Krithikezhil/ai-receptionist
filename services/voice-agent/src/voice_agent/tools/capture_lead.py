"""M9 Step 7: the second function-calling tool, and the first write-capable
one (M5's search_knowledge.py is explicitly "read-only by design" -- this
tool deliberately crosses that boundary, reviewed and approved as part of
M9's own plan). Captures whatever contact info/intent/notes the caller has
actually stated during the call -- the tool description below instructs the
LLM never to invent, guess, or infer a value, and no field is JSON-schema-
required, so the LLM is never pressured to fabricate something just to call
the tool at all. See ARCHITECTURE.md "Tools" and the approved M9 plan.
"""

from __future__ import annotations

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.services.llm_service import FunctionCallParams

from voice_agent.clients.api_client import ApiClient, ApiClientError

CAPTURE_LEAD_FUNCTION_NAME = "capture_lead"


def _clean(value: object) -> str | None:
    """Treats a missing, blank, or whitespace-only argument as "not
    provided" -- the LLM omitting a field and the LLM sending "" for it
    must be handled identically, never as two different things."""
    return value.strip() if isinstance(value, str) and value.strip() else None


def build_capture_lead_schema(
    api_client: ApiClient, organization_id: str, call_sid: str | None
) -> FunctionSchema:
    """Builds the tool's schema+handler, bound to one session's org/client
    and (when available) the real Twilio call_sid for this call -- see
    routes/twilio.py, which is the only caller that ever passes a real
    value; the WebRTC dev-harness path (bot.py) leaves this None, since no
    real call exists there. Exactly like organization_id, call_sid is bound
    once here and is never read from the LLM-controlled tool arguments --
    the LLM cannot choose or override either value.
    """

    async def handler(params: FunctionCallParams) -> None:
        contact_name = _clean(params.arguments.get("contact_name"))
        contact_phone = _clean(params.arguments.get("contact_phone"))
        contact_email = _clean(params.arguments.get("contact_email"))
        intent = _clean(params.arguments.get("intent"))
        notes = _clean(params.arguments.get("notes"))

        try:
            await api_client.create_lead(
                organization_id,
                contact_name=contact_name,
                contact_phone=contact_phone,
                contact_email=contact_email,
                intent=intent,
                notes=notes,
                call_sid=call_sid,
            )
        except ApiClientError as exc:
            # Same failure-handling convention as search_knowledge.py: a
            # failed capture is not a crash -- the LLM gets a structured
            # error it can react to, never let a tool failure take down
            # the whole session. See SECURITY.md "Failure handling".
            await params.result_callback({"error": str(exc)})
            return

        await params.result_callback({"captured": True})

    return FunctionSchema(
        name=CAPTURE_LEAD_FUNCTION_NAME,
        description=(
            "Record the caller's contact information and/or reason for calling as a lead, "
            "so the business can follow up. Call this ONLY after the caller has actually "
            "provided at least one concrete piece of information -- a name, a phone number, "
            "an email address, or a clear statement of what they need or want. Do NOT call "
            "this speculatively at the start of a call, and do NOT call it more than once "
            "with guessed or repeated information. Never invent, guess, or infer a value: "
            "only include information the caller explicitly said, in their own terms. Omit "
            "any field the caller did not provide -- never fill in a placeholder or assumed "
            "value just to have something to send."
        ),
        properties={
            "contact_name": {
                "type": "string",
                "description": "The caller's name, exactly as they stated it. Omit if not given.",
            },
            "contact_phone": {
                "type": "string",
                "description": (
                    "A phone number the caller explicitly gave for callback. Omit if not given."
                ),
            },
            "contact_email": {
                "type": "string",
                "description": "An email address the caller explicitly gave. Omit if not given.",
            },
            "intent": {
                "type": "string",
                "description": (
                    "A short, factual summary of what the caller said they want, in their own "
                    "terms. Omit if unclear or not stated."
                ),
            },
            "notes": {
                "type": "string",
                "description": (
                    "Any other relevant detail the caller actually stated. Omit if none."
                ),
            },
        },
        required=[],
        handler=handler,
    )
