# Architecture

Status: **M1 — Foundation**. This document describes the structure established in M1 and the
design intent for pieces that don't exist as code yet (marked explicitly). See
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the milestone sequence.

## 1. Monorepo layout

```
apps/
  web/            Next.js 16 + TypeScript + Tailwind CSS 4 — customer-facing frontend
  api/             Express 5 + TypeScript — backend API
services/
  voice-agent/     FastAPI (Python 3.12, via uv) — voice service, independently deployable
packages/
  shared/          @ai-receptionist/shared — TS types/constants shared by web + api
infrastructure/
  docker/          docker-compose.yml for local Postgres + Redis
docs/              reserved for milestone-specific design docs (empty in M1)
```

This matches the structure requested for the project, used as-is with no deviation, so no
alternative-structure rationale is needed.

**Package manager: npm workspaces**, not pnpm/yarn/turborepo. npm 11.x was already present in
the environment and workspaces cover everything M1 needs (shared dependency hoisting,
cross-package `file:`-style linking, `-w` scoped scripts). Adding a second package manager or a
build-orchestration tool (Turborepo, Nx) would be an unjustified dependency at this stage —
revisit only if cross-package build graphs get complex enough to need task caching/parallelism.

**Language split**: TypeScript for anything web-facing (frontend, API, shared types) so types
can be shared; Python for the voice service because Pipecat (the planned voice framework, see
§5) is a Python framework.

## 2. apps/web — Frontend

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4. Scaffolded with the official
`create-next-app` CLI and left structurally as generated (App Router, `src/` layout,
`@/*` import alias) — no custom framework wiring was introduced.

M1 contains only the default route (`/`) with a plain status page. No auth, dashboard, or
product UI exists.

## 3. apps/api — Backend API

Express 5 + TypeScript, ESM (`"type": "module"`). Modular layout:

```
src/
  config/       env parsing (config/env.ts), logger (config/logger.ts)
  routes/       URL -> controller wiring only, no logic
  controllers/  HTTP request/response handling only, no business logic
  services/     business logic, framework-agnostic (importable/testable without Express)
  app.ts        Express app factory (used directly by tests, no network binding)
  server.ts     process entrypoint — the only file that calls `app.listen`
```

This split exists so business logic (`services/`) never imports Express types, and so tests can
exercise the full middleware stack via `createApp()` without opening a real port (see
`apps/api/tests/health.test.ts`, using Supertest against the app instance).

Cross-cutting middleware applied in `app.ts`: `helmet` (security headers), `cors` (restricted to
`WEB_ORIGIN`), `pino-http` (structured request logging, with `authorization`/`cookie` headers
redacted — see [SECURITY.md](SECURITY.md)).

M1 exposes exactly one route: `GET /health`. No auth middleware, no data routes, no tenant
context — those arrive with M2/M3.

## 4. packages/shared

TypeScript-only package (`@ai-receptionist/shared`) consumed by `apps/api` today (its
`ServiceHealth` type) and available to `apps/web` once it needs server-shared types. Built via
`tsc` to `dist/` (declaration + JS) rather than consumed directly from source, so that `tsc`'s
`NodeNext` module resolution and Node's runtime `require`/`import` both resolve it the same way
whether running under `tsx`/`vitest` (dev/test) or the compiled `dist/server.js` (prod-style
run). Run `npm run build -w packages/shared` after editing it — `npm install` does this
automatically via a root `postinstall` script, but a running `tsx watch` process will not
pick up shared-package edits without a rebuild.

M1 content is intentionally minimal: `TenantId` (a branded string type) and `TenantScoped`
(marker interface), which exist to document the multi-tenant shape described in §6 — not to
model any real entity yet, since none exist in M1.

## 5. services/voice-agent — Voice service

