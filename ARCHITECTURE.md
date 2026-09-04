# Architecture

Status: **M5 — Voice/AI runtime foundation**, building on M1–M4. This document describes the
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

Routes as of M4: `/` (status page), `/login`, `/register` (client-side forms calling the API
directly), `/dashboard` (server-rendered; shows an organization-creation form if the user has
none, otherwise a real business-profile/hours/services/knowledge/receptionist-configuration UI —
see §10, §11). No real product UI (calling, booking, billing, etc.) exists.

## 3. apps/api — Backend API

Express 5 + TypeScript, ESM (`"type": "module"`). Modular layout:

```
src/
  config/         env parsing (config/env.ts), logger (config/logger.ts)
  db/             Drizzle schema, migrations, pg client (see §9, §10)
  auth/           password hashing, session token generation/validation, cookie helpers
  repositories/   repository interfaces + Postgres (Drizzle) implementations, unit-of-work (§10)
  services/       business logic, framework-agnostic (auth, organization, business-profile,
                   business-hours, services-catalog, knowledge, receptionist-config, health)
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

Routes as of M5: `GET /health` (M1, unauthenticated); `POST /auth/register`, `POST /auth/login`,
`POST /auth/logout`, `GET /auth/me` (M2 — see §9); `POST /organizations`, `GET /organizations`,
`GET|PATCH /organizations/:organizationId`, `GET|PUT /organizations/:organizationId/business-profile`,
`GET|PUT /organizations/:organizationId/business-hours`,
`GET|POST /organizations/:organizationId/services`,
`PATCH|DELETE /organizations/:organizationId/services/:serviceId` (M3 — see §10);
`GET|POST /organizations/:organizationId/knowledge`,
`PATCH|DELETE /organizations/:organizationId/knowledge/:knowledgeId`,
`GET|PUT /organizations/:organizationId/receptionist-config` (M4 — see §11);
`GET /internal/v1/organizations/:organizationId/runtime-context`,
`GET /internal/v1/organizations/:organizationId/knowledge` (M5, service-authenticated — see §12).

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

FastAPI, Python 3.12, managed by [uv](https://docs.astral.sh/uv/). Structure as of M5:

```
src/voice_agent/
  config.py       environment settings (incl. INTERNAL_SERVICE_KEY, provider selection)
  routes/         FastAPI routers (URL -> handler wiring) — GET /health only, still
  services/       business logic, framework-agnostic (health)
  clients/        typed HTTP client for apps/api's /internal/v1/* (api_client.py, models.py)
  providers/      STT/LLM/TTS provider factory + fake/no-op doubles (§12)
  tools/          read-only function-calling tools (search_knowledge.py, §12)
  runtime/        turns a fetched RuntimeContext into the LLM system prompt (context.py)
  pipeline.py     transport-agnostic bot pipeline construction (§12)
  bot.py          manual/local SmallWebRTCTransport smoke-test entry point — NOT in CI
  main.py         FastAPI app factory (create_app) + process entrypoint
