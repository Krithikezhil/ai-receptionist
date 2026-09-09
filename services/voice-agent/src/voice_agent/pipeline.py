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

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.services.llm_service import LLMService
from pipecat.services.stt_service import STTService
from pipecat.services.tts_service import TTSService
from pipecat.transports.base_transport import BaseTransport

from voice_agent.clients.api_client import ApiClient
from voice_agent.clients.models import RuntimeContext
from voice_agent.runtime.context import build_system_prompt
from voice_agent.tools.book_appointment import build_book_appointment_schema
from voice_agent.tools.capture_lead import build_capture_lead_schema
from voice_agent.tools.check_availability import build_check_availability_schema
from voice_agent.tools.search_knowledge import build_search_knowledge_schema


def build_pipeline(
    *,
    transport: BaseTransport,
    stt: STTService,
    llm: LLMService[Any],
    tts: TTSService,
    runtime_context: RuntimeContext,
    api_client: ApiClient,
    call_sid: str | None = None,
) -> Pipeline:
    """Builds one call/session's pipeline.

    Called once per connection with that session's already-fetched
    RuntimeContext (see clients/api_client.py) and an ApiClient the
    search_knowledge/capture_lead tools use for live queries/writes.
    call_sid is the real Twilio call id when this session came from the M7
    Twilio path (see routes/twilio.py); None on the WebRTC dev-harness path
    (bot.py), where no real call exists -- capture_lead.py passes it
    through to apps/api as purely informational, never a foreign key. Session
    state (the LLMContext, its aggregators) lives only in this pipeline
    instance's memory for the connection's lifetime — nothing here is
    persisted.
    """
    search_knowledge_schema = build_search_knowledge_schema(
        api_client, runtime_context.organization_id
    )
    capture_lead_schema = build_capture_lead_schema(
        api_client, runtime_context.organization_id, call_sid
    )
    check_availability_schema = build_check_availability_schema(
        api_client, runtime_context.organization_id, runtime_context.services
    )
    book_appointment_schema = build_book_appointment_schema(
        api_client, runtime_context.organization_id, call_sid, runtime_context.services
    )

    context = LLMContext(
        messages=[{"role": "system", "content": build_system_prompt(runtime_context)}],
        tools=[
            search_knowledge_schema,
            capture_lead_schema,
            check_availability_schema,
            book_appointment_schema,
        ],
    )
    context_aggregator = LLMContextAggregatorPair(context)

    return Pipeline(
        [
            transport.input(),
            # Real-time turn-taking/interruption detection. A local ONNX
            # model (no network, no provider credentials) — see
            # providers/factory.py for why STT/LLM/TTS stay separately
            # provider-selectable while VAD does not need to be.
            VADProcessor(vad_analyzer=SileroVADAnalyzer()),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )
