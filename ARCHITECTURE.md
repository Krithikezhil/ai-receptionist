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

Routes as of M3: `/` (status page), `/login`, `/register` (client-side forms calling the API
directly), `/dashboard` (server-rendered; shows an organization-creation form if the user has
none, otherwise a real business-profile/hours/services configuration UI — see §10). No real
product UI (calling, booking, billing, etc.) exists.

## 3. apps/api — Backend API

Express 5 + TypeScript, ESM (`"type": "module"`). Modular layout:

```
src/
  config/         env parsing (config/env.ts), logger (config/logger.ts)
  db/             Drizzle schema, migrations, pg client (see §9, §10)
  auth/           password hashing, session token generation/validation, cookie helpers
  repositories/   repository interfaces + Postgres (Drizzle) implementations, unit-of-work (§10)
  services/       business logic, framework-agnostic (auth, organization, business-profile,
                   business-hours, services-catalog, health)
  middleware/     requireAuth, requireOrgMembership — the actual server-side boundaries
                   (see SECURITY.md)
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

Routes as of M3: `GET /health` (M1, unauthenticated); `POST /auth/register`, `POST /auth/login`,
`POST /auth/logout`, `GET /auth/me` (M2 — see §9); `POST /organizations`, `GET /organizations`,
`GET|PATCH /organizations/:organizationId`, `GET|PUT /organizations/:organizationId/business-profile`,
`GET|PUT /organizations/:organizationId/business-hours`,
`GET|POST /organizations/:organizationId/services`,
`PATCH|DELETE /organizations/:organizationId/services/:serviceId` (M3 — see §10).

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

**Implemented as of M3** for organizations, business profiles, business hours, and services (see
§10). Calls, leads, appointments, knowledge, phone numbers, billing, and integrations remain
future record types that will follow the same pattern established here.

### Tenant boundary

The tenant is the **organization** (a business account, e.g. one dental office or one plumbing
company). Every one of the following record types is organization-scoped and must carry an
`organization_id`:

* users — via `organization_memberships` (a join table, not a direct column on `users`; a user
  can in principle belong to multiple organizations, though the M3 frontend only surfaces one)
* business configuration — `business_profiles`, `business_hours`, `services` (M3, §10)
* calls, call transcripts, call summaries — future
* leads — future
* appointments — future
* knowledge base entries — future
* phone numbers — future
* integrations (Google Calendar, Twilio config, etc.) — future
* usage records — future
* billing/subscription records — future

There is no scenario in this product where one organization should ever see another
organization's rows. Unlike some SaaS designs, there is no "shared across tenants" data class
planned beyond global, non-tenant config (e.g. system feature flags), so the default assumption
for any new table is "it needs `organization_id`" unless a reviewer explicitly justifies
otherwise.

### Enforcement strategy

Frontend filtering is **not** a security boundary — nothing below relies on it.

1. **Every org-scoped table has a non-nullable, indexed `organization_id` foreign key** to
   `organizations.id`, `ON DELETE CASCADE`. Implemented for `business_profiles`, `business_hours`,
   `services` (§10's migration).
2. **The organization named in a request is never trusted merely because it's present — it is
   independently re-authorized on every single request.** `organization_id` does appear in the
   URL (`/organizations/:organizationId/...`), which is normal, unremarkable REST design — the
   security property isn't about *where* the id comes from, it's that `requireOrgMembership`
   (`apps/api/src/middleware/require-org-membership.ts`) runs a fresh database query
   (`(organizationId, req.user.id) -> membership row?`) on every request, after `requireAuth` has
   independently verified the session. A non-member gets 404 regardless of what they name in the
   URL — proven by automated tests that create org A as user A, then have user B (authenticated,
   but not a member of org A) attempt to read/write it by naming org A's real id directly (see
   `apps/api/tests/organizations.test.ts`). This is a deliberate refinement of the original M1
   wording of this section ("never from a client-supplied field") — the precise property that
   matters is *independent re-authorization on every request*, which a URL param satisfies just
   as well as a session-cached value would, and arguably better (see point 5).
3. **A data-access layer enforces scoping, not ad-hoc query authors.** Every repository method
   that reads/writes a service by id also filters by `organizationId` in the same query (e.g.
   `ServiceRepository.update(id, organizationId, changes)` — see §10) — there is no "raw query
   with tenant filtering optional" escape hatch in application code. A spoofed `organizationId` in
   a request *body* is additionally a no-op: create/update schemas don't accept that field at all,
   so the URL-derived, already-authorized value is the only one ever used.
4. **PostgreSQL Row-Level Security (RLS) — not implemented yet.** Documented in M1/M2 as a
   defense-in-depth layer under the application-layer scoping; still not built as of M3. The
   application-layer scoping (points 2-3) is the only enforcement currently in place. Tracked as a
   known limitation — see SECURITY.md.
5. **Fail closed.** A non-member gets 404 (not 403) — the same response whether the organization
   exists and they're not a member, or it doesn't exist at all — so the endpoint can't be used to
   enumerate which organization ids exist. No query path returns cross-tenant rows on
   missing/invalid context.
6. **Tenant isolation is directly tested.** `apps/api/tests/organizations.test.ts` proves, with
   real HTTP requests through the full middleware stack (not mocked): an unauthenticated caller is
   rejected; a member can access their org; a non-member cannot access, read, or write another
   org's organization record, business profile, or services; a spoofed body-level
   `organizationId` cannot orphan a record into another tenant; duplicate memberships are
   rejected; organization creation produces exactly one correct owner membership.

See [SECURITY.md](SECURITY.md) for how this fits the broader security posture.

## 7. Data layer

**PostgreSQL**: `apps/api` has a real schema — `users`, `sessions` (M2, §9); `organizations`,
`organization_memberships`, `business_profiles`, `business_hours`, `services` (M3, §10) — via
Drizzle ORM, with generated SQL migrations in `apps/api/src/db/migrations/`
(`0000_clever_shiver_man.sql`, `0001_curly_forge.sql`). `services/voice-agent` still does not
connect to it. **Neither migration has been applied to or tested against a real Postgres
instance** — Docker is unavailable in this environment (same limitation as M1; see
[DEPLOYMENT.md](DEPLOYMENT.md)). Application-level logic was instead verified against in-memory
repository test doubles implementing the same interfaces (§9, §10) — this exercises the real
business logic and HTTP layer but not Postgres itself, and specifically **not** the real unique
constraints, foreign keys, or transaction rollback behavior (the in-memory unit-of-work does not
actually roll back partial writes on failure — see SECURITY.md known limitations).

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

**M3 extension point**: `users.id` is a stable UUID primary key. M3 added an
`organization_memberships` join table referencing it (§10) without any change to the
authentication system itself — exactly the extension this section anticipated.

## 10. Organizations

Full endpoint list, test coverage, and known limitations live in
[TASKS.md](TASKS.md)/[SECURITY.md](SECURITY.md); this section covers the design.

**Schema** (`apps/api/src/db/schema.ts`, migration `0001_curly_forge.sql`):

* `organizations` — `id`, `name`, `slug` (unique), timestamps.
* `organization_memberships` — `organization_id` + `user_id` (both FK, `ON DELETE CASCADE`),
  `role` (`"owner" | "member"` — no fine-grained RBAC yet, matching the M3 brief), unique on
  `(organization_id, user_id)` so a user can't be added to the same org twice.
* `business_profiles` — one per organization (`organization_id` itself is `unique`, not just
  indexed): name, description, phone, email, website, address, timezone.
* `business_hours` — one row per `(organization_id, day_of_week)` (0=Sunday..6=Saturday,
  matching JS `Date#getDay()`), unique on that pair; `open_time`/`close_time` are nullable
  `"HH:MM"` strings, null when closed. No holiday/special-hours calendar (explicitly out of M3
  scope).
