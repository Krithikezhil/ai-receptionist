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
  config.py       environment settings (incl. INTERNAL_SERVICE_KEY, provider selection)
  routes/         FastAPI routers — GET /health only
  services/       business logic, framework-agnostic (health)
  clients/        typed HTTP client for apps/api's /internal/v1/* (api_client.py, models.py)
  providers/      STT/LLM/TTS provider factory + fake/no-op doubles
  tools/          read-only function-calling tools (search_knowledge.py)
  runtime/        turns a fetched RuntimeContext into the LLM system prompt
  pipeline.py     transport-agnostic bot pipeline construction
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

## Endpoints

* `GET /health` — liveness check. Does not check any external dependency (no database, no
  telephony provider, no Pipecat pipeline state) — the pipeline is constructed per-session, not
  exposed as an HTTP route of its own.

## Configuration (M5)

Requires `INTERNAL_SERVICE_KEY` (must match `apps/api`'s value exactly) and `API_BASE_URL`
(defaults to `http://localhost:4000`) to call the internal voice API — see the root
[.env.example](../../.env.example). `STT_PROVIDER`/`LLM_PROVIDER`/`TTS_PROVIDER` each default to
`"fake"` (a deterministic, no-network double) — the service boots and every test passes with zero
provider credentials configured. Setting one to a real provider name (`deepgram`/`openai`/
`cartesia`) additionally requires that provider's API key env var.

Calling the internal API for a specific organization also requires that organization's own
service credential (`X-Organization-Service-Token`) — a separate, per-organization secret from
`INTERNAL_SERVICE_KEY`. It is returned exactly once, in the response body of `apps/api`'s
`POST /organizations` (organization creation) — there is no way to retrieve it again afterward.
Treat it as a secret: never commit it, log it, or share it outside the operator who needs it.

## Manual smoke test (not part of CI)

To actually talk to the bot in a browser — no telephony, no Twilio — with real provider keys
configured:

```bash
uv run python -m pipecat.runner.run --transport webrtc src/voice_agent/bot.py
```

Set two environment variables first (see `bot.py`):

* `DEV_SESSION_ORGANIZATION_ID` — a real organization id.
* `DEV_SESSION_ORGANIZATION_SERVICE_TOKEN` — that organization's own service credential (the
  tenant-scoped secret returned exactly once, at organization-creation time, in `apps/api`'s
  `POST /organizations` response — see "Configuration (M5)" above). Treat it as a secret: do
  not commit it or paste it into logs.

This uses Pipecat's own official development runner and `SmallWebRTCTransport` — nothing here
is wired to CI, and with the default `"fake"` providers it will "hear" nothing and always reply
with the same canned sentence.

## M5 status

Pipecat is a normal dependency (`pipecat-ai`, pinned narrow — see ARCHITECTURE.md §12.4), with a
transport-agnostic pipeline, a provider factory (fake by default), and one read-only tool
(`search_knowledge`). No telephony transport of any kind exists — no Twilio, no phone numbers, no
SIP, no production WebRTC infrastructure; that's M6. See [TASKS.md](../../TASKS.md) and
[ARCHITECTURE.md §12](../../ARCHITECTURE.md#12-voiceai-runtime-foundation-m5).
