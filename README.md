# AI Receptionist

A multi-tenant SaaS product for US local businesses: 24/7 AI phone answering with natural voice
conversations, business-specific knowledge, lead capture, appointment booking, SMS confirmations,
human call transfers, call transcripts/summaries, business analytics, usage tracking, and Stripe
subscriptions.

**Status: M1 — Foundation only.** None of the product features above are implemented yet. This
repository currently contains the monorepo scaffolding, framework bootstraps, and health
endpoints that later milestones build on. See [TASKS.md](TASKS.md) for exactly what exists today
and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the full milestone sequence (M1–M13).

## Architecture (high level)

```
apps/web            Next.js + TypeScript + Tailwind — customer-facing frontend
apps/api             Express + TypeScript — backend API
services/voice-agent  FastAPI (Python) — voice service; Pipecat integration arrives in M4
packages/shared       TypeScript types shared by web + api
infrastructure/docker  docker-compose for local Postgres + Redis
```

Full detail — including the multi-tenancy model and enforcement strategy, and the reasoning
behind key dependency/tooling choices — is in [ARCHITECTURE.md](ARCHITECTURE.md).
Security posture and the tenant-isolation commitment are in [SECURITY.md](SECURITY.md).

**Multi-tenancy** is designed in from day one even though no tenant-scoped data exists yet: the
tenant boundary is the organization, isolation is never enforced only in the frontend, and the
intended enforcement (server-derived tenant context + Postgres Row-Level Security) is documented
in [ARCHITECTURE.md §6](ARCHITECTURE.md#6-multi-tenancy) ahead of M3 implementing it.

**Voice infrastructure** will use [Pipecat](https://github.com/pipecat-ai/pipecat) starting at
M4, added as a normal dependency against the then-current official package/docs — not vendored
or forked into this repo.

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
cp .env.example .env        # optional for M1 — nothing currently requires real values

npm run dev:web             # http://localhost:3000
npm run dev:api             # http://localhost:4000/health
```

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

## M1 limitations

* No authentication, no real user accounts, no database connectivity, no tenant-scoped data —
  all deferred to M2/M3 by design.
* No Twilio, no phone calls, no AI conversation, no STT/TTS/LLM integration, no Stripe, no
  Google Calendar, no SMS, no RAG/vector database. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
  for when each lands.
* `apps/web` and `services/voice-agent`'s `/health` (and `apps/api`'s `GET /health`) do not check
  database/Redis connectivity — neither is wired up yet.
* Docker Compose for Postgres/Redis exists but was only validated as syntactically-correct YAML;
  it has not been run, since Docker isn't installed in the build environment. See
  [DEPLOYMENT.md](DEPLOYMENT.md).
* Full known-limitations list: [TASKS.md](TASKS.md).

## Future milestones

M2 Authentication · M3 Organizations & business configuration · M4 AI voice agent (Pipecat) ·
M5 Twilio inbound calls · M6 Knowledge base/RAG · M7 Lead capture · M8 Appointment booking ·
M9 SMS · M10 Dashboard · M11 Stripe billing · M12 Security and testing · M13 Production
deployment. Details: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
