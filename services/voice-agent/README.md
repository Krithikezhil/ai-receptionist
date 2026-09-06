# services/voice-agent

Python voice service for AI Receptionist. Independently deployable from `apps/api` and `apps/web`.

Part of the `ai-receptionist` monorepo — see the [root README](../../README.md) for
prerequisites and full local-development instructions.

## Python version

Managed by [uv](https://docs.astral.sh/uv/), pinned to **Python 3.12** (`.python-version`,
`requires-python = ">=3.12,<3.13"` in `pyproject.toml`) — independent of whatever Python
version is installed system-wide. `uv sync` downloads and manages this project's Python 3.12
interpreter itself; it does not touch system Python.

We chose 3.12 over the system's 3.14 because 3.12 is the current recommended baseline for the
scientific/AI Python ecosystem (voice/ML libraries this service depends on, including Pipecat,
typically publish and test against 3.10–3.12 first); pinning now avoids a version migration later.

## Structure

```
src/voice_agent/
  config.py       environment settings (incl. INTERNAL_SERVICE_KEY, provider/model selection,
                  idle-timeout validation, Twilio settings)
  routes/         FastAPI routers — GET /health, POST /twilio/voice + WS /twilio/media-stream
                  (twilio.py)
  services/       business logic, framework-agnostic (health)
  clients/        typed HTTP client for apps/api's /internal/v1/* (api_client.py, models.py) —
                  incl. the service-auth-only phone-number lookup
  providers/      STT/LLM/TTS provider factory + fake/no-op doubles
  tools/          read-only function-calling tools (search_knowledge.py)
  runtime/        turns a fetched RuntimeContext into the LLM system prompt
  twilio/         webhook signature verification, call-credential verification, TwiML/URL
                  builders
  pipeline.py     transport-agnostic bot pipeline construction, incl. turn-taking/VAD — unmodified
                  by M7
  session.py      one session's lifecycle: fetch context, build pipeline, idle-timeout/
                  provider-error/disconnect handling, guaranteed cleanup — unmodified by M7,
                  reused as-is by the Twilio Media Stream bridge
  logging_config.py  centralized, secret-safe logger factory — unmodified by M7
  bot.py          manual/local SmallWebRTCTransport smoke-test entry point — NOT in CI
  main.py         FastAPI app factory + entrypoint
tests/            pytest — all against fakes/mocks, no network, no real credentials
```

## Commands (run from this directory)

```bash
uv sync                  # install dependencies into .venv (Python 3.12)
uv run voice-agent       # start the server (http://localhost:8000)
uv run pytest            # run tests
uv run ruff check .      # lint
uv run ruff format .     # format
uv run mypy src          # type-check
```

**Testing strategy**: unit tests use the fake STT/LLM/TTS providers wherever a real provider isn't
specifically what's being tested; HTTP calls to `apps/api` are exercised against a mocked
transport (`httpx.MockTransport`/`respx`), never a real network call. Session-lifecycle tests
(`tests/test_session.py`) replace Pipecat's own `PipelineWorker`/`WorkerRunner` with small
recording doubles, so they verify this service's own wiring — which config a worker is built
with, which handlers get registered, what each one does — without re-testing Pipecat's own frame
draining/cancellation timing, which is the framework's responsibility. No automated test requires
real provider credentials or network access; end-to-end behavior with real providers is a manual,
non-CI step (see "Manual smoke test" below).

## Endpoints

* `GET /health` — liveness check. Does not check any external dependency (no database, no
  telephony provider, no Pipecat pipeline state) — the pipeline is constructed per-session, not
  exposed as an HTTP route of its own.
* `POST /twilio/voice` — Twilio's inbound-call webhook (M7). Validates `X-Twilio-Signature`
  before any other processing; see "Twilio inbound calls (M7)" below.
* `WS /twilio/media-stream` — Twilio's Media Stream bridge (M7). Verifies a call credential
  locally before starting a session; see "Twilio inbound calls (M7)" below.

## How a session works

One session (one call/connection) is built and run by `session.py`'s `run_session()`, which wires
these pieces together in order:

1. **Transport** — a Pipecat `BaseTransport` (today: `SmallWebRTCTransport`, built by `bot.py`)
   provides the audio in/out stream. `session.py` and `pipeline.py` never depend on which concrete
   transport it is.
2. **Internal API client** (`clients/api_client.py`) — fetches that organization's
   `RuntimeContext` (receptionist config, business profile/hours/services) from `apps/api`'s
   `/internal/v1/...` before the pipeline is built. A failure here means the pipeline is never
   constructed at all.
