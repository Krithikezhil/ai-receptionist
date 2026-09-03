# Architecture

Status: **M2 — Authentication**, building on the M1 foundation. This document describes the
structure established so far and the design intent for pieces that don't exist as code yet
(marked explicitly). See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the milestone
sequence.

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

Routes as of M2: `/` (status page), `/login`, `/register` (client-side forms calling the API
directly), `/dashboard` (server-rendered, authenticated placeholder — see §9). No real product
UI (calling, booking, billing, etc.) exists.

## 3. apps/api — Backend API

Express 5 + TypeScript, ESM (`"type": "module"`). Modular layout:

```
src/
  config/         env parsing (config/env.ts), logger (config/logger.ts)
  db/             Drizzle schema, migrations, pg client (see §9)
  auth/           password hashing, session token generation/validation, cookie helpers
  repositories/   UserRepository/SessionRepository interfaces + Postgres (Drizzle) implementations
  services/       business logic, framework-agnostic (auth.service.ts, health.service.ts)
  middleware/     requireAuth — the actual server-side auth boundary (see SECURITY.md)
  validation/     zod request-body schemas
  routes/         URL -> controller wiring only, no logic
  controllers/    HTTP request/response handling only, no business logic
  app.ts          Express app factory (accepts injected deps for tests — see §9)
  server.ts       process entrypoint — the only file that calls `app.listen`
```

This split exists so business logic (`services/`) never imports Express types, and so tests can
exercise the full middleware stack via `createApp()` without opening a real port (see
`apps/api/tests/`, using Supertest against the app instance).

Cross-cutting middleware applied in `app.ts`: `helmet` (security headers), `cors` (restricted to
`WEB_ORIGIN`, `credentials: true` so the session cookie is sent on cross-port requests from
`apps/web`), `pino-http` (structured request logging, with `authorization`/`cookie` headers
redacted — see [SECURITY.md](SECURITY.md)), and a centralized JSON error handler (never leaks
stack traces to clients).

