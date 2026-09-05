"""Fakes-only tests for session.py's lifecycle orchestration.

PipelineWorker and WorkerRunner (Pipecat's own framework classes) are
substituted with small recording stand-ins so these tests run in
milliseconds and verify OUR wiring — which kwargs PipelineWorker is built
with, which handlers get registered, what each handler does — without
re-testing Pipecat's own frame-draining/cancellation timing, which is the
framework's job, not session.py's. (A bare fake transport with no real
audio sink takes many real seconds to drain/cancel through the actual
PipelineWorker/WorkerRunner, which is not something a fast unit test should
pay for; genuine end-to-end behavior is exercised by the manual
real-provider smoke test instead — see README.md.)

ApiClient's real HTTP calls are mocked via respx (an httpx transport mock,
already a dev dependency), so ApiClient's real request/response/cleanup
logic runs for real — only the Pipecat pipeline-execution boundary is
replaced.

session.py has no separate _cleanup()/close() helper of its own — it relies
entirely on `async with api_client:` (ApiClient's own async-context-manager
protocol) to guarantee ApiClient.close() runs exactly once on every exit
path. The close_tracking fixture below verifies that contract directly by
wrapping the real ApiClient.close, not by asserting a helper method exists.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx
from pipecat.frames.frames import ErrorFrame, TTSSpeakFrame, UserSpeakingFrame
from pipecat.pipeline.worker import ProcessorUnusablePolicy
from pipecat.processors.frame_processor import FrameProcessor
from pipecat.transports.base_transport import BaseTransport

from voice_agent import session as session_module
from voice_agent.clients.api_client import ApiClient
from voice_agent.config import Settings

ORG_ID = "11111111-1111-1111-1111-111111111111"
ORG_TOKEN = "test-org-token"
API_BASE_URL = "http://internal-api.test"

RUNTIME_CONTEXT_JSON = {
    "runtimeContext": {
        "organizationId": ORG_ID,
        "receptionistConfig": {
            "enabled": True,
            "displayName": "AI Receptionist",
            "greeting": "Hi!",
            "tone": "friendly",
            "instructions": "",
            "fallbackMessage": "Sorry, I have to go now.",
            "afterHoursMessage": "We're closed.",
            "callTransferEnabled": False,
            "callTransferPhone": None,
            "language": "en",
        },
        "businessProfile": None,
        "businessHours": [],
        "services": [],
    }
}


def _settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = dict(
        env="test",
        port=8000,
        log_level="info",
        api_base_url=API_BASE_URL,
        internal_service_key="test-internal-key",
        stt_provider="fake",
        llm_provider="fake",
        tts_provider="fake",
        deepgram_model="nova-3-general",
        openai_model="gpt-4.1",
        idle_timeout_secs=45.0,
    )
    base.update(overrides)
    return Settings(**base)


class _FakeTransport(BaseTransport):
    """Minimal BaseTransport double (same role as test_build_pipeline.py's).

    Pre-registers "on_client_disconnected" itself, mirroring what a real
    transport (e.g. SmallWebRTCTransport) does in its own __init__ —
    without this, add_event_handler() for an unregistered event name is a
    silent no-op (verified against the installed pipecat-ai source), so the
    disconnect-handling test below would have nothing to call.
    """

    def __init__(self) -> None:
        super().__init__()
        self._register_event_handler("on_client_disconnected")

    def input(self) -> FrameProcessor:
        return FrameProcessor(name="fake-transport-input")

    def output(self) -> FrameProcessor:
        return FrameProcessor(name="fake-transport-output")


class _RecordingWorker:
    """Stand-in for PipelineWorker: records construction kwargs and
    registered event handlers. end/cancel/queue_frame record every call
    (not just the latest), so tests can assert something was never called,
    or called exactly once — not just what its final state happened to be.
    """

    def __init__(self, pipeline: Any, **kwargs: Any) -> None:
        self.pipeline = pipeline
        self.kwargs = kwargs
        self.handlers: dict[str, Any] = {}
        self.end_calls: list[str | None] = []
        self.cancel_calls: list[str | None] = []
        self.queued_frames: list[Any] = []

    def add_event_handler(self, event_name: str, handler: Any) -> None:
        self.handlers[event_name] = handler

    async def queue_frame(self, frame: Any, direction: Any = None) -> None:
        self.queued_frames.append(frame)

    async def end(self, *, reason: str | None = None) -> None:
        self.end_calls.append(reason)

    async def cancel(self, *, reason: str | None = None) -> None:
        self.cancel_calls.append(reason)


class _RecordingRunner:
    """Stand-in for WorkerRunner — completes immediately."""

    def __init__(self) -> None:
        self.workers: list[Any] = []

    async def add_workers(self, *workers: Any) -> None:
        self.workers.extend(workers)

    async def run(self, *args: Any, **kwargs: Any) -> None:
        return None


@pytest.fixture
def recorded(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Patches PipelineWorker/WorkerRunner inside session.py and captures
    the single worker instance run_session() builds."""
    state: dict[str, Any] = {}

    def _fake_worker(pipeline: Any, **kwargs: Any) -> _RecordingWorker:
        worker = _RecordingWorker(pipeline, **kwargs)
        state["worker"] = worker
        return worker

    monkeypatch.setattr(session_module, "PipelineWorker", _fake_worker)
    monkeypatch.setattr(session_module, "WorkerRunner", _RecordingRunner)
    return state


@pytest.fixture
def close_tracking(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Wraps the real ApiClient.close() to count invocations.

    session.py has no _cleanup() method of its own — this fixture verifies
    the actual contract it relies on instead: the `async with api_client:`
    block in run_session() must call the real close() exactly once, on
    every exit path (early return or an exception propagating out of
    runner.run()).
    """
    calls: list[int] = []
    original_close = ApiClient.close

    async def tracking_close(self: ApiClient) -> None:
        calls.append(1)
        await original_close(self)

    monkeypatch.setattr(ApiClient, "close", tracking_close)
    return calls


def _mock_runtime_context() -> respx.MockRouter:
    mock = respx.mock(base_url=API_BASE_URL)
    mock.get(f"/internal/v1/organizations/{ORG_ID}/runtime-context").mock(
        return_value=httpx.Response(200, json=RUNTIME_CONTEXT_JSON)
    )
    return mock


@pytest.mark.asyncio
async def test_missing_organization_token_returns_cleanly_without_a_pipeline(
    recorded: dict[str, Any], close_tracking: list[int]
) -> None:
    """ApiClient's own fail-closed ApiConfigurationError (raised at
    construction, before any `async with` block exists) is caught in
    run_session(); nothing was ever constructed, so nothing needs closing.
    """
    await session_module.run_session(
        organization_id=ORG_ID,
        organization_service_token="",
        transport=_FakeTransport(),
        settings=_settings(),
    )
    assert "worker" not in recorded
    assert close_tracking == []


@pytest.mark.asyncio
async def test_runtime_context_fetch_failure_closes_api_client_exactly_once(
    recorded: dict[str, Any], close_tracking: list[int]
) -> None:
    with respx.mock(base_url=API_BASE_URL) as mock:
        mock.get(f"/internal/v1/organizations/{ORG_ID}/runtime-context").mock(
            return_value=httpx.Response(404, json={"error": "Organization not found."})
        )
        await session_module.run_session(
            organization_id=ORG_ID,
            organization_service_token=ORG_TOKEN,
            transport=_FakeTransport(),
            settings=_settings(),
        )
    assert "worker" not in recorded
    assert close_tracking == [1]


@pytest.mark.asyncio
async def test_provider_configuration_failure_closes_api_client_exactly_once(
    recorded: dict[str, Any], close_tracking: list[int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("DEEPGRAM_API_KEY", raising=False)
    with _mock_runtime_context():
        await session_module.run_session(
            organization_id=ORG_ID,
            organization_service_token=ORG_TOKEN,
            transport=_FakeTransport(),
            settings=_settings(stt_provider="deepgram"),
        )
    assert "worker" not in recorded
    assert close_tracking == [1]


@pytest.mark.asyncio
async def test_normal_session_closes_api_client_exactly_once_and_builds_worker_correctly(
    recorded: dict[str, Any], close_tracking: list[int]
) -> None:
    with _mock_runtime_context():
        await session_module.run_session(
            organization_id=ORG_ID,
            organization_service_token=ORG_TOKEN,
            transport=_FakeTransport(),
            settings=_settings(idle_timeout_secs=45.0),
        )
    worker = recorded["worker"]
    assert worker.kwargs["idle_timeout_secs"] == 45.0
    # Only actual user speech resets the idle timer — not general pipeline
    # activity (e.g. the bot's own BotSpeakingFrame), and distinct from any
    # overall session-duration cap (not built — see the M6 plan).
    assert worker.kwargs["idle_timeout_frames"] == (UserSpeakingFrame,)
    assert worker.kwargs["cancel_on_idle_timeout"] is False
    assert worker.kwargs["processor_unusable_policy"] is ProcessorUnusablePolicy.END
    assert set(worker.handlers) == {
        "on_idle_timeout",
        "on_pipeline_error",
        "on_pipeline_finished",
    }
    assert close_tracking == [1]


@pytest.mark.asyncio
async def test_idle_timeout_speaks_fallback_then_ends_exactly_once_without_looping(
    recorded: dict[str, Any],
) -> None:
    with _mock_runtime_context():
        await session_module.run_session(
            organization_id=ORG_ID,
            organization_service_token=ORG_TOKEN,
            transport=_FakeTransport(),
            settings=_settings(),
        )
    worker = recorded["worker"]

    await worker.handlers["on_idle_timeout"](worker)

    assert len(worker.queued_frames) == 1
    assert isinstance(worker.queued_frames[0], TTSSpeakFrame)
    assert worker.queued_frames[0].text == "Sorry, I have to go now."
    assert worker.end_calls == ["idle_timeout"]
    # Ends gracefully, exactly once — never cancels, never retries/loops.
    assert worker.cancel_calls == []


@pytest.mark.asyncio
async def test_pipeline_error_handler_relies_on_end_policy_without_looping_or_terminating_itself(
    recorded: dict[str, Any],
) -> None:
    """The handler itself must never try to end/cancel the session or retry
    — actual termination on an unusable processor is Pipecat's own
    responsibility, driven by processor_unusable_policy=END (asserted
    directly against the real PipelineWorker constructor arguments below),
    not by anything _on_pipeline_error does. Calling the handler twice (as
    if two ErrorFrames arrived) must not raise or accumulate any retry
    state.
    """
    with _mock_runtime_context():
        await session_module.run_session(
            organization_id=ORG_ID,
            organization_service_token=ORG_TOKEN,
            transport=_FakeTransport(),
            settings=_settings(),
        )
    worker = recorded["worker"]
    assert worker.kwargs["processor_unusable_policy"] is ProcessorUnusablePolicy.END

    error_frame = ErrorFrame(error="boom", exception=RuntimeError("boom"))
    await worker.handlers["on_pipeline_error"](worker, error_frame)
    await worker.handlers["on_pipeline_error"](worker, error_frame)  # 2nd error: no crash, no loop

    assert worker.end_calls == []
    assert worker.cancel_calls == []
    assert worker.queued_frames == []


@pytest.mark.asyncio
async def test_pipeline_error_handler_never_logs_raw_error_or_exception_text(
    recorded: dict[str, Any], caplog: pytest.LogCaptureFixture
) -> None:
    with _mock_runtime_context():
        await session_module.run_session(
            organization_id=ORG_ID,
            organization_service_token=ORG_TOKEN,
            transport=_FakeTransport(),
            settings=_settings(),
        )
    worker = recorded["worker"]
    sensitive_detail = "sk-should-never-appear-in-logs"
    error_frame = ErrorFrame(error=sensitive_detail, exception=RuntimeError(sensitive_detail))

    with caplog.at_level("ERROR", logger="voice_agent.session"):
        await worker.handlers["on_pipeline_error"](worker, error_frame)

    logged_text = " ".join(r.message for r in caplog.records)
    assert sensitive_detail not in logged_text
    # Only safe, structural metadata (the exception's class name) is logged.
    assert "RuntimeError" in logged_text


@pytest.mark.asyncio
async def test_client_disconnect_cancels_rather_than_ends(recorded: dict[str, Any]) -> None:
    transport = _FakeTransport()
    with _mock_runtime_context():
        await session_module.run_session(
            organization_id=ORG_ID,
            organization_service_token=ORG_TOKEN,
            transport=transport,
            settings=_settings(),
        )
    worker = recorded["worker"]
    disconnect_handler = transport._event_handlers["on_client_disconnected"].handlers[0]

    await disconnect_handler(transport, None)

    assert worker.cancel_calls == ["client_disconnected"]
    # No one is left to hear drained audio, so this cancels — it never
    # calls end() (which would try to drain first).
    assert worker.end_calls == []


@pytest.mark.asyncio
async def test_idle_timeout_firing_twice_only_speaks_the_fallback_once(
    recorded: dict[str, Any],
) -> None:
    """Guards against Pipecat's idle-timeout monitor loop re-arming itself
    before the first end() call finishes (see ARCHITECTURE.md §13.3) — the
    caller must never hear the fallback message twice, and worker.end()
    must only ever be called once from this handler."""
    with _mock_runtime_context():
        await session_module.run_session(
            organization_id=ORG_ID,
            organization_service_token=ORG_TOKEN,
            transport=_FakeTransport(),
            settings=_settings(),
        )
    worker = recorded["worker"]

    await worker.handlers["on_idle_timeout"](worker)
    await worker.handlers["on_idle_timeout"](worker)  # simulated Pipecat re-fire

    assert len(worker.queued_frames) == 1
    assert worker.end_calls == ["idle_timeout"]


@pytest.mark.asyncio
async def test_two_organizations_never_share_runtime_context_or_fallback_message(
    recorded: dict[str, Any],
) -> None:
    """A second session for a different organization must never see the
    first organization's runtime context (business name, fallback message)
    — proves tenant isolation at the run_session() level, not just inside
    the search_knowledge tool handler. Uses genuinely distinct mocked data
    for each organization (different id, business name, fallback message,
    and service-token), not two copies of the same fixture."""
    org_b_id = "44444444-4444-4444-4444-444444444444"
    org_b_token = "org-b-own-distinct-token"
    org_b_json = {
        "runtimeContext": {
            "organizationId": org_b_id,
            "receptionistConfig": {
                "enabled": True,
                "displayName": "Org B Receptionist",
                "greeting": "Thanks for calling Org B!",
                "tone": "upbeat",
                "instructions": "",
                "fallbackMessage": "Org B's own fallback — never Org A's.",
                "afterHoursMessage": "Org B is closed right now.",
                "callTransferEnabled": False,
                "callTransferPhone": None,
                "language": "en",
            },
            "businessProfile": {
                "businessName": "Org B's Business, never Org A's",
                "description": None,
                "phone": None,
                "email": None,
                "website": None,
                "address": None,
                "timezone": "UTC",
            },
            "businessHours": [],
            "services": [],
        }
    }

    with _mock_runtime_context():
        await session_module.run_session(
            organization_id=ORG_ID,
            organization_service_token=ORG_TOKEN,
            transport=_FakeTransport(),
            settings=_settings(),
        )
    worker_a = recorded["worker"]

    with respx.mock(base_url=API_BASE_URL) as mock:
        mock.get(f"/internal/v1/organizations/{org_b_id}/runtime-context").mock(
            return_value=httpx.Response(200, json=org_b_json)
        )
        await session_module.run_session(
            organization_id=org_b_id,
            organization_service_token=org_b_token,
            transport=_FakeTransport(),
            settings=_settings(),
        )
    worker_b = recorded["worker"]

    assert worker_a is not worker_b

    await worker_a.handlers["on_idle_timeout"](worker_a)
    await worker_b.handlers["on_idle_timeout"](worker_b)

    assert worker_a.queued_frames[0].text == "Sorry, I have to go now."
    assert worker_b.queued_frames[0].text == "Org B's own fallback — never Org A's."


@pytest.mark.asyncio
async def test_normal_session_never_logs_service_tokens_or_the_internal_service_key(
    recorded: dict[str, Any], caplog: pytest.LogCaptureFixture
) -> None:
    """Broader than the single-handler check above: a full normal session
    run must never emit either credential anywhere in its logs, not just
    inside the pipeline-error handler."""
    secret_org_token = "org-token-should-never-appear-in-any-log-line"  # noqa: S105
    secret_internal_key = "internal-key-should-never-appear-in-any-log-line"  # noqa: S105
    with _mock_runtime_context():
        with caplog.at_level("DEBUG"):
            await session_module.run_session(
                organization_id=ORG_ID,
                organization_service_token=secret_org_token,
                transport=_FakeTransport(),
                settings=_settings(internal_service_key=secret_internal_key),
            )

    logged_text = " ".join(r.message for r in caplog.records)
    assert secret_org_token not in logged_text
    assert secret_internal_key not in logged_text