3. **Pipeline construction** (`pipeline.py`) — assembles, in order: the transport's audio input →
   a **VAD stage** (a local, real-time turn-taking/interruption analyzer — no cloud or network
   call) → the **STT provider** → an LLM context aggregator → the **LLM provider** (with the
   `search_knowledge` tool registered) → the **TTS provider** → the transport's audio output.
4. **Knowledge search tool** (`tools/search_knowledge.py`) — the one function the LLM can call
   mid-conversation, scoped to the organization the session was started for (see "Tenant
   isolation" in ARCHITECTURE.md §13.3 — a spoofed organization id in tool arguments cannot
   redirect the search).
5. **Session lifecycle orchestration** (`session.py`) — wraps the built pipeline in a
   `PipelineWorker`, wiring idle-timeout, provider-error, and disconnect handling, and guarantees
   the API client is closed when the session ends.

See ARCHITECTURE.md §12 (foundations) and §13 (real providers, VAD, session lifecycle) for the
full design of each piece.

## Configuration (M5–M7)

Requires `INTERNAL_SERVICE_KEY` (must match `apps/api`'s value exactly) and `API_BASE_URL`
(defaults to `http://localhost:4000`) to call the internal voice API — see the root
[.env.example](../../.env.example). `STT_PROVIDER`/`LLM_PROVIDER`/`TTS_PROVIDER` each default to
`"fake"` (a deterministic, no-network double) — the service boots and every test passes with zero
provider credentials configured. Setting one to a real provider name (`deepgram`/`openai`/
`cartesia`) additionally requires that provider's API key env var.

Real providers also read a model/voice selection, each with its own default:
`DEEPGRAM_MODEL` (default `nova-3-general`) and `OPENAI_MODEL` (default `gpt-4.1`). The Cartesia
TTS provider additionally **requires** `CARTESIA_VOICE_ID` — unlike the model settings above,
Cartesia has no default voice (voice ids are per-account), so selecting `TTS_PROVIDER=cartesia`
without one fails closed with a clear configuration error at startup, rather than silently
falling back to a different provider or an unset voice.

`VOICE_AGENT_IDLE_TIMEOUT_SECS` (default `45`) controls how many seconds of actual caller silence
end a session — on timeout, the session speaks the receptionist's configured fallback message
once, then ends gracefully. This is a silence/inactivity timeout, not an overall session-duration
limit: only the caller speaking resets it, and it does not fire merely because a call has run
long while the caller is actively engaged. A malformed or non-positive value fails closed at
startup with a clear error rather than silently falling back to the default.

Calling the internal API for a specific organization also requires that organization's own
service credential (`X-Organization-Service-Token`) — a separate, per-organization secret from
`INTERNAL_SERVICE_KEY`. It is returned exactly once, in the response body of `apps/api`'s
`POST /organizations` (organization creation) — there is no way to retrieve it again afterward.
Treat it as a secret: never commit it, log it, or share it outside the operator who needs it.

Both Twilio routes are optional per deployment — omitting their env vars leaves `GET /health` and
the manual smoke test (below) fully working; only `/twilio/voice` and `/twilio/media-stream`
themselves fail closed per-request. `TWILIO_AUTH_TOKEN` verifies `X-Twilio-Signature`.
`VOICE_AGENT_PUBLIC_BASE_URL` is the exact public URL Twilio is configured to call — never derived
from request headers — reused to build the `wss://` Media Stream URL in the response TwiML.
`TWILIO_CALL_CREDENTIAL_SECRET` must match `apps/api`'s value exactly (shared, HMAC-verified
call-bound credential — see ARCHITECTURE.md §14.3); apps/api falls back to a random per-boot value
if unset, so a mismatch here simply means every credential fails verification, not a startup
crash. See the root [.env.example](../../.env.example) for all three.

## Twilio inbound calls (M7)

