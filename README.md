# AI Receptionist

A multi-tenant SaaS product for US local businesses: 24/7 AI phone answering with natural voice
conversations, business-specific knowledge, lead capture, appointment booking, SMS confirmations,
human call transfers, call transcripts/summaries, business analytics, usage tracking, and Stripe
subscriptions.

**Status: M8 — Knowledge retrieval / RAG (in progress).** None of the product features above
(leads, appointments, billing, etc.) are implemented yet. This repository currently contains the
M1 monorepo foundation, M2 authentication (real accounts, sessions), M3 organizations (business
profile, weekly hours, service catalog), M4 (an authenticated organization member can manage a
knowledge base and configure a provider-agnostic AI receptionist), M5 — a Pipecat conversational
pipeline in `services/voice-agent`, a service-authenticated internal API on `apps/api` for it to
read a tenant's config/knowledge, and one read-only knowledge-search tool — M6, which wires real
Deepgram/OpenAI/Cartesia providers into that pipeline, adds turn-taking detection, and hardens
session lifecycle handling (idle timeout, provider-error handling, disconnect handling), M7, which
bridges a real inbound Twilio phone call into that exact runtime via a signature-validated webhook
and a credential-authenticated Media Stream WebSocket, and M8 (in progress), which adds
per-organization knowledge chunking, a provider-agnostic embedding abstraction, and
cosine-similarity-ranked semantic search for the voice agent's internal knowledge lookup --
embeddings are stored as a plain Postgres `real[]` column, not a vector database, and the
dashboard's own knowledge search is unchanged. Real-provider behavior (M6), a real live
Twilio/PSTN call (M7), and real OpenAI embedding quality (M8) have **not** yet been manually
verified in this environment (no provider or Twilio credentials available) -- see TASKS.md.
No SMS, no outbound calling, no leads, no appointments, no billing — see [TASKS.md](TASKS.md) for
exactly what exists today and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the full
milestone sequence (M1–M15).

## Architecture (high level)

```
apps/web            Next.js + TypeScript + Tailwind — customer-facing frontend
apps/api             Express + TypeScript — backend API, incl. /internal/v1 (M5) and Twilio
                     phone-number lookup/provisioning (M7)
services/voice-agent  FastAPI + Pipecat (Python) — voice service, incl. Twilio inbound call
                     webhook + Media Stream bridge (M7); no outbound calling, no SMS
packages/shared       TypeScript types shared by web + api
infrastructure/docker  docker-compose for local Postgres + Redis
```

Full detail — including the multi-tenancy model and enforcement strategy, the authentication/
session design, and the reasoning behind key dependency/tooling choices — is in
[ARCHITECTURE.md](ARCHITECTURE.md). Security posture, the tenant-isolation commitment, and the
authentication security design are in [SECURITY.md](SECURITY.md).