```

**Python version**: pinned to 3.12 (`requires-python = ">=3.12,<3.13"`, `.python-version`),
managed entirely by `uv` — independent of and without modifying the system Python (3.14 at time
of writing). `uv sync` downloads its own 3.12 interpreter into this project only. 3.12 was
chosen over the system's newer 3.14 because it's the current safe baseline for the voice/ML
Python ecosystem this service will pull in from M4 onward — packages in that space (Pipecat and
its provider integrations, audio libraries) typically support the last 2-3 CPython minors first,
and 3.14 is too new to assume broad compatibility yet.

**Pipecat is a normal dependency as of M5** (`pipecat-ai>=1.8.1,<1.9.0`, pinned to a narrow range
since its frame/context APIs have already had breaking changes — e.g. the `LLMContext`/
`FunctionCallParams` model replacing an older OpenAI-specific context class), added via
`uv add "pipecat-ai[cartesia,deepgram,openai]"` against the current official docs — **not**
vendored, forked, or copied into this repository. See §12 for the full integration design.

## 6. Multi-tenancy

**Implemented** for organizations, business profiles, business hours, and services (M3, §10), and
knowledge entries and receptionist configuration (M4, §11). Calls, leads, appointments, phone
numbers, billing, and integrations remain future record types that will follow the same pattern
established here.

### Tenant boundary

The tenant is the **organization** (a business account, e.g. one dental office or one plumbing
company). Every one of the following record types is organization-scoped and must carry an
`organization_id`:

* users — via `organization_memberships` (a join table, not a direct column on `users`; a user
  can in principle belong to multiple organizations, though the M3 frontend only surfaces one)
* business configuration — `business_profiles`, `business_hours`, `services` (M3, §10)
* knowledge base entries — `knowledge_entries` (M4, §11)
* receptionist configuration — `receptionist_configurations` (M4, §11)
* calls, call transcripts, call summaries — future
* leads — future
* appointments — future
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
`organization_memberships`, `business_profiles`, `business_hours`, `services` (M3, §10);
`knowledge_entries`, `receptionist_configurations` (M4, §11) — via Drizzle ORM, with generated SQL
migrations in `apps/api/src/db/migrations/` (`0000_clever_shiver_man.sql`,
`0001_curly_forge.sql`, `0002_next_lester.sql`). `services/voice-agent` still does not connect to
it. **No migration has been applied to or tested against a real Postgres instance** — Docker is
unavailable in this environment (same limitation as M1; see [DEPLOYMENT.md](DEPLOYMENT.md)).
Application-level logic was instead verified against in-memory repository test doubles
implementing the same interfaces (§9, §10, §11) — this exercises the real business logic and HTTP
layer but not Postgres itself, and specifically **not** the real unique constraints, foreign keys,
or transaction rollback behavior (the in-memory unit-of-work does not actually roll back partial
writes on failure — see SECURITY.md known limitations).

A local Postgres instance was found listening on `localhost:5432` in the environment this
milestone was built in (unrelated to this project's Docker setup — `docker` itself remains
unconfirmed/unavailable via the CLI). It rejected this project's default dev credentials
(expected — it isn't provisioned for this project). It was not used for verification and no
attempt was made to configure or connect to it; the honest status remains "Postgres integration is
untested here." Its presence was discovered incidentally: a test-wiring bug in M4 (a new service
not injected into `createApp()`'s test double) caused two test suites to silently fall through to
the real Postgres-backed code path instead of the in-memory one, and the resulting connection
error (rather than a silent pass) is what surfaced the bug — see TASKS.md.

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
it, rather than silently hashing passwords with an insecure default. As of M5,
`INTERNAL_SERVICE_KEY` is the second — `assertServiceAuthSecret()` follows the identical
fail-closed pattern (see §12).

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

## 11. Knowledge and Receptionist Configuration

M4's goal: make the business's knowledge and AI receptionist configuration persistent, editable,
and tenant-safe — not to make phone calls. Full test coverage and known limitations live in
[TASKS.md](TASKS.md)/[SECURITY.md](SECURITY.md); this section covers the design.

**Knowledge** (`apps/api/src/db/schema.ts#knowledgeEntries`): a single flat table — `title`,
`content`, `category` (`faq | policy | service_info | custom`), `active`, timestamps,
`organizationId`. Deliberately no document/chunk split and no embeddings column — a future RAG
milestone adds chunking/embeddings as a **new, additive** table referencing this one's stable
`id` (e.g. `knowledge_chunks.knowledge_entry_id -> knowledge_entries.id`), not a redesign of it.
No web crawling / website-derived ingestion (out of scope — this is manual-entry only). Search is
a simple case-insensitive substring match (`ilike` in Postgres, plain `.includes()` in the
in-memory test double) against title + content, exposed via `?q=` on the list endpoint — not
Postgres full-text search, not embeddings, not an external search service.

**Receptionist configuration** (`apps/api/src/db/schema.ts#receptionistConfigurations`): one row
per organization (`organizationId` itself unique, same pattern as `business_profiles`).
Provider-agnostic by design — no model name, no voice id, no API key column, nothing naming
OpenAI/Anthropic/ElevenLabs/Deepgram/Twilio anywhere in the schema. Every field with a sensible
deterministic default is `NOT NULL` with that default (both at the DB level and set explicitly by
`createOrganization`) rather than nullable; `callTransferPhone` is the sole exception, since there
is no reasonable default for a phone number. "Business-hours behavior" is deliberately not a
separate field — the future voice runtime is expected to combine this config's `greeting` (open
hours) and `afterHoursMessage` (override) with M3's existing `business_hours` table, rather than
duplicate the open/closed concept here.

