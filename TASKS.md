# Tasks

## Completed — M1 Foundation

**Monorepo**
- [x] `apps/web`, `apps/api`, `services/voice-agent`, `packages/shared`, `infrastructure/docker`,
      `docs/` layout, matching the requested structure with no deviation
- [x] npm workspaces at root (`package.json`), no extra build orchestrator added
- [x] Root `.gitignore` covering Node, Python, build output, and env files (with `.env.example`
      explicitly re-included)
- [x] Root `.env.example` documenting every current and near-term-future variable across all
      three services

**apps/web**
- [x] Bootstrapped via official `create-next-app` (Next.js 16.3.4, React 19.2.8, TypeScript,
      Tailwind CSS 4, App Router, `src/` layout)
- [x] Boilerplate template content/links removed; replaced with a minimal, honest status page
      (no fake feature UI)
- [x] `next build` succeeds (includes Next's internal TypeScript check)
- [x] `next typegen && tsc --noEmit` typecheck script added and verified from a clean state
- [x] ESLint (flat config, `eslint-config-next`) passes with zero warnings/errors

**apps/api**
- [x] Express 5 + TypeScript, ESM, modular `config/routes/controllers/services` structure
- [x] `GET /health` — real endpoint, verified both via Supertest (unit test) and a live
      `node dist/server.js` + `curl` call (200 OK, correct JSON shape)
- [x] `helmet`, scoped `cors`, `pino` structured logging with `authorization`/`cookie` redaction
- [x] Vitest + Supertest test suite (1 test, passing)
- [x] ESLint (flat config, typescript-eslint) passes; `tsc --noEmit` passes; `tsc -p
      tsconfig.build.json` production build succeeds and runs

**services/voice-agent**
- [x] `uv`-managed project pinned to Python 3.12 (`.python-version`,
      `requires-python = ">=3.12,<3.13"`) — system Python 3.14 untouched, verified via
      `uv python list`
- [x] FastAPI app with the same `config/routes/services` split as `apps/api`
- [x] `GET /health` — verified via `pytest` (TestClient) and a live `uv run voice-agent` +
      `curl` call (200 OK)
- [x] `ruff check` and `ruff format --check` pass; `mypy --strict` passes with 0 issues;
      `pytest` passes (1 test)
- [x] **Pipecat intentionally not installed or referenced anywhere in this milestone**

**packages/shared**
- [x] `@ai-receptionist/shared`: `TenantId`, `TenantScoped`, `ServiceHealth` — foundation types
      only, no real domain models (none exist yet)
- [x] Actually consumed by `apps/api` (`HealthStatus extends ServiceHealth`), not dead code
- [x] Builds to `dist/` (declarations + JS); root `postinstall` builds it automatically
- [x] ESLint, `tsc --noEmit`, and Vitest all pass

**Docker / infrastructure**
- [x] `infrastructure/docker/docker-compose.yml`: Postgres 17.11-alpine + Redis 8.10-alpine,
      healthchecks, named volumes
- [x] Validated as syntactically correct YAML (parsed successfully, declares the two expected
      services) — **not** run, since Docker is unavailable in this environment (see below)

**Documentation**
- [x] README.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, TASKS.md (this file), SECURITY.md,
      DEPLOYMENT.md — all written, cross-linked, and specific about what is/isn't implemented

**Verification actually run** (see the final report for full command list/output)
- [x] `npm install` from a clean `node_modules`/lockfile state
- [x] `npm run lint`, `npm run typecheck`, `npm run test` (root aggregate, all workspaces)
- [x] `npm run format:check` (Prettier)
- [x] `npm run build` (shared → api → web, in order)
- [x] Live health-endpoint checks for both `apps/api` and `services/voice-agent` via `curl`,
      including running the *compiled* API (`dist/server.js`), not just the dev server
- [x] `uv run pytest`, `uv run ruff check`, `uv run ruff format --check`, `uv run mypy src`

## Remaining M1 work

None identified as blocking M1's stated scope. Everything listed in the "Implement" section of
the M1 brief exists and was verified. Two small things intentionally left for later rather than
done now, since they're outside the explicit M1 checklist:

- [ ] No CI pipeline (e.g. GitHub Actions) configured yet — not requested in M1's scope; the
      commands it would run (`npm run lint/typecheck/test`, the `uv run` equivalents) all exist
      and pass locally today, so wiring CI later is mechanical.
- [ ] No dependency-update automation (Dependabot/Renovate) configured yet.

## Known limitations

- **Docker was not tested.** Not installed in this environment (`docker`/`docker compose`
  confirmed unavailable in both bash and PowerShell during initial inspection). The compose file
  is believed correct (valid YAML, standard service definitions) but has not been run.
- **ESLint version differs by workspace on purpose**: `apps/web` uses ESLint 9.x because
  `eslint-plugin-import` (pulled in transitively by `eslint-config-next@16.3.4`) does not yet
  support ESLint 10 in its peer range, despite `eslint-config-next` itself claiming `>=9.0.0`.
  `apps/api` and `packages/shared` use ESLint 10.x, which has no such constraint. This was
  discovered by actually running `npm install` and reading the resulting `ERESOLVE`/`npm ls`
  output, not assumed — see ARCHITECTURE.md.
- **TypeScript stayed on 5.9.3, not the new 7.x major** that `npm view typescript version`
  reports as "latest". TypeScript 7 is the team's new Go-ported native compiler; `create-next-app`
  itself still scaffolds `^5`, indicating the surrounding tooling (ESLint TS tooling, `tsx`, etc.)
  isn't uniformly on 7.x yet. Revisit once the ecosystem catches up.
- **Cosmetic deprecation warning** in `services/voice-agent` tests: Starlette's `TestClient` warns
  that using it with `httpx` is deprecated in favor of a package it calls `httpx2`. Tests pass;
  this is a future cleanup item, not a current problem.
- No authentication, no tenant-scoped database tables, no real data models — all by design,
  deferred to M2/M3 (see ARCHITECTURE.md §6 for the enforcement strategy that will be
  implemented then, not now).
- No product features (voice AI, calling, SMS, booking, billing, dashboard) — see
  IMPLEMENTATION_PLAN.md for M4 onward.

## Future milestones

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for M2 through M13.
