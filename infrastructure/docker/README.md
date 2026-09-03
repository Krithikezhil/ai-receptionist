# infrastructure/docker

`docker-compose.yml` provisions the local-development data layer: PostgreSQL and Redis.

## M1 status

* **Not verified in this environment.** Docker is not installed on this machine — see
  the root [DEPLOYMENT.md](../../DEPLOYMENT.md) for how this was validated (config
  review + `docker compose config` syntax check only, no containers actually started).
* No application service depends on these containers yet. `apps/api`'s and
  `services/voice-agent`'s health endpoints do not check database/Redis connectivity —
  that wiring lands in M3.
* No database schema/migrations exist yet.

## Usage (once Docker is available)

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
docker compose -f infrastructure/docker/docker-compose.yml down
```

Connection strings match `.env.example`'s `DATABASE_URL` / `REDIS_URL` defaults.