A real inbound phone call reaches the exact same runtime as the manual smoke test below (same
`session.run_session()`, same pipeline, same providers) via `routes/twilio.py` instead of
`bot.py`. Full design: [ARCHITECTURE.md §14](../../ARCHITECTURE.md#14-twilio-inbound-calls-m7),
[SECURITY.md §10](../../SECURITY.md#10-twilio-inbound-call-security-m7).

**Automated coverage (CI-safe, no real Twilio account)**: `tests/test_twilio_signature.py`,
`tests/test_twilio_call_credential.py`, `tests/test_twilio_webhook.py`,
`tests/test_twilio_media_stream.py` — all against fakes/mocks/`respx`, exactly like every other
test in this service.

**Manual live-call verification (not yet performed in this environment)** — requires a real
Twilio account, which was not available during implementation. Not part of CI; tracked as
outstanding in [TASKS.md](../../TASKS.md). To actually run it:

1. Provision one real Twilio phone number; assign it to a real test organization via
   `POST /organizations/:organizationId/phone-numbers` (owner-authenticated).
2. Run `apps/api` and this service publicly reachable (e.g. via ngrok), and set
   `VOICE_AGENT_PUBLIC_BASE_URL` to that exact public URL.
3. In the Twilio Console, set the number's voice webhook to
   `<VOICE_AGENT_PUBLIC_BASE_URL>/twilio/voice`.
4. Call the number from a real phone. Confirm: the webhook signature validates, TwiML is
   returned, the Media Stream connects, the call credential verifies, and a real
   Deepgram/OpenAI/Cartesia conversation happens end-to-end (or the fake providers respond, if
   those are what's configured).
5. Test interruption/barge-in over real PSTN audio.
6. Let `VOICE_AGENT_IDLE_TIMEOUT_SECS` fire on a live call — confirm the fallback message is
   spoken and the call actually ends (this is what would decide whether `auto_hang_up=True` is
   needed instead of the current `False`).
7. Hang up from the caller's side — confirm clean disconnect handling.
8. Call an unmapped/wrong number — confirm a graceful spoken failure message, not a dropped call
   or raw error.
9. Confirm no secrets, signatures, or credentials appear in real logs during any of the above.

Until this procedure has actually been run and its results recorded, M7 should be treated as
structurally complete but **not** live-call-verified.

## Manual smoke test / local business demo (not part of CI)

This is a **developer-run, local-only workflow** — not a customer-facing product surface. It
reuses Pipecat's own official development runner and its prebuilt browser test page
(`pipecat-ai-small-webrtc-prebuilt`); nothing here adds a new public or unauthenticated API
endpoint, and no browser-supplied value is ever trusted as an organization id — the organization
is fixed server-side, from `DEV_SESSION_ORGANIZATION_ID`, before the browser ever connects.

### Prerequisites

* `apps/api` running locally with `INTERNAL_SERVICE_KEY` and `AUTH_SECRET` set — see the root
  [.env.example](../../.env.example).
* A real organization created through `apps/web`'s dashboard (or directly via `apps/api`'s
  `POST /organizations`) — you'll need its id and its one-time service credential.
* Real Deepgram/OpenAI/Cartesia keys **only if** you want to hear a real voice — with the
  default `"fake"` providers this all still works structurally, it just "hears" nothing and
  always replies with the same canned sentence.

### 1. Required environment variables

| Variable | Required | Purpose |
|---|---|---|
| `INTERNAL_SERVICE_KEY` | always | must match `apps/api`'s value exactly |
| `API_BASE_URL` | always (defaults to `http://localhost:4000`) | where `apps/api` is running |
| `DEV_SESSION_ORGANIZATION_ID` | always | which organization this local session runs for |
| `DEV_SESSION_ORGANIZATION_SERVICE_TOKEN` | always | that organization's own service credential
  (shown once, at creation — see "Configuration" above) |
| `STT_PROVIDER`/`LLM_PROVIDER`/`TTS_PROVIDER` | optional | `"fake"` by default; set to
  `deepgram`/`openai`/`cartesia` for a real voice |
| `DEEPGRAM_API_KEY`/`OPENAI_API_KEY`/`CARTESIA_API_KEY`/`CARTESIA_VOICE_ID` | only if using the
  matching real provider | see "Configuration" above |

`bot.py` fails closed with a clear error naming the missing variable if any of the three
always-required ones above are unset — it will not start with an implicit or guessed value.

### 2. Configure a test business

Use the existing `apps/web` dashboard (no new tooling needed): register, create an
organization, fill in a business profile, a few business hours, a service or two, and 2–3
knowledge entries (e.g. an FAQ). Capture the organization id (visible in the dashboard URL) and
the one-time service credential shown in the organization-creation response — this is your only
chance to see it.

### 3. Start the voice agent

From `services/voice-agent`:

```bash
uv run python -m pipecat.runner.run --transport webrtc src/voice_agent/bot.py
```

### 4. Open the URL

The runner prints a local URL (typically `http://localhost:7860`) — open it in Chrome or Edge.
The terminal running `bot.py` also logs which business the session is for, e.g.
`session ...: running for Acme Dental` — confirm it matches the organization you configured.

### 5. Grant microphone permission

The browser will prompt for microphone access on the prebuilt test page — allow it, then
connect.

### 6. A successful first exchange

Say something like *"Hi, what are your hours?"* or *"Do you offer teeth whitening?"* (adjust to
your test business/knowledge). With real providers configured, you should hear a short, natural
spoken reply within a couple of seconds.

### 7. Test interruption / barge-in

While the receptionist is speaking, start talking over it. It should stop speaking and listen —
Pipecat handles this automatically once VAD detects you speaking; no extra code is needed to
test this (see ARCHITECTURE.md §13.2/§13.3).

### 8. Test the silence timeout

Connect, then say nothing at all for `VOICE_AGENT_IDLE_TIMEOUT_SECS` (default 45s — set it
lower, e.g. `VOICE_AGENT_IDLE_TIMEOUT_SECS=10`, to test this quickly). The receptionist should
speak the configured fallback message exactly once, then the session should end on its own.

### 9. Test an unknown question

Ask something with no relevant knowledge entry (e.g. *"What's your return policy on flux
capacitors?"*). The receptionist should say it doesn't know rather than invent an answer — it's
instructed to check `search_knowledge` first and be honest if nothing relevant comes back.

### 10. Stop the session

Close the browser tab, or press Ctrl+C in the terminal running `bot.py`. Either way the session
ends cleanly — closing the tab triggers the transport's disconnect handling (cancels the
session, no dangling audio), and Ctrl+C stops the whole runner process.

### 11. Troubleshooting

* **`RuntimeError: Set DEV_SESSION_ORGANIZATION_ID...`** (or the other two required vars) — the
  named variable is unset; set it and re-run.
* **A `401`-style/`ApiConfigurationError` failure logged at session start** —
  `INTERNAL_SERVICE_KEY` doesn't match `apps/api`'s value, or `apps/api` isn't running at
  `API_BASE_URL`.
* **A `403`-style failure** — the organization service token doesn't belong to
  `DEV_SESSION_ORGANIZATION_ID` (tokens are per-organization and don't transfer — see
  ARCHITECTURE.md §12.3).
* **`ProviderConfigurationError`** logged — a real provider is selected without its API key (or,
  for Cartesia, without `CARTESIA_VOICE_ID`) set; check the table above.
* **No sound, but no error either** — you're likely still on the default `"fake"` providers;
  check `STT_PROVIDER`/`LLM_PROVIDER`/`TTS_PROVIDER`.

### 5-minute local-business demo (condensed)

1. `apps/api` running, an organization + business profile + a couple of knowledge entries set
   up in `apps/web`.
2. Export `INTERNAL_SERVICE_KEY`, `DEV_SESSION_ORGANIZATION_ID`,
   `DEV_SESSION_ORGANIZATION_SERVICE_TOKEN` (and real provider keys if you want a real voice).
3. `uv run python -m pipecat.runner.run --transport webrtc src/voice_agent/bot.py`
4. Open the printed URL, allow the microphone, connect.
5. Ask a question your knowledge base answers, then one it doesn't — confirm an honest "I
   don't know" instead of an invented answer.

## M7 status

Pipecat is a normal dependency (`pipecat-ai`, pinned narrow — see ARCHITECTURE.md §12.4), with a
transport-agnostic pipeline (turn-taking/interruption detection stage), a provider factory
supporting real Deepgram/OpenAI/Cartesia providers with model/voice configuration, a `session.py`
lifecycle orchestrator (idle timeout, provider-error handling, disconnect handling, guaranteed
cleanup), one read-only tool (`search_knowledge`), and, as of M7, a Twilio inbound-call webhook +
Media Stream bridge (`routes/twilio.py`) that reuses that exact same runtime unmodified. No SIP,
no production WebRTC infrastructure, no outbound calling, no SMS. Real-provider behavior (an
actual Deepgram/OpenAI/Cartesia conversation, M6) and a real live Twilio/PSTN call (M7) have
**not** yet been manually verified in this environment — see [TASKS.md](../../TASKS.md),
[ARCHITECTURE.md §13](../../ARCHITECTURE.md#13-real-ai-voice-runtime-m6), and
[ARCHITECTURE.md §14](../../ARCHITECTURE.md#14-twilio-inbound-calls-m7).

### M8 addendum

M8 (knowledge chunking, embedding, and semantic search -- in progress) required no changes to any
file in this directory. `search_knowledge` already calls the same internal `listKnowledge`
endpoint on `apps/api` it always has; only that endpoint's server-side ranking behavior changed,
underneath an unchanged route/auth/response contract. Embeddings are stored as a plain Postgres
`real[]` column on `apps/api`, not a vector database, and are ranked by cosine similarity with a
substring-match fallback — see
[ARCHITECTURE.md §15](../../ARCHITECTURE.md#15-knowledge-chunking-embedding-and-semantic-search-m8).
Only the deterministic `fake` embedding provider has been exercised, including in CI; real OpenAI
embedding quality has **not** yet been manually verified in this environment.