**Auto-seeded at organization creation, always disabled**: `OrganizationService.createOrganization`
(§10) now also creates a default receptionist configuration inside the same transaction. `enabled`
is forced to `false` in two independent places — the DB column default, and
`ReceptionistConfigRepository.create()` explicitly overriding whatever it's passed — so
organization creation can never activate a receptionist, even if a future caller of `create()`
tried to pass `enabled: true`.

**Authorization**: identical mechanism to M3 (§10) — no new middleware, no RBAC changes.
`requireOrgMembership` already generalizes to these two new resource types; every knowledge
repository method is scoped by `(id, organizationId)` in the same query as `ServiceRepository`
already was, and the same "404 for non-members, verified via direct repository checks that data is
unchanged" test pattern is used in `apps/api/tests/knowledge.test.ts` and
`receptionist-config.test.ts`.

**Voice-agent contract, resolved in M5**: M4 originally defined this contract by reusing the
existing user-authenticated `/organizations/...` endpoints and deliberately deferred designing
service-to-service authentication to "the milestone that wires up the voice runtime." That
milestone is M5 — see §12 for the resulting `/internal/v1/...` surface, its authentication
design, and why it's a separate router rather than a branch on `requireAuth`/`requireOrgMembership`.

**Frontend**: `KnowledgeManager` and `ReceptionistConfigForm` (client components under
`apps/web/src/components/knowledge/` and `.../receptionist/`) follow the exact same pattern as
M3's components — real `fetch` calls with `credentials: 'include'`, loading/saving/saved/error
states, no mocked data — rendered on the existing `/dashboard` page alongside M3's sections
(`apps/web/src/lib/organizations.ts` extended with the new types/fetchers, not a new file, to
match the existing single-file-of-org-scoped-fetchers convention).

## 12. Voice/AI Runtime Foundation (M5)

M5's goal: give the Python voice-agent a secure way to read a tenant's configuration/knowledge,
and give it a Pipecat-based conversational pipeline built on that data — **not** to place or
receive a real phone call. No Twilio, no PSTN, no phone numbers, no SMS anywhere in this
milestone; that is M6. Full test coverage and known limitations live in
[TASKS.md](TASKS.md)/[SECURITY.md](SECURITY.md); this section covers the design.

### 12.1 Internal voice API

A new router, `GET /internal/v1/organizations/:organizationId/{runtime-context,knowledge}`
(`apps/api/src/routes/internal.routes.ts`), mounted alongside — not inside — the existing
`/organizations/...` router. `/v1` is the **first use of API versioning in this project**,
justified because this is now a contract between two independently-deployable,
independently-releasable services (unlike `apps/web`, which always ships against the
same-release-train API); a future breaking change gets `/v2` alongside `/v1`, not a silent break.