Routes as of M2: `GET /health` (M1, unauthenticated) and `POST /auth/register`,
`POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (M2 — see §9). No tenant-scoped data
routes yet — those arrive with M3.

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

**No tenant-scoped data exists yet** (no organizations, no calls/leads/appointments). M2 added a
`users` table (§9), but it is not yet organization-scoped — that's M3's job. This section
documents the boundary and enforcement strategy that M3 onward must implement, written now so
every later milestone builds against the same model instead of improvising one under deadline
pressure.

### Tenant boundary

The tenant is the **organization** (a business account, e.g. one dental office or one plumbing
company). Every one of the following record types is organization-scoped and must carry an
`organization_id`:

* users (a user belongs to exactly one organization in this model — no cross-org membership)
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
   resolves `organization_id` from the verified session (§9's `requireAuth` middleware already
   establishes the authenticated-user pattern this extends), never from a client-supplied
   body/query/header field. A request that names a different `organization_id` than the caller's
   own session is rejected, not honored.
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

**PostgreSQL**: as of M2, `apps/api` has a real schema (`users`, `sessions` — see §9) via Drizzle
ORM, with generated SQL migrations in `apps/api/src/db/migrations/`. `services/voice-agent` still
does not connect to it. **The schema and migrations have not been applied to or tested against a
real Postgres instance** — Docker is unavailable in this environment (same limitation as M1; see
[DEPLOYMENT.md](DEPLOYMENT.md)). Application-level auth logic was instead verified against
in-memory repository test doubles implementing the same interfaces (§9) — this exercises the real
business logic but not Postgres itself.

**Redis**: still not connected to by any service.

`infrastructure/docker/docker-compose.yml` provisions both for local development, using current
stable images (`postgres:17.11-alpine`, `redis:8.10-alpine`), validated for YAML correctness only
— see [DEPLOYMENT.md](DEPLOYMENT.md).

## 8. Environment variables

A single root [.env.example](.env.example) documents every variable across all three
services (not one per app) so the full configuration surface is visible in one place. Each
service reads only the variables relevant to it (see `apps/api/src/config/env.ts` and
`services/voice-agent/src/voice_agent/config.py`). Variables for integrations not yet built
(Stripe, Twilio, Deepgram, etc.) are present as empty placeholders so the eventual config surface
is documented ahead of time — see [SECURITY.md](SECURITY.md) for handling rules.

As of M2, `AUTH_SECRET` is the first variable that's actually required: `apps/api` calls
`assertAuthSecret()` at startup (`server.ts`, before `app.listen`) and refuses to start without
it, rather than silently hashing passwords with an insecure default.

## 9. Authentication

Full endpoint/response/test detail lives in [TASKS.md](TASKS.md) and [SECURITY.md](SECURITY.md);
this section covers the design.

**Session model — server-authoritative, cookie-based, opaque tokens (not JWT).** A high-entropy
random token is generated per session; only its SHA-256 hash is ever persisted
(`apps/api/src/auth/session.ts`), so a database read alone can't yield a valid session. The raw
token goes to the browser in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when
`NODE_ENV=production`) — never to client-side JavaScript, never in `localStorage`. This is the
pattern documented at Lucia Auth's ["Sessions" guide](https://lucia-auth.com/sessions/basic);
Lucia the *library* was discontinued by its maintainer, so this repository implements the pattern
directly (`apps/api/src/auth/session.ts`, `cookies.ts`) rather than depending on an unmaintained
package.

**Password hashing — Argon2id** via the `argon2` package (OWASP's current first-choice
algorithm, ahead of bcrypt/scrypt), using its default work factor. Passwords are additionally
HMAC'd with `AUTH_SECRET` before hashing (`apps/api/src/auth/password.ts`) — a documented
defense-in-depth "pepper" technique (OWASP Password Storage Cheat Sheet), not custom
cryptography. A database-only leak is insufficient to crack passwords offline.

**Persistence — Drizzle ORM + `pg`, Postgres only** (`apps/api/src/db/`). Chosen over Prisma for
being TypeScript-native, lightweight (no codegen binary/engine), and SQL-transparent — fits the
"avoid unnecessary dependencies" principle established in M1. `drizzle-kit generate` produces
real SQL migration files without needing a live database connection; *applying* them requires
Postgres, which is unavailable in this environment (§7).

**Repository interfaces as the DI seam** (`apps/api/src/repositories/types.ts`): `UserRepository`
and `SessionRepository` are interfaces with a Postgres/Drizzle implementation for production
(`repositories/drizzle/`) and an in-memory implementation used only by tests
(`apps/api/tests/support/in-memory-repositories.ts`). `createApp()` accepts an optional injected
`authService`, defaulting to the real Postgres-backed one — tests inject the in-memory version
instead, exercising the full HTTP layer, controllers, and business logic without a live database.
This is a test-strategy seam, not a production code path.

**Endpoints** (`apps/api/src/routes/auth.routes.ts`, mounted at `/auth`):

| Method & path | Auth required | Notes |
|---|---|---|
| `POST /auth/register` | no | 201 + sets session cookie (auto-login). 409 on duplicate email. |
| `POST /auth/login` | no | 200 + sets session cookie. 401 with a generic message for any failure. |
| `POST /auth/logout` | no (idempotent) | Invalidates the session server-side if one exists; always clears the cookie. |
| `GET /auth/me` | yes | Behind `requireAuth` middleware — the actual enforcement point. |

**Backend security boundary**: `apps/api/src/middleware/require-auth.ts` is what protects
`GET /auth/me` (and every future protected endpoint) — it independently validates the session
token server-side on every request. `apps/web`'s `/dashboard` page performs its own check
(`apps/web/src/lib/session.ts` calls the API's `/auth/me`, forwarding the incoming request's
cookie, and redirects to `/login` on failure) purely for UX; that frontend check is never the
security boundary. See [SECURITY.md](SECURITY.md).

**M3 extension point**: `users.id` is a stable UUID primary key. M3 is expected to add an
`organization_members` join table (or an `organization_id` column) referencing it — this
authentication system does not need to be replaced or redesigned for that.
