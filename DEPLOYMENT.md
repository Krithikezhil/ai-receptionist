# Deployment

Status: **M7 — Twilio inbound calls. Nothing in this repository is deployed anywhere.**
Production deployment is milestone **M15** in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). This document currently covers local
development only, plus the Docker/Postgres limitation for this environment. M7 additionally
requires two real public URLs once actually deployed (services/voice-agent's Twilio webhook and
Media Stream WebSocket, both served from the same `VOICE_AGENT_PUBLIC_BASE_URL`) — no production
topology for exposing them exists yet; see [services/voice-agent/README.md](services/voice-agent/README.md)
for the local/ngrok-based manual test setup used instead.

## Local development

### Prerequisites

* Node.js >= 20 (developed against v24.15.0)
* npm (developed against 11.12.1)
* [uv](https://docs.astral.sh/uv/) (developed against 0.12.9) — manages the voice-agent's Python
  3.12 itself; you do not need Python 3.12 pre-installed
* Docker + Docker Compose — **optional**, only needed once you want Postgres/Redis running
  locally (not required for M1)

### Setup

```bash
npm install                          # installs web + api + shared, builds shared automatically
cp .env.example .env
# Set AUTH_SECRET — apps/api refuses to start without it:
#   openssl rand -base64 32
```

The voice-agent is a separate Python project and is not part of the npm workspace:

```bash
cd services/voice-agent
uv sync
```

### Running services

```bash
npm run dev:web            # apps/web  -> http://localhost:3000
npm run dev:api            # apps/api  -> http://localhost:4000  (GET /health)
```

```bash
cd services/voice-agent
uv run voice-agent         # -> http://localhost:8000  (GET /health)
```

### Data layer (requires Docker)

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
cd apps/api && npx drizzle-kit migrate   # applies src/db/migrations/ to Postgres
```

As of M2, `apps/api`'s `/auth/register` and `/auth/login` **require** a real Postgres connection
(`DATABASE_URL`) to actually persist users/sessions — `GET /health` does not. Redis is still
unused by any service.

## Docker limitation in this environment

**Docker is not installed on the machine this was built and verified on.** `docker`/`docker
compose` were confirmed unavailable in both the bash and PowerShell shells during initial
repository inspection, and remained unavailable through M2. As a result:

* `infrastructure/docker/docker-compose.yml` was validated by parsing it as YAML (confirms it's
  syntactically well-formed and declares the expected `postgres`/`redis` services) — **not** by
  running `docker compose config` or actually starting containers.
* The Drizzle migration in `apps/api/src/db/migrations/` was generated (`drizzle-kit generate`,
  which only reads the TypeScript schema — no DB connection needed) but **has not been applied to
  or tested against a real Postgres instance**.
* Auth registration/login/session logic was instead verified against in-memory repository test
  doubles implementing the same interfaces the real Postgres repositories implement — see
  [ARCHITECTURE.md §9](ARCHITECTURE.md#9-authentication) and [TASKS.md](TASKS.md). This proves the
  business logic works; it does not prove the SQL migration or Postgres-specific behavior does.
* No claim is made anywhere in this repository that Postgres or Redis were run, connected to, or
  tested against real data.
* Before relying on this, on a machine with Docker installed: run `docker compose -f
  infrastructure/docker/docker-compose.yml up -d`, then `cd apps/api && npx drizzle-kit migrate`,
  then exercise `/auth/register` and `/auth/login` for real.

## Production deployment

Not designed yet. Target platform(s), CI/CD pipeline, container registry, secrets management,
and environment topology (staging/prod) are all open decisions deferred to M15, once there is a
real product to deploy. Nothing here should be read as a decision already made.
