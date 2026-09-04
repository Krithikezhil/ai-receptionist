"""Deterministic, no-network STT/LLM/TTS doubles satisfying Pipecat's own
service base classes.

Used as the default provider for every role (see providers/factory.py) so
the service boots and the full automated test suite passes with zero
provider credentials configured — CI never makes a real STT/LLM/TTS call.
These subclass Pipecat's actual `STTService`/`LLMService`/`TTSService`
rather than a custom interface, so pipeline construction exercises the same
code path a real provider would. See ARCHITECTURE.md "Provider
abstraction".
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from typing import Any

from pipecat.frames.frames import (
    Frame,
    FunctionCallFromLLM,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.llm_service import LLMService
from pipecat.services.stt_service import STTService
from pipecat.services.tts_service import TTSService
from pipecat.utils.time import time_now_iso8601


class FakeSTTService(STTService):
    """Ignores the input audio entirely and yields one canned transcript.

    Good enough to prove a pipeline wires an STT stage correctly without
    decoding real audio or making a network call.
    """

    def __init__(self, *, transcript: str = "What are your business hours?", **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._transcript = transcript

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        yield TranscriptionFrame(
            text=self._transcript,
            user_id="fake-user",
            timestamp=time_now_iso8601(),
        )


class FakeTTSService(TTSService):
    """Ignores the input text entirely and yields one canned silent audio chunk."""

    def __init__(self, *, sample_rate: int = 16000, **kwargs: Any) -> None:
        super().__init__(sample_rate=sample_rate, **kwargs)

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]:
        # 100ms of 16-bit PCM silence at the configured sample rate.
        silence = b"\x00\x00" * (self.sample_rate // 10)
        yield TTSAudioRawFrame(audio=silence, sample_rate=self.sample_rate, num_channels=1)


class FakeLLMService(LLMService):
    """A deterministic stand-in LLM.

    If the most recent user message contains `tool_trigger` (case
    insensitive), simulates the LLM deciding to call the registered
    `search_knowledge` function — dispatched through Pipecat's real
    `run_function_calls`, exercising the actual function-calling machinery
    rather than bypassing it. Otherwise responds with a fixed canned
    sentence. See tools/search_knowledge.py and tests/test_pipeline.py.
    """

    def __init__(
        self,
        *,
        tool_trigger: str = "knowledge",
        canned_response: str = "This is a fake receptionist response.",
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._tool_trigger = tool_trigger.lower()
        self._canned_response = canned_response

    def _last_user_text(self, context: LLMContext) -> str:
        for message in reversed(context.get_messages()):
            if isinstance(message, dict) and message.get("role") == "user":
                content = message.get("content")
                if isinstance(content, str):
                    return content
        return ""

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        # LLMService's own process_frame does NOT call _process_context on
        # LLMContextFrame — only syncs registered tool handlers (see
        # llm_service.py). Each concrete provider is responsible for
        # actually triggering inference and pushing the
        # LLMFullResponseStart/End frames around it (mirrors
        # BaseOpenAILLMService.process_frame) — a real provider does this,
        # so the fake must too, or it would silently never respond.
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMContextFrame):
            await self.push_frame(LLMFullResponseStartFrame())
            try:
                await self._process_context(frame.context)
            finally:
                await self.push_frame(LLMFullResponseEndFrame())
        else:
            await self.push_frame(frame, direction)

    async def _process_context(self, context: LLMContext) -> None:
        last_user_text = self._last_user_text(context)

        if self._tool_trigger in last_user_text.lower():
            await self.run_function_calls(
                [
                    FunctionCallFromLLM(
                        context=context,
                        tool_call_id=f"fake-{uuid.uuid4()}",
                        function_name="search_knowledge",
                        arguments={"query": last_user_text},
                    )
                ]
            )
        else:
            await self._push_llm_text(self._canned_response)
