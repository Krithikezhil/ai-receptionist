"""M10 Step 7: the write-capable appointment-booking tool, alongside
capture_lead.py. organization_id and call_sid are bound once at
pipeline-build time, exactly like every other write-capable tool in this
codebase -- the LLM never supplies or overrides either.
"""

from __future__ import annotations

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.services.llm_service import FunctionCallParams

from voice_agent.clients.api_client import ApiClient, ApiClientError
from voice_agent.clients.models import ServiceItem
from voice_agent.tools.check_availability import resolve_service_id

BOOK_APPOINTMENT_FUNCTION_NAME = "book_appointment"


def _clean(value: object) -> str | None:
    """Treats a missing, blank, or whitespace-only argument as "not
    provided" -- mirrors capture_lead.py's own _clean() exactly."""
    return value.strip() if isinstance(value, str) and value.strip() else None


def build_book_appointment_schema(
    api_client: ApiClient,
    organization_id: str,
    call_sid: str | None,
    services: list[ServiceItem],
) -> FunctionSchema:
    """Builds the tool's schema+handler, bound to one session's org/client,
    the real Twilio call_sid (or None on the dev harness -- see
    pipeline.py), and the already-fetched service list."""

    async def handler(params: FunctionCallParams) -> None:
        service_name = params.arguments.get("service_name")
        date = params.arguments.get("date")
        time = params.arguments.get("time")
        customer_name = _clean(params.arguments.get("customer_name"))
        customer_phone = _clean(params.arguments.get("customer_phone"))
        customer_email = _clean(params.arguments.get("customer_email"))
        notes = _clean(params.arguments.get("notes"))

        if not isinstance(service_name, str) or not service_name.strip():
            await params.result_callback({"error": "A service name is required."})
            return
        if not isinstance(date, str) or not date.strip():
            await params.result_callback({"error": "A date is required."})
            return
        if not isinstance(time, str) or not time.strip():
            await params.result_callback({"error": "A time is required."})
            return
        if not customer_name and not customer_phone:
            await params.result_callback(
                {"error": "I need at least a name or a phone number before I can book this."}
            )
            return

        service_id = resolve_service_id(services, service_name)
        if service_id is None:
            await params.result_callback(
                {"error": f'I don\'t have a service called "{service_name}".'}
            )
            return

        try:
            result = await api_client.book_appointment(
                organization_id,
                service_id=service_id,
                date=date,
                time=time,
                customer_name=customer_name,
                customer_phone=customer_phone,
                customer_email=customer_email,
                notes=notes,
                call_sid=call_sid,
            )
        except ApiClientError as exc:
            await params.result_callback({"error": str(exc)})
            return

        if result.status == "booked":
            await params.result_callback({"booked": True})
            return
        if result.status == "unavailable":
            response: dict[str, object] = {"error": "That time isn't available."}
            if result.alternatives:
                response["alternatives"] = result.alternatives
            await params.result_callback(response)
            return
        if result.status == "duplicate_booking":
            await params.result_callback(
                {"error": "An appointment for this call has already been booked."}
            )
            return
        if result.status == "calendar_not_connected":
            await params.result_callback(
                {"error": "This business hasn't connected their calendar yet."}
            )
            return
        # calendar_unavailable
        await params.result_callback(
            {"error": "I can't reach the calendar right now. Please try again shortly."}
        )

    return FunctionSchema(
        name=BOOK_APPOINTMENT_FUNCTION_NAME,
        description=(
            "Book an appointment for the caller. Call check_availability first to confirm a "
            "time is open. Requires the caller to have given at least their name or phone "
            "number. service_name must exactly match one of the services listed in your "
            "instructions -- never invent one. Never call this speculatively -- only after the "
            "caller has agreed to a specific date and time."
        ),
        properties={
            "service_name": {
                "type": "string",
                "description": "The exact name of the service, as listed in your instructions.",
            },
            "date": {"type": "string", "description": "The confirmed date, as YYYY-MM-DD."},
            "time": {"type": "string", "description": "The confirmed time, as 24-hour HH:MM."},
            "customer_name": {
                "type": "string",
                "description": "The caller's name, exactly as they stated it. Omit if not given.",
            },
            "customer_phone": {
                "type": "string",
                "description": "A phone number the caller explicitly gave. Omit if not given.",
            },
            "customer_email": {
                "type": "string",
                "description": "An email address the caller explicitly gave. Omit if not given.",
            },
            "notes": {
                "type": "string",
                "description": (
                    "Any other relevant detail the caller actually stated. Omit if none."
                ),
            },
        },
        required=["service_name", "date", "time"],
        handler=handler,
    )
