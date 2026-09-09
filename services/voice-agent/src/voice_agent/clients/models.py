"""Pydantic models mirroring apps/api's internal voice API response shapes.

Kept in sync by hand with packages/shared/src/voice-runtime.ts (the
TypeScript-side canonical type) — Python can't import that package directly,
but the field names/shapes here are written against it. See ARCHITECTURE.md
"Internal voice API".

apps/api returns camelCase JSON (its universal convention); these models
expose idiomatic snake_case attributes and translate automatically via
pydantic's camelCase alias generator.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

KnowledgeCategory = Literal["faq", "policy", "service_info", "custom"]


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ReceptionistConfig(_CamelModel):
    enabled: bool
    display_name: str
    greeting: str
    tone: str
    instructions: str
    fallback_message: str
    after_hours_message: str
    call_transfer_enabled: bool
    call_transfer_phone: str | None
    language: str


class BusinessProfile(_CamelModel):
    business_name: str
    description: str | None
    phone: str | None
    email: str | None
    website: str | None
    address: str | None
    timezone: str


class BusinessHoursEntry(_CamelModel):
    """JS Date#getDay() convention: 0 = Sunday .. 6 = Saturday."""

    day_of_week: int
    is_open: bool
    open_time: str | None
    close_time: str | None


class ServiceItem(_CamelModel):
    id: str
    name: str
    description: str | None
    duration_minutes: int
    price: str | None
    active: bool


class RuntimeContext(_CamelModel):
    """GET /internal/v1/organizations/:id/runtime-context response."""

    organization_id: str
    receptionist_config: ReceptionistConfig
    business_profile: BusinessProfile | None
    business_hours: list[BusinessHoursEntry]
    services: list[ServiceItem]


class KnowledgeEntry(_CamelModel):
    """One entry from GET /internal/v1/organizations/:id/knowledge."""

    id: str
    title: str
    content: str
    category: KnowledgeCategory
    active: bool


class PhoneNumberLookup(_CamelModel):
    """M7: GET /internal/v1/twilio/phone-numbers/:phoneNumber response --
    resolves a dialed Twilio number to the organization it belongs to, and
    a freshly minted, call-bound credential for it (see
    apps/api/src/controllers/internal.controller.ts's lookupPhoneNumber and
    twilio/call_credential.py, which verifies call_credential locally
    before it is ever used)."""

    organization_id: str
    call_credential: str


class AvailabilityResult(_CamelModel):
    """GET /internal/v1/organizations/:id/appointments/availability response
    (M10 Step 7). `status` covers every outcome the endpoint can return
    WITHOUT apps/api/src/controllers/internal.controller.ts's
    checkAppointmentAvailability raising a non-2xx (service_not_found /
    invalid_date / invalid_time / invalid_timezone all map to a raised
    ApiClientError instead -- see ApiClient.check_availability below)."""

    status: Literal["ok", "calendar_not_connected", "calendar_unavailable"]
    slots: list[str] = []
    requested_time_available: bool | None = None
    alternatives: list[str] | None = None


class BookedAppointmentSummary(_CamelModel):
    """The minimal slice of apps/api's full Appointment row a voice call
    actually needs -- deliberately not a full mirror of every column (no
    id/customer fields surfaced back to the LLM). Verified against the real
    Appointment interface (apps/api/src/repositories/appointment-types.ts)
    and internal.controller.ts's bookAppointment handler, which returns
    `{ appointment: result.appointment }` with zero transformation -- the
    wire field names are startTime/endTime (Date -> ISO string via
    JSON.stringify), which _CamelModel's alias_generator maps to
    start_time/end_time here. Extra fields (id, customerName, etc.) are
    silently ignored by pydantic's default extra="ignore" behavior."""

    start_time: str
    end_time: str


class BookAppointmentResult(_CamelModel):
    """POST /internal/v1/organizations/:id/appointments response (M10 Step
    7). "unavailable"/"duplicate_booking" (409) are reachable because
    ApiClient.book_appointment() opts those two statuses out of _post()'s
    default raise-on-non-2xx behavior -- see api_client.py. Every other
    non-2xx (400/404/500) still raises ApiClientError, unchanged."""

    status: Literal[
        "booked",
        "unavailable",
        "duplicate_booking",
        "calendar_not_connected",
        "calendar_unavailable",
    ]
    alternatives: list[str] | None = None
    appointment: BookedAppointmentSummary | None = None
