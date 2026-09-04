"""Turns a fetched RuntimeContext into the receptionist's LLM system prompt.

Business profile/hours/services/receptionist config are all prefetched once
at session start (ApiClient.get_runtime_context) and folded in here — they
are small and bounded, so there is no need for a tool/live round-trip for
any of them (only knowledge search is a live tool — see
tools/search_knowledge.py). This means the prompt can go stale if that data
changes mid-call — an accepted, documented limitation for M5 given call
durations are short; see ARCHITECTURE.md "Voice session/runtime design".
"""

from __future__ import annotations

from voice_agent.clients.models import RuntimeContext

_DAY_NAMES = (
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
)


def build_system_prompt(context: RuntimeContext) -> str:
    config = context.receptionist_config
    lines = [
        f"You are {config.display_name}, an AI receptionist. Tone: {config.tone}.",
        config.greeting,
    ]
    if config.instructions:
        lines.append(config.instructions)

    if context.business_profile:
        profile = context.business_profile
        lines.append(f"Business name: {profile.business_name}.")
        if profile.address:
            lines.append(f"Address: {profile.address}.")
        if profile.phone:
            lines.append(f"Phone: {profile.phone}.")

    open_days = [
        f"{_DAY_NAMES[hours.day_of_week]} {hours.open_time}-{hours.close_time}"
        for hours in context.business_hours
        if hours.is_open and hours.open_time and hours.close_time
    ]
    lines.append(
        "Business hours: " + "; ".join(open_days) + "."
        if open_days
        else "Business hours are not currently configured."
    )

    active_service_names = ", ".join(s.name for s in context.services if s.active)
    if active_service_names:
        lines.append(f"Services offered: {active_service_names}.")

    lines.append(
        "If you don't know the answer, use the search_knowledge tool before responding. "
        f"If you still can't help, say: {config.fallback_message}"
    )
    lines.append(f"If contacted outside business hours, say: {config.after_hours_message}")

    return "\n".join(lines)