**Authentication** (M2): cookie-based server-side sessions (not JWT, nothing in `localStorage`),
Argon2id password hashing, real Postgres schema via Drizzle ORM. The backend independently
verifies every authenticated request — the frontend's route protection is UX only, never the
security boundary. Full design: [ARCHITECTURE.md §9](ARCHITECTURE.md#9-authentication).

**Multi-tenancy** (M3): the organization is the tenant boundary. Every organization-scoped
request is independently re-verified against real membership data server-side — never trusted
because an id appears in a URL, a form field, or anywhere client-controlled. Proven by automated
tests that attempt exactly that (changing an organization id in a request, spoofing an id in a
request body) and confirm they're rejected. Full design and test list:
[ARCHITECTURE.md §6](ARCHITECTURE.md#6-multi-tenancy)/§10, [SECURITY.md §1](SECURITY.md)/§3.

**Knowledge & receptionist configuration** (M4): a tenant-scoped knowledge base and a
provider-agnostic AI receptionist configuration (greeting, tone, instructions, enable/disable),
both real, persistent, and API/UI-editable — with no live AI, phone number, or provider
integration behind them yet. A default configuration is created (always disabled) alongside every
new organization. Full design: [ARCHITECTURE.md §11](ARCHITECTURE.md#11-knowledge-and-receptionist-configuration).

**Voice runtime foundation** (M5): [Pipecat](https://github.com/pipecat-ai/pipecat) is a normal
dependency of `services/voice-agent` (not vendored/forked), built as a transport-agnostic
pipeline with a fake STT/LLM/TTS provider by default (no credentials needed to boot or run tests)
and one read-only tool (`search_knowledge`). It talks to `apps/api`'s new
`/internal/v1/...` endpoints using a shared static service credential
(`INTERNAL_SERVICE_KEY`) — a non-interactive backend service can now read a tenant's
config/knowledge without a browser session. **No telephony**: the only transport available is a
manual, local-only WebRTC smoke test — no Twilio, no phone numbers, no real calls. Full design:
[ARCHITECTURE.md §12](ARCHITECTURE.md#12-voiceai-runtime-foundation-m5),
[SECURITY.md §8](SECURITY.md#8-service-to-service-authentication-m5).

**Real AI voice runtime** (M6): real Deepgram (STT), OpenAI (LLM), and Cartesia (TTS) providers
are now wired in with model/voice configuration, plus a turn-taking/interruption detection stage
(a local VAD model — no network, no credentials). Session execution is now production-shaped: an
idle-timeout that ends a call gracefully after configurable caller silence, provider-failure
handling via Pipecat's own termination policy, client-disconnect handling, and guaranteed cleanup
— all still reached only through the same non-telephony local WebRTC smoke test, never a phone
call. Real-provider behavior (an actual live conversation) has not yet been manually verified in
this environment. Full design: [ARCHITECTURE.md §13](ARCHITECTURE.md#13-real-ai-voice-runtime-m6),
[SECURITY.md §9](SECURITY.md#9-voice-runtime-session-lifecycle-and-failure-handling-m6).

**Twilio inbound calls** (M7): a real inbound phone call now reaches the exact same M6 runtime,
unmodified. `apps/api` maps a dialed Twilio number to an organization and mints a short-lived,
call-bound credential; `services/voice-agent` validates the Twilio webhook signature, bridges the
Media Stream WebSocket into the pipeline, and verifies that credential locally before starting a
session — the credential, never a raw WebSocket parameter, is the sole source of tenant identity.
No SMS, no outbound calling. An actual live call over real Twilio + real providers has **not** yet
been manually verified in this environment. Full design:
[ARCHITECTURE.md §14](ARCHITECTURE.md#14-twilio-inbound-calls-m7),
[SECURITY.md §10](SECURITY.md#10-twilio-inbound-call-security-m7).

## Prerequisites

* Node.js >= 20 (built/verified against v24.15.0)
* npm (built/verified against 11.12.1)
* [uv](https://docs.astral.sh/uv/) (built/verified against 0.12.9) — manages the voice-agent's
  Python 3.12 automatically; no need to install Python 3.12 yourself
* Docker + Docker Compose — **optional**, only for running Postgres/Redis locally; not required
  for anything in M1. Docker was not available in the environment this was built in — see
  [DEPLOYMENT.md](DEPLOYMENT.md) for that limitation.

## Local development

```bash
npm install                # installs apps/web + apps/api + packages/shared, builds shared
cp .env.example .env
# Set AUTH_SECRET and INTERNAL_SERVICE_KEY in .env — the API refuses to start without either:
#   openssl rand -base64 32   (AUTH_SECRET)
#   openssl rand -hex 32      (INTERNAL_SERVICE_KEY — must match services/voice-agent's .env too)

npm run dev:web             # http://localhost:3000
npm run dev:api             # http://localhost:4000/health
```

Registration/login require a running Postgres (`DATABASE_URL` in `.env.example`) — see
[DEPLOYMENT.md](DEPLOYMENT.md) for the Docker limitation in this environment. `GET /health` does
not need a database and works without one.

```bash
cd services/voice-agent
uv sync
uv run voice-agent          # http://localhost:8000/health
```

Full instructions, including the optional Docker data layer, are in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Available commands (run from repo root)

| Command | What it does |
|---|---|
| `npm run dev:web` / `npm run dev:api` | Start web / api dev servers |
| `npm run build` | Build shared, then api, then web (in that order) |
| `npm run lint` | Lint every workspace |
| `npm run typecheck` | Type-check every workspace |
| `npm run test` | Run tests in every workspace |
| `npm run format` / `npm run format:check` | Prettier write / check |

Per-workspace equivalents: `npm run <script> -w apps/web`, `-w apps/api`, `-w packages/shared`.
`services/voice-agent` commands are run with `uv run <cmd>` from that directory — see its own
[README](services/voice-agent/README.md).

## Current limitations

* No calls, leads, appointments, phone numbers, or billing — deferred to later milestones by
  design. Organizations, business profiles, weekly hours, a service catalog, a knowledge base,
  receptionist configuration, and now a voice-agent pipeline exist as of M5; nothing beyond that.
* No fine-grained RBAC — any organization member (owner or plain member) currently has full
  read/write access to that organization's configuration. See [SECURITY.md](SECURITY.md).
* No SIP, no production WebRTC infrastructure, no Stripe, no Google Calendar, no SMS, no
  outbound calling, no vector database. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for
  when each remaining item lands. The receptionist configuration is provider-agnostic and always
  created disabled — enabling it in the UI does not connect to any AI provider or phone number by
  itself (a phone number must also be separately provisioned to an organization, M7).
* Knowledge chunking, embedding, and semantic search exist structurally (M8, in progress:
  chunking/embedding/ingestion/ranking implemented and CI-verified with the deterministic `fake`
  embedding provider; documentation and a manual review of real OpenAI embedding quality are not
  yet complete) -- embeddings are stored as a plain Postgres `real[]` column, not a vector
  database, and are used only by the voice agent's internal knowledge lookup; the dashboard's own
  knowledge search is unchanged. See [TASKS.md](TASKS.md).
* Twilio inbound calling exists structurally (M7: webhook signature validation, phone-number
  lookup, call-credential-authenticated Media Stream bridge, reusing the unmodified M6 runtime)
  but **a real live call has not yet been manually verified** in this environment — no real
  Twilio account was available during implementation. See [TASKS.md](TASKS.md).
* Real STT/LLM/TTS provider wiring exists (M5) but is optional and lazy — a deterministic fake is
  the default, and no automated test or CI step ever makes a real, paid provider call. A developer
  can talk to the bot for real, locally, over a browser (no telephony) with real keys configured —
  see `services/voice-agent/README.md`.
* The M5 internal API uses two service credentials: a global `INTERNAL_SERVICE_KEY` (proves a
  trusted internal service) plus a separate per-organization `X-Organization-Service-Token`
  (proves authorization for that specific organization — a token for one organization is
  rejected for any other). Neither has automated rotation tooling — a deliberate, documented
  trade-off, see [SECURITY.md §8](SECURITY.md#8-service-to-service-authentication-m5).
* No rate limiting / brute-force protection on login or registration, no CSRF token beyond
  `SameSite`, no email verification, no password reset flow, no MFA, no Postgres Row-Level
  Security — see [SECURITY.md](SECURITY.md) for the full list of known gaps.
* Postgres has a real schema (users, sessions, organizations, memberships, business profiles,
  hours, services, knowledge entries, receptionist configuration) but **has not been tested
  against a real database** in this environment — Docker is unavailable here. All logic was
  verified via in-memory test doubles exercising the same code paths — see
  [ARCHITECTURE.md §9](ARCHITECTURE.md#9-authentication)/§10/§11.
* `services/voice-agent`'s `/health` (and `apps/api`'s `GET /health`) do not check database/Redis
  connectivity.
* Docker Compose for Postgres/Redis exists but was only validated as syntactically-correct YAML;
  it has not been run, since Docker isn't installed in the build environment. See
  [DEPLOYMENT.md](DEPLOYMENT.md).
* Full known-limitations list: [TASKS.md](TASKS.md).

## Future milestones

M8 Knowledge retrieval/RAG · M9 Lead capture · M10 Appointment booking · M11 SMS · M12 Dashboard ·
M13 Stripe billing · M14 Security and testing · M15 Production deployment. Details:
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