* `services` — a minimal catalog (name, duration, price, active flag) describing what a business
  offers. No booking/scheduling/availability logic — that's a later milestone.

**Role model**: any membership (owner or member) currently grants full read/write access to that
organization's profile/hours/services. The brief explicitly excludes building RBAC beyond
"authenticated or not" for M3, so no endpoint currently distinguishes owner from member — this is
a deliberate scope decision, not an oversight, and the `role` column exists specifically so a
future milestone can add that distinction without a schema change.

**Current organization**: M3 does **not** store a "current organization" anywhere — not in the
session, not in a cookie. Every organization-scoped request names the organization explicitly via
the URL (`/organizations/:organizationId/...`), and `requireOrgMembership` independently
re-verifies membership against the database on every single request (see §6 point 2 for why this
is at least as strong a guarantee as a session-cached value, and arguably stronger — membership
changes take effect immediately rather than waiting for a new session). The `apps/web` dashboard
calls `GET /organizations`, and — since M3 doesn't build a multi-organization switcher UI — simply
uses the first result. A user with multiple memberships (fully supported by the data model and
API) would need a switcher UI added in a later milestone; nothing about the current design would
need to change to add one.

**Organization creation is transactional**
(`apps/api/src/services/organization.service.ts#createOrganization`): organization, owner
membership, initial business profile, and default (all-closed) business hours for all 7 days are
created together via a `UnitOfWork` abstraction
(`apps/api/src/repositories/unit-of-work.ts`) — the Postgres implementation wraps a real
`db.transaction()`; the in-memory test implementation runs the same callback without transaction
semantics (see §7's data-layer note on why this means transactional *rollback* itself is unverified
here). An organization is never left without its owner membership by construction — there is no
code path that creates one without the other.

**Tenant isolation enforcement**: see §6. The short version — `requireOrgMembership` middleware,
every repository method scoped by `organizationId` in the query, non-member requests get 404, and
`apps/api/tests/organizations.test.ts` proves all of this with real HTTP requests, including the
specific case of a spoofed `organizationId` in a request body being ignored in favor of the
URL-derived, already-authorized value.

**Frontend**: `apps/web/src/app/dashboard/page.tsx` (server component) fetches organizations,
business profile, hours, and services server-side (forwarding cookies, same pattern as
`lib/session.ts`), and renders `CreateOrganizationForm`, `BusinessProfileForm`,
`BusinessHoursForm`, and `ServicesManager` (all client components under
`apps/web/src/components/organizations/`) with that data as initial props. Every mutation is a
real `fetch` call to the API with `credentials: 'include'` — none of it is mocked, and none of the
frontend code makes any authorization decision; it only reflects what the API already decided.
