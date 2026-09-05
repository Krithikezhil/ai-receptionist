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