FastAPI, Python 3.12, managed by [uv](https://docs.astral.sh/uv/). Structure mirrors
`apps/api`'s route/controller-equivalent/service split:

```
src/voice_agent/
  config.py       environment settings
  routes/         FastAPI routers (URL -> handler wiring)
  services/        business logic, framework-agnostic
  main.py          FastAPI app factory (create_app) + process entrypoint
```

**Python version**: pinned to 3.12 (`requires-python = ">=3.12,<3.13"`, `.python-version`),
managed entirely by `uv` — independent of and without modifying the system Python (3.14 at time
of writing). `uv sync` downloads its own 3.12 interpreter into this project only. 3.12 was
chosen over the system's newer 3.14 because it's the current safe baseline for the voice/ML
Python ecosystem this service will pull in from M4 onward — packages in that space (Pipecat and
its provider integrations, audio libraries) typically support the last 2-3 CPython minors first,
and 3.14 is too new to assume broad compatibility yet.

**Pipecat is explicitly not installed or referenced in M1.** This service currently only proves
out the project skeleton and a real, working health endpoint (`GET /health`, checked live during
verification — see [TASKS.md](TASKS.md)). When the voice-agent milestone (M4) begins, Pipecat
will be added as a normal dependency via `uv add pipecat-ai` (or the current official package
name at that time) against whatever the official docs specify then — **not** vendored, forked,
or copied into this repository.

## 6. Multi-tenancy

**No tenant-scoped data exists yet in M1** (no database, no organizations, no users, no calls).
This section documents the boundary and enforcement strategy that M3 onward must implement,
written now so every later milestone builds against the same model instead of improvising one
under deadline pressure.

### Tenant boundary

The tenant is the **organization** (a business account, e.g. one dental office or one plumbing
company). Every one of the following record types is organization-scoped and must carry an
`organization_id`:

* users (a user belongs to exactly one organization in M1's model — no cross-org membership)
* business configuration
* calls, call transcripts, call summaries
* leads
* appointments
* knowledge base entries
* phone numbers
* integrations (Google Calendar, Twilio config, etc.)
* usage records
* billing/subscription records

There is no scenario in this product where one organization should ever see another
organization's rows. Unlike some SaaS designs, there is no "shared across tenants" data class
planned beyond global, non-tenant config (e.g. system feature flags), so the default assumption
for any new table is "it needs `organization_id`" unless a reviewer explicitly justifies
otherwise.

### Enforcement strategy (to implement starting M3)

Frontend filtering is **not** a security boundary — the plan below never relies on it.

1. **Every org-scoped table gets an `organization_id` column** (foreign key to
   `organizations.id`), indexed, and non-nullable.
2. **Tenant context is derived server-side from the authenticated session only** — the backend
   resolves `organization_id` from the verified session/JWT after auth (M2), never from a
   client-supplied body/query/header field. A request that names a different `organization_id`
   than the caller's own session is rejected, not honored.
3. **A data-access layer enforces scoping, not ad-hoc query authors.** All org-scoped reads/writes
   go through a repository/query layer that requires a tenant context argument to compile/run —
   there is no "raw query with tenant filtering optional" escape hatch in application code.
4. **PostgreSQL Row-Level Security (RLS) as defense-in-depth.** Once real tables exist, each
   org-scoped table gets an RLS policy keyed off a per-request/connection session variable (e.g.
   `SET LOCAL app.organization_id = '<uuid>'`), so that even a bug in the application-layer
   scoping (point 3) cannot leak cross-tenant rows — the database itself refuses to return them.
5. **Fail closed.** Missing or invalid tenant context must result in zero rows / a rejected
   request, never an unscoped query that returns everything.
6. **Tenant isolation is part of the test suite** once real data models exist — every
   org-scoped endpoint needs a test asserting org A cannot read/write org B's data.

See [SECURITY.md](SECURITY.md) for how this fits the broader security posture.

## 7. Data layer

PostgreSQL and Redis are **not connected to by any service in M1** — no schema, no migrations,
no client wiring in `apps/api` or `services/voice-agent`. `infrastructure/docker/docker-compose.yml`
provisions both for local development ahead of M3, using current stable images
(`postgres:17.11-alpine`, `redis:8.10-alpine`). This was validated for YAML correctness only;
Docker itself is not installed in this environment, so the containers have not been started — see
[DEPLOYMENT.md](DEPLOYMENT.md) for the exact verification that was and wasn't possible.

## 8. Environment variables

A single root [.env.example](.env.example) documents every variable across all three
services (not one per app) so the full configuration surface is visible in one place. Each
service reads only the variables relevant to it (see `apps/api/src/config/env.ts` and
`services/voice-agent/src/voice_agent/config.py`). Variables for integrations not yet built
(Stripe, Twilio, Deepgram, etc.) are present as empty placeholders so the eventual config surface
is documented ahead of time — see [SECURITY.md](SECURITY.md) for handling rules.
