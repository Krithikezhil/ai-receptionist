"""Environment configuration for the voice-agent service.

Nothing in this module should ever be logged in full — see SECURITY.md.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# M6: Deepgram's own SDK-internal default when no model is configured (see
# pipecat.services.deepgram.stt.DeepgramSTTService's default_settings) —
# mirrored here so it's explicit/configurable rather than implicit.
_DEFAULT_DEEPGRAM_MODEL = "nova-3-general"

# M6: OpenAILLMService's own documented default model (see
# pipecat.services.openai.llm.OpenAILLMService.__init__ docstring) — mirrored
# here for the same reason.
_DEFAULT_OPENAI_MODEL = "gpt-4.1"

# M6: how long a session waits for the user to actually speak
# (UserSpeakingFrame — not general pipeline/bot activity) before it is
# considered idle. Deliberately not an overall session-duration cap. See
# session.py.
_DEFAULT_IDLE_TIMEOUT_SECS = 45.0


class ConfigurationError(Exception):
    """A required environment variable is missing or malformed at startup —
    fails closed rather than falling back to a silently-wrong value."""


@dataclass(frozen=True)
class Settings:
    env: str
    port: int
    log_level: str

    # Internal voice API (apps/api) — see clients/api_client.py.
    api_base_url: str
    internal_service_key: str | None

    # STT/LLM/TTS provider selection — see providers/factory.py. Each
    # defaults to "fake" (a deterministic, no-network double), so the
    # service boots and every automated test passes with zero provider
    # credentials configured. A real value here also requires the matching
    # provider API key (OPENAI_API_KEY / DEEPGRAM_API_KEY /
    # CARTESIA_API_KEY, read directly by the provider SDKs, not by this
    # module) to actually be set.
    stt_provider: str
    llm_provider: str
    tts_provider: str

    # M6: real-provider model selection (see providers/factory.py). Each has
    # a sane, SDK-verified default so an operator only needs to set these to
    # override, not to get a working real provider.
    deepgram_model: str
    openai_model: str

    # M6: seconds of actual user silence (no UserSpeakingFrame) before a
    # session ends itself by speaking the fallback message — see session.py.
    idle_timeout_secs: float

    # M7: Twilio inbound calls (routes/twilio.py). Both deliberately
    # optional at this level, same "fail closed only when the feature is
    # actually invoked" treatment as internal_service_key above -- Twilio
    # integration is optional per deployment, so a deployment that never
    # configures it should not be forced to set these. The webhook route
    # itself checks both are present before doing anything else.
    #
    # Explicit `= None` defaults (not just `str | None` typing) are
    # required here, not cosmetic: a dataclass field's type allowing None
    # does not make it optional in the constructor -- only an explicit
    # default does. Without these defaults, every existing Settings(...)
    # call site across the test suite (none of which pass these two new
    # M7 fields) would fail with a TypeError, which is exactly what
    # happened before this fix -- see tests/test_session.py's _settings()
    # helper, an M6 test file that must stay unaffected by M7 additions.
    twilio_auth_token: str | None = None
    # The operator-configured public URL Twilio is configured to call --
    # never derived from request headers (X-Forwarded-* is not a trusted
    # boundary in this deployment). Used both to build the exact canonical
    # URL Twilio's signature was computed over (twilio/webhook.py) and to
    # build the wss:// Media Stream URL embedded in the response TwiML, so
    # there is exactly one "how the outside world reaches this service"
    # value, not two that could drift apart.
    voice_agent_public_base_url: str | None = None
    # M7: shared with apps/api (auth/call-credential.ts) -- used ONLY to
    # verify a call credential locally (twilio/call_credential.py), never
    # to mint one; voice-agent never mints a call credential. Same
    # optional-with-a-None-default treatment as the two fields above, for
    # the same reasons (feature-optional, and every existing Settings(...)
    # call site must keep working unchanged).
    twilio_call_credential_secret: str | None = None


def _parse_idle_timeout_secs() -> float:
    raw = os.environ.get("VOICE_AGENT_IDLE_TIMEOUT_SECS")
    if raw is None or raw == "":
        return _DEFAULT_IDLE_TIMEOUT_SECS
    try:
        value = float(raw)
    except ValueError as exc:
        raise ConfigurationError(
            f"VOICE_AGENT_IDLE_TIMEOUT_SECS={raw!r} is not a number. "
            "Set it to a positive number of seconds, e.g. 45."
        ) from exc
    if value <= 0:
        raise ConfigurationError(
            f"VOICE_AGENT_IDLE_TIMEOUT_SECS={raw!r} must be a positive number of seconds."
        )
    return value


def get_settings() -> Settings:
    return Settings(
        env=os.environ.get("NODE_ENV", "development"),
        port=int(os.environ.get("VOICE_AGENT_PORT", "8000")),
        log_level=os.environ.get("VOICE_AGENT_LOG_LEVEL", "info"),
        api_base_url=os.environ.get("API_BASE_URL", "http://localhost:4000"),
        # Deliberately no default — see ApiClient, which fails closed if this
        # is unset when a real internal-API call is actually attempted, the
        # same "assert only when the feature is used" pattern apps/api uses
        # for its own secrets.
        internal_service_key=os.environ.get("INTERNAL_SERVICE_KEY"),
        stt_provider=os.environ.get("STT_PROVIDER", "fake"),
        llm_provider=os.environ.get("LLM_PROVIDER", "fake"),
        tts_provider=os.environ.get("TTS_PROVIDER", "fake"),
        deepgram_model=os.environ.get("DEEPGRAM_MODEL", _DEFAULT_DEEPGRAM_MODEL),
        openai_model=os.environ.get("OPENAI_MODEL", _DEFAULT_OPENAI_MODEL),
        idle_timeout_secs=_parse_idle_timeout_secs(),
        twilio_auth_token=os.environ.get("TWILIO_AUTH_TOKEN"),
        voice_agent_public_base_url=os.environ.get("VOICE_AGENT_PUBLIC_BASE_URL"),
        twilio_call_credential_secret=os.environ.get("TWILIO_CALL_CREDENTIAL_SECRET"),
    )
