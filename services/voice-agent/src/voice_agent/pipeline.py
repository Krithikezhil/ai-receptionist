"""Transport-agnostic bot pipeline: STT -> LLM (context + tools) -> TTS.

Takes any Pipecat `BaseTransport` and contains zero telephony-specific
code — it never imports a Twilio/Telnyx/Plivo-related class. The only
transport actually instantiated anywhere in M5 is `SmallWebRTCTransport`,
and that happens only in dev_session.py (a manual, non-CI, local
smoke-test entry point) — this module never references it. A future M6
Twilio transport is a new instantiation point that calls this same
function; it does not require changing anything here. See ARCHITECTURE.md
"Pipecat integration design".
"""

from __future__ import annotations

from typing import Any

from pipecat.pipeline.pipeline import Pipeline
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.services.llm_service import LLMService
from pipecat.services.stt_service import STTService
from pipecat.services.tts_service import TTSService
from pipecat.transports.base_transport import BaseTransport

from voice_agent.clients.api_client import ApiClient
from voice_agent.clients.models import RuntimeContext
from voice_agent.runtime.context import build_system_prompt
from voice_agent.tools.search_knowledge import build_search_knowledge_schema


def build_pipeline(
    *,
    transport: BaseTransport,
    stt: STTService,
    llm: LLMService[Any],
    tts: TTSService,
    runtime_context: RuntimeContext,
    api_client: ApiClient,
) -> Pipeline:
    """Builds one call/session's pipeline.

    Called once per connection with that session's already-fetched
    RuntimeContext (see clients/api_client.py) and an ApiClient the
    search_knowledge tool uses for live queries. Session state (the
    LLMContext, its aggregators) lives only in this pipeline instance's
    memory for the connection's lifetime — nothing here is persisted.
    """
    search_knowledge_schema = build_search_knowledge_schema(
        api_client, runtime_context.organization_id
    )

    context = LLMContext(
        messages=[{"role": "system", "content": build_system_prompt(runtime_context)}],
        tools=[search_knowledge_schema],
    )
    context_aggregator = LLMContextAggregatorPair(context)

    return Pipeline(
        [
            transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )
