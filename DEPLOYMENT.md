# Deployment

Status: **M1 — Foundation. Nothing in this repository is deployed anywhere.** Production
deployment is milestone **M13** in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). This
document currently covers local development only, plus the Docker limitation for this
environment.

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
cp .env.example .env                 # fill in values as needed; safe to leave placeholders empty for M1
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

### Data layer (optional, requires Docker)

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

No service currently connects to Postgres/Redis (see ARCHITECTURE.md §7), so this is not
required to run or test anything in M1.

## Docker limitation in this environment

**Docker is not installed on the machine this M1 implementation was built and verified on.**
`docker`/`docker compose` were confirmed unavailable in both the bash and PowerShell shells
during initial repository inspection. As a result:

* `infrastructure/docker/docker-compose.yml` was validated by parsing it as YAML (confirms it's
  syntactically well-formed and declares the expected `postgres`/`redis` services) — **not** by
  running `docker compose config` or actually starting containers.
* No claim is made anywhere in this repository that Postgres or Redis were run, connected to, or
  tested in M1.
* Before relying on the compose file, run `docker compose -f infrastructure/docker/docker-compose.yml config`
  on a machine with Docker installed as a first sanity check.

## Production deployment

Not designed yet. Target platform(s), CI/CD pipeline, container registry, secrets management,
and environment topology (staging/prod) are all open decisions deferred to M13, once there is a
real product to deploy. Nothing here should be read as a decision already made.
