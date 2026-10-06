"""M12 Step 6: best-effort, out-of-pipeline call summary generation.

Uses Pipecat's own LLMService.run_inference() -- a one-shot, out-of-pipeline
completion method already implemented by every real LLMService subclass
(see pipecat.services.llm_service.LLMService.run_inference and its OpenAI
implementation in pipecat.services.openai.base_llm) -- so this module adds
no new LLM client, SDK, or provider abstraction.

Never raises: an empty conversation, an inference failure, or a blank
result all become None. Callers must treat None as "no summary available"
and continue the call lifecycle unaffected. This module does not log --
same convention as clients/api_client.py; only session.py is expected to
call logging_config.get_logger() (see that module's docstring).
"""

from __future__ import annotations

from typing import Any

from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.services.llm_service import LLMService

_SUMMARY_INSTRUCTION = (
    "Summarize the phone call above in 1-3 concise sentences of plain text, "
    "suitable for a business owner's call log. Do not use JSON, markdown, or "
    "bullet points -- plain prose only."
)


def _is_plain_conversation_message(message: Any) -> bool:
    return (
        isinstance(message, dict)
        and message.get("role") in ("user", "assistant")
        and isinstance(message.get("content"), str)
    )


async def generate_call_summary(llm: LLMService[Any], context: LLMContext) -> str | None:
    """Best-effort one-shot summary of one call's conversation.

    Builds a fresh LLMContext containing only plain user/assistant text
    turns from `context` -- the system prompt, tool-call requests, and raw
    tool results (which may embed ApiClientError text; see tools/*.py) are
    never included in the new context, so they can never reach the model.
    `context` itself is only read here, never mutated.
    """
    filtered_messages = [
        message for message in context.get_messages() if _is_plain_conversation_message(message)
    ]
    if not filtered_messages:
        return None

    summary_context = LLMContext(messages=filtered_messages)

    try:
        result = await llm.run_inference(
            summary_context, system_instruction=_SUMMARY_INSTRUCTION
        )
    except Exception:
        return None

    if result is None:
        return None

    trimmed = result.strip()
    return trimmed or None
