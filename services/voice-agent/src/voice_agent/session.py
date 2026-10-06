"""Owns one voice session's lifecycle (M6): fetch runtime context, build
providers and the pipeline, run it with idle-timeout / provider-error /
disconnect handling, and guarantee cleanup.

Transport-agnostic like pipeline.py — never imports a telephony-specific
class. Reused by bot.py (manual dev entry point, SmallWebRTCTransport)
today; a future M7 Twilio entry point calls this same function instead of
duplicating orchestration logic.

Every log call in this module goes through logging_config.get_logger() and
must follow that module's documented never-log list — never log a raw
exception message/args (only its class name), never log conversation
content, tool arguments/results, or any credential/header value.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pipecat.frames.frames import Frame, TTSSpeakFrame, UserSpeakingFrame
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.services.llm_service import LLMService
from pipecat.transports.base_transport import BaseTransport
from pipecat.workers.runner import WorkerRunner

from voice_agent.clients.api_client import ApiClient, ApiClientError
from voice_agent.config import Settings
from voice_agent.logging_config import get_logger
from voice_agent.pipeline import build_pipeline
from voice_agent.providers.factory import (
    ProviderConfigurationError,
    create_llm_service,
    create_stt_service,
    create_tts_service,
)
from voice_agent.summary import generate_call_summary

logger = get_logger(__name__)


async def run_session(
    *,
    organization_id: str,
    organization_service_token: str,
    transport: BaseTransport,
    settings: Settings,
    call_sid: str | None = None,
) -> None:
    """Runs one session end-to-end.

    organization_id is resolved once by the caller (today: bot.py's
    DEV_SESSION_ORGANIZATION_ID env var; on the M7 Twilio path,
    routes/twilio.py's verified call credential) and is never re-derived
    from anything inside the session — conversation text, LLM output, and
    tool arguments cannot change which organization this session talks to.
    tools/search_knowledge.py and tools/capture_lead.py only ever read
    caller-stated content from tool arguments, and pipeline.py binds
    organization_id (and call_sid) once when building each tool's schema;
    this function does not alter that. call_sid is the real Twilio call id
    on the M7 path, None on the WebRTC dev-harness path (bot.py) -- passed
    through unchanged to build_pipeline().
    """
    session_id = uuid.uuid4().hex[:8]
    started_at = time.monotonic()
    # M12 Step 6: real wall-clock UTC capture for ApiClient.record_call()'s
    # started_at parameter -- distinct from the `started_at` monotonic
    # value above (used only for the duration math in _on_pipeline_finished
    # below), which can never be formatted as an ISO datetime.
    call_started_at = datetime.now(UTC)
    logger.info("session %s: starting (org=%s)", session_id, organization_id)

    try:
        api_client = ApiClient(
            settings.api_base_url,
            settings.internal_service_key,
            organization_service_token,
        )
    except ApiClientError as exc:
        logger.error(
            "session %s: could not construct API client (%s), not starting",
            session_id,
            type(exc).__name__,
        )
        return

    # The `async with` block is what guarantees ApiClient.close() runs
    # exactly once, on every exit path below (early return, or an exception
    # propagating out of runner.run()) — no separate cleanup flag needed.
    async with api_client:
        # M12 Step 6: shared outcome state for the eventual centralized
        # call-recording finalizer. Terminal handlers below will set
        # `disposition`; nothing yet reads or acts on either variable in
        # this edit -- that lands in a later, separate unit.
        disposition: Literal["completed", "failed", "abandoned"] | None = None
        call_recorded = False
        # M12 Step 6: set only once build_pipeline() has actually returned
        # (see the try/except ProviderConfigurationError block below) --
        # stay None on every pre-worker failure path, which is exactly the
        # signal _record_call_once() uses to skip summary generation.
        llm: LLMService[Any] | None = None
        llm_context: LLMContext | None = None

        async def _record_call_once() -> None:
            # M12 Step 6: the single centralized call-recording attempt.
            # Invoked unconditionally from the `finally` block below, on
            # every exit path that has an ApiClient and a real call_sid --
            # this is the only record_call() call site in this file.
            nonlocal call_recorded
            if call_sid is None or call_recorded:
                return
            call_recorded = True
            ended_at = datetime.now(UTC)
            final_disposition = disposition or "failed"

            # Best-effort only: a slow/failed/timed-out summary must never
            # delay or prevent recording the call itself -- generate_call_summary()
            # already turns its own inference failures into None; the
            # wait_for() timeout is caught here because it is raised by
            # wait_for() itself, not from inside summary generation.
            summary: str | None = None
            if llm is not None and llm_context is not None:
                try:
                    summary = await asyncio.wait_for(
                        generate_call_summary(llm, llm_context),
                        timeout=settings.summary_timeout_secs,
                    )
                except Exception:
                    summary = None

            try:
                await api_client.record_call(
                    organization_id,
                    call_sid=call_sid,
                    started_at=call_started_at,
                    ended_at=ended_at,
                    disposition=final_disposition,
                    summary=summary,
                )
            except ApiClientError as exc:
                logger.error(
                    "session %s: failed to record call metadata (%s)",
                    session_id,
                    type(exc).__name__,
                )

        try:
            try:
                runtime_context = await api_client.get_runtime_context(organization_id)
            except ApiClientError as exc:
                logger.error(
                    "session %s: failed to fetch runtime context (%s), not starting",
                    session_id,
                    type(exc).__name__,
                )
                disposition = "failed"
                return

            # The organization's own configured business name is not caller data
            # or a secret — it is public-facing content the organization itself
            # set (same trust tier as organization_id; see logging_config.py's
            # "safe to log" list). Logging it here satisfies "which business is
            # this session for" without touching anything on the never-log list.
            business_name = (
                runtime_context.business_profile.business_name
                if runtime_context.business_profile
                else "(business name not configured)"
            )
            logger.info("session %s: running for %s", session_id, business_name)

            try:
                # Bound to a name (not passed inline) so the same instance is
                # available to _record_call_once() for summary generation --
                # M12 Step 6 never constructs a second LLM service/client.
                llm = create_llm_service(settings.llm_provider, model=settings.openai_model)
                pipeline, llm_context = build_pipeline(
                    transport=transport,
                    stt=create_stt_service(settings.stt_provider, model=settings.deepgram_model),
                    llm=llm,
                    tts=create_tts_service(settings.tts_provider),
                    runtime_context=runtime_context,
                    api_client=api_client,
                    call_sid=call_sid,
                )
            except ProviderConfigurationError as exc:
                logger.error(
                    "session %s: provider configuration invalid (%s), not starting",
                    session_id,
                    type(exc).__name__,
                )
                disposition = "failed"
                return

            worker = PipelineWorker(
                pipeline,
                idle_timeout_secs=settings.idle_timeout_secs,
                # Only actual user speech resets the idle timer — deliberately
                # narrower than the library default (BotSpeakingFrame,
                # UserSpeakingFrame), so this is a silence timeout, not a
                # general pipeline-activity timeout.
                idle_timeout_frames=(UserSpeakingFrame,),
                # We drive termination ourselves (speak fallback, then end) —
                # the default would cancel the pipeline immediately.
                cancel_on_idle_timeout=False,
                # A provider that becomes unusable ends the session gracefully
                # instead of the default CONTINUE (which would keep reporting
                # errors indefinitely with nothing to fall back to).
                processor_unusable_policy=ProcessorUnusablePolicy.END,
                params=PipelineParams(),
            )

            fallback_message = runtime_context.receptionist_config.fallback_message

            idle_timeout_already_fired = False

            async def _on_idle_timeout(worker: PipelineWorker) -> None:
                nonlocal idle_timeout_already_fired, disposition
                if idle_timeout_already_fired:
                    # Pipecat's idle-timeout monitor loop re-arms itself on a
                    # fixed interval regardless of whether this handler's own
                    # worker.end() call below has finished tearing the session
                    # down — this guard guarantees the caller only ever hears
                    # the fallback message once, and worker.end() is only ever
                    # called once from here.
                    logger.warning(
                        "session %s: idle timeout fired again before the session "
                        "finished ending; ignoring",
                        session_id,
                    )
                    return
                idle_timeout_already_fired = True
                disposition = "abandoned"

                logger.info(
                    "session %s: idle timeout after %.0fs of user silence",
                    session_id,
                    settings.idle_timeout_secs,
                )
                try:
                    # Best-effort only: speaking the fallback must never block
                    # ending the session, and must never retry/loop if it fails.
                    await worker.queue_frame(TTSSpeakFrame(fallback_message))
                except Exception:
                    logger.warning(
                        "session %s: could not queue fallback speech on idle timeout",
                        session_id,
                    )
                await worker.end(reason="idle_timeout")

            worker.add_event_handler("on_idle_timeout", _on_idle_timeout)

            async def _on_pipeline_error(worker: PipelineWorker, frame: Frame) -> None:
                nonlocal disposition
                disposition = "failed"
                # frame.error / frame.exception's message is never logged here —
                # it may embed request/response content from a provider SDK.
                # Only structural metadata (which processor, which exception
                # class, which category) is safe.
                error_frame: Any = frame
                processor_name = (
                    type(error_frame.processor).__name__
                    if getattr(error_frame, "processor", None) is not None
                    else "unknown"
                )
                exception_name = (
                    type(error_frame.exception).__name__
                    if getattr(error_frame, "exception", None) is not None
                    else "unknown"
                )
                category = (
                    error_frame.category.name
                    if getattr(error_frame, "category", None) is not None
                    else "unknown"
                )
                logger.error(
                    "session %s: pipeline error (processor=%s, exception=%s, category=%s)",
                    session_id,
                    processor_name,
                    exception_name,
                    category,
                )

            worker.add_event_handler("on_pipeline_error", _on_pipeline_error)

            async def _on_pipeline_finished(worker: PipelineWorker, frame: Frame) -> None:
                nonlocal disposition
                if disposition is None:
                    disposition = "completed"
                duration = time.monotonic() - started_at
                logger.info(
                    "session %s: finished (%s) after %.1fs",
                    session_id,
                    type(frame).__name__,
                    duration,
                )

            worker.add_event_handler("on_pipeline_finished", _on_pipeline_finished)

            # Registering a handler for an event a given transport never emits
            # is a graceful no-op in Pipecat (it warns once, never raises), so
            # this stays safe to register unconditionally for any BaseTransport
            # — including a future M7 transport that names its disconnect event
            # differently.
            async def _on_client_disconnected(transport: BaseTransport, client: Any) -> None:
                nonlocal disposition
                disposition = "completed"
                logger.info("session %s: client disconnected", session_id)
                # No one is left to hear drained audio, so cancel rather than
                # end(). Safe even if the pipeline is already finishing —
                # cancel() is a no-op once finished, so this can never stack a
                # second failure loop on top of a normal end.
                await worker.cancel(reason="client_disconnected")

            transport.add_event_handler("on_client_disconnected", _on_client_disconnected)

            runner = WorkerRunner()
            await runner.add_workers(worker)
            await runner.run()
        finally:
            await _record_call_once()
