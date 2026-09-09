"""Unit tests for runtime/context.py's build_system_prompt.

The fixed behavioral guardrails must always be present and must never name a
specific business vertical (restaurant, salon, dental, etc.) — every
business-specific detail must come from the RuntimeContext, never be
hardcoded. No network, no real credentials.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest

import voice_agent.runtime.context as context_module
from voice_agent.clients.models import (
    BusinessProfile,
    ReceptionistConfig,
    RuntimeContext,
)
from voice_agent.runtime.context import build_system_prompt

_BASE_CONFIG_KWARGS: dict[str, Any] = dict(
    enabled=True,
    display_name="Test Receptionist",
    greeting="Thanks for calling!",
    tone="friendly",
    instructions="",
    fallback_message="Let me have someone follow up.",
    after_hours_message="We're closed right now.",
    call_transfer_enabled=False,
    call_transfer_phone=None,
    language="en",
)


def _context(**overrides: Any) -> RuntimeContext:
    base: dict[str, Any] = dict(
        organization_id="org-1",
        receptionist_config=ReceptionistConfig(**_BASE_CONFIG_KWARGS),
        business_profile=None,
        business_hours=[],
        services=[],
    )
    base.update(overrides)
    return RuntimeContext(**base)


def test_prompt_includes_the_configured_business_name_and_tone() -> None:
    prompt = build_system_prompt(_context())
    assert "Test Receptionist" in prompt
    assert "friendly" in prompt


def test_prompt_instructs_the_model_to_never_invent_business_facts() -> None:
    prompt = build_system_prompt(_context()).lower()
    assert "never guess" in prompt or "invent" in prompt


def test_prompt_instructs_the_model_never_to_claim_unavailable_actions() -> None:
    prompt = build_system_prompt(_context()).lower()
    assert "book appointments" in prompt
    assert "can't do that" in prompt


def test_prompt_instructs_the_model_to_stay_concise_and_conversational() -> None:
    prompt = build_system_prompt(_context()).lower()
    assert "one or two sentences" in prompt
    assert "bullet points" in prompt


def test_prompt_instructs_the_model_never_to_expose_internal_details() -> None:
    prompt = build_system_prompt(_context()).lower()
    assert "system prompt" in prompt
    assert "never reveal" in prompt or "never discuss" in prompt


def test_prompt_includes_the_configured_fallback_and_after_hours_messages() -> None:
    prompt = build_system_prompt(
        _context(
            receptionist_config=ReceptionistConfig(
                **{
                    **_BASE_CONFIG_KWARGS,
                    "fallback_message": "UNIQUE_FALLBACK_TEXT",
                    "after_hours_message": "UNIQUE_AFTER_HOURS_TEXT",
                }
            )
        )
    )
    assert "UNIQUE_FALLBACK_TEXT" in prompt
    assert "UNIQUE_AFTER_HOURS_TEXT" in prompt


def test_prompt_never_hardcodes_a_specific_business_vertical() -> None:
    """The fixed guardrail text must work for a restaurant, salon, dental
    office, repair shop, or professional service — it must never name a
    specific vertical itself; only the configured business_name may."""
    prompt = build_system_prompt(
        _context(
            business_profile=BusinessProfile(
                business_name="Acme Co",
                description=None,
                phone=None,
                email=None,
                website=None,
                address=None,
                timezone="UTC",
            )
        )
    ).lower()
    for vertical in ("restaurant", "salon", "dental", "clinic", "repair shop", "retail store"):
        assert vertical not in prompt


def test_prompt_includes_todays_date_and_timezone_when_business_profile_has_a_valid_timezone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Uses a monkeypatched ZoneInfo lookup rather than depending on real
    IANA tzdata being installed on the machine running this test -- Windows
    has no OS-level zoneinfo database, and this project does not depend on
    the separate `tzdata` PyPI package (see the discovered gap flagged in
    this session's implementation report). This test verifies
    build_system_prompt's own code path (a valid timezone -> the date line
    is appended), not the OS's timezone database."""
    monkeypatch.setattr(context_module, "ZoneInfo", lambda key: UTC)

    prompt = build_system_prompt(
        _context(
            business_profile=BusinessProfile(
                business_name="Acme Co",
                description=None,
                phone=None,
                email=None,
                website=None,
                address=None,
                timezone="America/New_York",
            )
        )
    )
    assert "Today's date is" in prompt
    assert "America/New_York" in prompt


def test_prompt_includes_todays_date_using_the_real_installed_tzdata() -> None:
    expected_now = datetime.now(ZoneInfo("America/New_York"))
    expected_date = expected_now.strftime("%A, %Y-%m-%d")

    prompt = build_system_prompt(
        _context(
            business_profile=BusinessProfile(
                business_name="Acme Co",
                description=None,
                phone=None,
                email=None,
                website=None,
                address=None,
                timezone="America/New_York",
            )
        )
    )

    assert "Today's date is" in prompt
    assert expected_date in prompt
    assert "America/New_York" in prompt


def test_prompt_omits_the_date_line_when_business_profile_is_absent() -> None:
    """Existing conditional-omission precedent, re-confirmed for the new
    date/timezone line specifically -- business_profile=None is the default
    in _context()."""
    prompt = build_system_prompt(_context())
    assert "Today's date is" not in prompt


def test_prompt_omits_the_date_line_when_the_configured_timezone_is_invalid() -> None:
    """Fails closed -- never fabricates a date or falls back to UTC when the
    configured timezone string isn't a real IANA zone."""
    prompt = build_system_prompt(
        _context(
            business_profile=BusinessProfile(
                business_name="Acme Co",
                description=None,
                phone=None,
                email=None,
                website=None,
                address=None,
                timezone="Not/A_Real_Zone",
            )
        )
    )
    assert "Today's date is" not in prompt