* `GET .../runtime-context` — aggregates receptionist config + business profile + business hours
  + services into one response (`RuntimeContext`, defined once in
  `packages/shared/src/voice-runtime.ts` as the canonical wire shape, consumed on the Python side
  by hand-written mirror models in `services/voice-agent/src/voice_agent/clients/models.py` since
  Python can't import a TS package). Fetched once per session at connection start — everything in
  it is small and bounded, so there is no need for a live tool/round-trip for any of it.
* `GET .../knowledge` — identical filter semantics (`category`, `active`, `q`) to the public
  knowledge endpoint, deliberately kept separate and on-demand rather than folded into
  runtime-context, since knowledge can grow arbitrarily large and needs live querying mid-call
  (this is the one thing exposed as a tool to the LLM — see §12.5).

Both handlers reuse the exact same M2–M4 services (`organizationService`, `receptionistConfigService`,
`businessProfileService`, `businessHoursService`, `servicesCatalogService`, `knowledgeService`) —
no new repository or business logic was added for M5, only a new controller/route layer with a
different auth mechanism and an aggregated response shape.

### 12.2 Service-to-service authentication

**Credential type**: a single static, long, random, opaque bearer token (not a JWT — no
claims/issuer/expiry machinery is needed for one caller; not mTLS/OAuth2 client-credentials —
real security work that pays off with multiple internal services, credential rotation, and scoped
grants, none of which apply yet with exactly one internal caller and no Docker/infra available in
this environment to run a token-issuing service anyway). Sent as a standard
`Authorization: Bearer <token>` header — deliberately the standard header name so it's already
covered by `config/logger.ts`'s existing `req.headers.authorization` redaction, with zero logger
changes needed.

**Generation**: a one-time manual operator step (`openssl rand -hex 32`), not generated by
application code at runtime — documented as a setup step in `README.md`.

**Storage**: the environment variable `INTERNAL_SERVICE_KEY`, identically valued on both
`apps/api` and `services/voice-agent`. Never in Postgres, never committed to source control — same
class of value as `AUTH_SECRET`.

**Validation**: `apps/api/src/middleware/require-service-auth.ts` extracts the bearer token and
compares it to `env.internalServiceKey` with `crypto.timingSafeEqual`, **after an explicit
length check** — `timingSafeEqual` throws on a length mismatch instead of returning `false`, so a
wrong-length key must be rejected before ever calling it, not left to crash into the generic error
handler. This is the first use of `timingSafeEqual` in the codebase — justified because, unlike
the hashed session token (looked up by equality inside Postgres), this key is compared directly
in Node application code against a fixed value on every request, so a naive `===` could leak
timing information about how many leading bytes matched.

**Scope: this key alone is not tenant-scoped.** It only proves "trusted internal service" — it
says nothing about which organization a request may touch. What actually authorizes a specific
`:organizationId` is a second, independent credential: `X-Organization-Service-Token`.

**Per-organization credential (`X-Organization-Service-Token`)**: generated once per
organization, inside the same transaction as organization creation
(`src/auth/organization-service-token.ts#generateOrganizationServiceToken`,
`crypto.randomBytes(32).toString("hex")`). Only its SHA-256 hash is persisted, in
`organization_service_credentials.token_hash` — the same hashed-credential discipline as
session tokens (`sessions.id`); `organization_id` is that table's PRIMARY KEY, so exactly one
credential exists per organization at the database level. The raw token is returned to the
caller exactly once, in `POST /organizations`'s response body, and never persisted in
plaintext, logged, or returned by any other endpoint.

`apps/api/src/middleware/require-organization-service-token.ts`, mounted after
`requireServiceAuth`, looks up the stored hash for the URL's `:organizationId`, hashes the
presented `X-Organization-Service-Token`, and compares it with the same `safeCompare()`
constant-time helper `require-service-auth.ts` exports. **This — not the global key — is what
establishes which organization a request is authorized for**: a token issued for organization A
is checked only against organization A's stored hash, so presenting it against any other
organization's URL fails (403), every time. A request with a valid global key but a missing,
wrong, or wrong-length organization token is rejected (403) before touching any organization
data; a request naming an organization id with no credential row at all — impossible for any
organization created through the normal flow, since creation always seeds one — is rejected
(404). No automated rotation/reissue exists for a leaked organization token in M5; recovering
from one currently requires a direct database update — deferred, not an oversight (see
SECURITY.md §8.2).

**Rotation/revocation**: manual only — an operator generates a new value, updates the env var on
both services, and restarts both. Because it's a single compared value (not a list), rotation
causes a brief availability gap unless both services are updated in the same window; there is no
dual-key grace-period support in M5. Documented as a known, deliberate limitation.

**Unauthorized behavior**: missing header, wrong scheme (non-`Bearer`), or a mismatched key all
produce the same `401 { "error": "Not authenticated." }` — no distinction is leaked between "no
credential" and "wrong credential."

**Why a separate router, not a branch on `requireAuth`/`requireOrgMembership`**: those middleware
exist specifically to verify a *user's* session and a *user's* membership row — a service
credential has neither. Forcing it through that path would mean special-casing every call site;
one small, honestly-named `requireServiceAuth` middleware mounted on its own router is more
honest about what's actually being checked. `createApp()` fails safe rather than throwing if no
key is configured at all: it falls back to a random per-boot value (`crypto.randomBytes(32)`)
rather than either crashing every caller of `createApp()` (breaking, e.g., the M1 health test,
which never touches `/internal/v1`) or accepting a predictable default — an unset key means
`/internal/v1` is simply unreachable, not that it accepts anything. Real production startup is
still fail-closed via `assertServiceAuthSecret()` in `server.ts`, which runs before `createApp()`
and refuses to start the process at all if `INTERNAL_SERVICE_KEY` is unset or too short.

### 12.3 Tenant scoping on the internal API

No membership concept applies to a service credential, so `/internal/v1/...` does not use
`requireOrgMembership` — tenant scoping is `requireOrganizationServiceToken` (§12.2), mounted
after `requireServiceAuth` on every route. `organizationId` is always taken from the URL path,
never trusted from a body; a request 404s if no organization (and therefore no credential row)
exists for that id, and 403s if one exists but the presented `X-Organization-Service-Token`
doesn't match its stored hash — reusing the same non-enumeration convention as the public API
for the 404 case. An explicit regression test suite (`apps/api/tests/internal-api.test.ts`)
proves: the two auth mechanisms are mutually exclusive (a valid service bearer token does not
authorize `/organizations/...`, and a valid session cookie does not authorize
`/internal/v1/...`); an organization's own token authorizes its own `runtime-context`/
`knowledge` (200); a *different* organization's token against the same URL is rejected (403),
including after freshly creating a third organization to rule out any incidental id-ordering
effect; a missing, wrong, or wrong-length organization token is rejected (403); a nonexistent
organization id is rejected (404); and a disabled receptionist configuration still returns
`200` with `enabled: false` — the API's job is to report state accurately, not to gate on it;
the voice-agent is expected to check `enabled` itself before starting a session.

### 12.4 Pipecat integration

`pipecat-ai` is a normal dependency (§5) — application code is limited to: the provider
factory/fakes (§12.5), the one tool (§12.6), pipeline *wiring*
(`services/voice-agent/src/voice_agent/pipeline.py` — composing Pipecat's building blocks with
chosen services and the tool), and the internal-API client that feeds the pipeline its context.
Everything else — STT/LLM/TTS execution, frame routing (`Frame`/`FrameProcessor`/`Pipeline`),
interruption handling, function-calling plumbing (`LLMContext`, `FunctionCallParams`,
`register_function`/`run_function_calls`), and transport implementations — is Pipecat's framework
code, used as-is.

**Transport-agnostic by construction**: `pipeline.py`'s `build_pipeline()` takes any Pipecat
`BaseTransport` and contains zero telephony-specific code — it never imports a
Twilio/Telnyx/Plivo-related class. The only transport instantiated anywhere in M5 is
`SmallWebRTCTransport`, and that instantiation is confined entirely to `bot.py` (a manual,
non-CI, local smoke-test entry point using Pipecat's own official development runner,
`pipecat.runner.run` + `create_transport()`'s factory-dict pattern, rather than hand-rolled WebRTC
signaling) — `pipeline.py` itself never references it. A future M6 Twilio transport is a new
entry in that factory dict plus a new runner-args type; `pipeline.py` does not change.

**Session/runtime state is ephemeral**: a session is one `Pipeline` instance built per
connection — `runtime-context` is fetched once at session start, folded into the LLM's system
prompt (`runtime/context.py`), and everything else (conversation history, tool-call state) lives
only in that pipeline instance's process memory for the connection's lifetime. Nothing is
persisted; there is no session table. This means the prompt can go stale if the underlying config
changes mid-call — an accepted, documented limitation given M5's short-lived, foundation-only
scope, not an oversight.

### 12.5 Provider abstraction (STT/LLM/TTS)

No custom STT/LLM/TTS interface was built — Pipecat's own `STTService`/`LLMService`/`TTSService`
base classes already are that abstraction (swapping vendors means instantiating a different
Pipecat-provided subclass, not writing a new interface). Application code adds exactly one thin
layer, `providers/factory.py`: env vars `STT_PROVIDER`/`LLM_PROVIDER`/`TTS_PROVIDER` select either
a real Pipecat provider class (`DeepgramSTTService`, `OpenAILLMService`, `CartesiaTTSService` —
each imported lazily, only when actually selected, so the module never requires every provider
SDK to be installed) or a deterministic fake (`providers/fakes.py`) satisfying the same base
class. **`"fake"` is the default for every role** — the service boots and every automated test
passes with zero provider credentials configured; a real provider additionally requires its
matching API key env var (`_require_env()`, a clear `ProviderConfigurationError` if missing —
fails closed, not silently unauthenticated).

Provider choice is a voice-agent **deployment** concern (an env var), not a per-tenant database
field — a direct, intentional continuation of §11's "provider-agnostic, no vendor/model/API-key
columns" decision on `receptionist_configurations`.

The fakes (`FakeSTTService`, `FakeTTSService`, `FakeLLMService`) genuinely subclass Pipecat's real
base classes rather than a hand-rolled substitute, so pipeline construction and tests exercise the
same code path a real provider would. `FakeLLMService` in particular overrides `process_frame`
(not just `_process_context`) to actually trigger inference on `LLMContextFrame` — mirroring what
`BaseOpenAILLMService.process_frame` does — and, when a configurable trigger phrase is present in
the last user message, calls Pipecat's real `run_function_calls()` to invoke the registered
`search_knowledge` handler, so `tests/test_pipeline.py` proves genuine integration with Pipecat's
function-calling machinery, not a bypass (verified by asserting the mocked internal API was
actually called and its real response flows through to a `FunctionCallResultFrame`).

### 12.6 Tools

Exactly one read-only, dynamic function-calling tool for M5:
`search_knowledge(query, category?)` (`tools/search_knowledge.py`), calling the internal
`GET /internal/v1/organizations/:id/knowledge` endpoint. Its handler is embedded directly on a
`FunctionSchema` (Pipecat auto-registers a schema's embedded handler wherever it's advertised in
an `LLMContext`, so no separate `register_function` call is needed), and never raises on failure —
an API error is delivered as a structured `{"error": ...}` result via the normal result callback,
so a failed lookup degrades the conversation rather than crashing the session.

Business profile, hours, services, and the receptionist config are **not** tools — they're
prefetched once via `runtime-context` (§12.1) and folded into the system prompt, since they're
small and bounded and don't need live querying. Hours/services-as-tools are explicitly deferred
(easy to add later if a catalog grows large enough that prefetching stops being practical), and no
write-capable tool exists — no booking, no lead capture, no CRM writes, per the milestone
boundary.

### 12.7 Testing strategy

Same "real logic tested via doubles, real infra reserved for manual verification" philosophy
M1–M4 already established (`build-test-app.ts` on the Node side), extended to the voice-agent:

* **Node** (`apps/api/tests/internal-api.test.ts`, Supertest against the full app with in-memory
  repos): auth-required, cross-auth isolation, correct aggregation, 404-for-nonexistent-org — see
  §12.3.
* **Python** (`pytest` + `pytest-asyncio`, zero network, zero real credentials):
  `test_providers.py` (factory selection + fail-closed-without-API-key paths),
  `test_api_client.py` (`respx`/`httpx.MockTransport`-mocked HTTP: success, 401, 404,
  unreachable-server), `test_search_knowledge_tool.py` (handler logic in isolation),
  `test_build_pipeline.py` (structural: `build_pipeline()` accepts a minimal fake `BaseTransport`
  and returns a `Pipeline`), and `test_pipeline.py` (behavioral: uses Pipecat's own
  `pipecat.tests.utils.run_test` — the officially supported way to test a `FrameProcessor`'s frame
  flow — to run `FakeLLMService` for real and prove the tool genuinely executes).
* **Manual only, never CI**: running the real pipeline over `SmallWebRTCTransport`
  (`bot.py` + Pipecat's development runner) with real provider keys configured, to literally talk
  to the bot in a browser. Documented in `services/voice-agent/README.md` as a developer-only
  workflow.

No test requires Postgres, Docker, a real STT/LLM/TTS provider, a microphone, a browser, a
WebSocket, or a phone call.
