"""M10 Step 7: read-only availability-check tool, alongside
search_knowledge.py. service_name is resolved locally against the session's
already-fetched RuntimeContext.services -- the LLM never sees or supplies a
service UUID, mirroring organization_id/call_sid's own binding discipline.
See ARCHITECTURE.md "Tools" and the approved M10 plan.
"""

from __future__ import annotations

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.services.llm_service import FunctionCallParams

from voice_agent.clients.api_client import ApiClient, ApiClientError
from voice_agent.clients.models import ServiceItem

CHECK_AVAILABILITY_FUNCTION_NAME = "check_availability"


def resolve_service_id(services: list[ServiceItem], service_name: str) -> str | None:
    """Case-insensitive EXACT match only -- no fuzzy/partial matching, and
    only active services are considered, mirroring build_system_prompt's
    own "Services offered" list (which only ever names active services).
    Shared with tools/book_appointment.py rather than duplicated."""
    normalized = service_name.strip().lower()
    for service in services:
        if service.active and service.name.strip().lower() == normalized:
            return service.id
    return None


def build_check_availability_schema(
    api_client: ApiClient, organization_id: str, services: list[ServiceItem]
) -> FunctionSchema:
    """Builds the tool's schema+handler, bound to one session's org/client
    and the already-fetched service list -- see pipeline.py."""

    async def handler(params: FunctionCallParams) -> None:
        service_name = params.arguments.get("service_name")
        date = params.arguments.get("date")
        time = params.arguments.get("time")

        if not isinstance(service_name, str) or not service_name.strip():
            await params.result_callback({"error": "A service name is required."})
            return
        if not isinstance(date, str) or not date.strip():
            await params.result_callback({"error": "A date is required."})
            return

        service_id = resolve_service_id(services, service_name)
        if service_id is None:
            # No API call -- an unresolvable service name is not something
            # apps/api can help with either.
            await params.result_callback(
                {"error": f'I don\'t have a service called "{service_name}".'}
            )
            return

        try:
            result = await api_client.check_availability(
                organization_id,
                service_id=service_id,
                date=date,
                time=time if isinstance(time, str) and time.strip() else None,
            )
        except ApiClientError as exc:
            await params.result_callback({"error": str(exc)})
            return

        if result.status == "calendar_not_connected":
            await params.result_callback(
                {"error": "This business hasn't connected their calendar yet."}
            )
            return
        if result.status == "calendar_unavailable":
            await params.result_callback(
                {"error": "I can't check the calendar right now. Please try again shortly."}
            )
            return

        response: dict[str, object] = {"available_times": result.slots}
        if result.requested_time_available is not None:
            response["requested_time_available"] = result.requested_time_available
        if result.alternatives is not None:
            response["alternatives"] = result.alternatives
        await params.result_callback(response)

    return FunctionSchema(
        name=CHECK_AVAILABILITY_FUNCTION_NAME,
        description=(
            "Check what appointment times are available for a service on a given date. Use "
            "this before offering the caller a specific time. service_name must be one of the "
            "services listed in your instructions, exactly as named there -- never invent one."
        ),
        properties={
            "service_name": {
                "type": "string",
                "description": "The exact name of the service, as listed in your instructions.",
            },
            "date": {
                "type": "string",
                "description": "The date to check, as YYYY-MM-DD.",
            },
            "time": {
                "type": "string",
                "description": (
                    "Optional: a specific time the caller asked about, as 24-hour HH:MM. Omit "
                    "to just see what's available that day."
                ),
            },
        },
        required=["service_name", "date"],
        handler=handler,
    )
