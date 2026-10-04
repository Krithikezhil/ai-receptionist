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
the M1 brief exists and was verified.

- [x] ~~No CI pipeline configured~~ — added after the initial M1 commit:
      `.github/workflows/ci.yml` runs `npm run lint/typecheck/test/build` and the `uv run`
      equivalents on every push/PR to `main`. Verified green on GitHub Actions (run
      [33797295861](https://github.com/Krithikezhil/ai-receptionist/actions/runs/33797295861),
      commit `f08a613`) — job/step logs independently inspected, not just the pass/fail label.
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

## Completed — M2 Authentication

**Design (Phase A)**
- [x] Inspected existing M1 `apps/api`/`apps/web` structure and package versions before adding
      anything
- [x] Selected session-cookie auth (not JWT) — required cookie/session characteristics in the
      brief (HttpOnly, SameSite, server-side invalidation, no localStorage) point directly at the
      "database session" pattern
- [x] Checked Lucia Auth's current status before referencing it: the library itself was
      discontinued by its maintainer; its "Sessions" guide is still published as a reference
      pattern, which this repo implements directly rather than depending on an unmaintained
      package
- [x] Checked npm registry + installed-package types directly rather than assuming API shape —
      caught two real mismatches this way (see "Known limitations")

**Persistence (Phase B)**
- [x] Drizzle ORM + `pg`, Postgres-only schema: `users` (id, email unique, password_hash,
      timestamps), `sessions` (id = SHA-256 hash of the session token, user_id FK cascade,
      expires_at)
- [x] `drizzle-kit generate` produced a real SQL migration
      (`apps/api/src/db/migrations/0000_clever_shiver_man.sql`) — inspected directly, matches the
      schema
- [x] `argon2` (Argon2id) password hashing — smoke-tested directly (`argon2.hash`/`.verify`) on
      this machine before wiring it in; installs cleanly on Windows via prebuilt binaries, no
      native build toolchain needed
- [x] `AUTH_SECRET`-derived HMAC pepper mixed into every password before hashing; required at
      startup (`assertAuthSecret()`), no code-level default
- [x] Session token generation/hashing/validation/invalidation (`src/auth/session.ts`) following
      the documented hashed-token pattern

**API (Phase C)**
- [x] `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
      (`src/routes/auth.routes.ts`), following the existing `routes/controllers/services` split
- [x] `zod` request validation; generic 401 for bad login (no enumeration via error message);
      dummy-hash verify when the email doesn't exist (timing-safety)
- [x] `requireAuth` middleware — the actual server-side enforcement point for protected routes
- [x] `createApp()` extended with an optional injected `authService` (defaults to the real
      Postgres-backed one) — the DI seam the test strategy depends on; M1's health route
      untouched by this change

**Frontend (Phase D/E)**
- [x] `/login`, `/register` — real client-side forms calling the API with `credentials:
      'include'`, generic error display, no fake product UI
- [x] `/dashboard` — server component, calls the API's `/auth/me` forwarding the request's
      cookies, redirects to `/login` on failure; explicitly labeled as a placeholder, does not
      imply calling/billing/booking work
- [x] Logout as a client component hitting `POST /auth/logout` then redirecting
- [x] No session token ever touches `localStorage` or client-side JS — only the `HttpOnly` cookie

**Tests (Phase F)** — `apps/api/tests/auth.test.ts`, 13 tests total (health + auth), all actually
exercising the HTTP layer via Supertest against in-memory repositories, not mocked-away:
- [x] Registration: succeeds with a real 201 + session cookie; rejects invalid email/short
      password (400); rejects duplicate email (409) without creating a second account
- [x] Login: succeeds with valid credentials; rejects wrong password and unknown email with the
      *identical* status/message (enumeration check, asserted via equality, not just "both fail")
- [x] Session: valid session reaches `GET /auth/me`; missing cookie → 401; **forged/garbage
      cookie value → 401** (proves the backend validates rather than trusting cookie presence);
      logout invalidates the session (re-checked with the same agent after logout); logout is
      idempotent with no session
- [x] Security: stored password is not plaintext and not a substring of the hash, starts with
      `$argon2id$` (inspected directly from the in-memory repo, not just "hashing didn't throw");
      no API response body (register or login) contains `passwordHash`/`password_hash` anywhere;
      `Set-Cookie` contains `HttpOnly` and `SameSite=Lax`

**Documentation (Phase G)**
- [x] ARCHITECTURE.md §9 (Authentication) added; §§2, 3, 6, 7, 8 updated where M2 changed them
- [x] SECURITY.md §2 (Authentication and session security) added — backend security boundary,
      password storage, sessions, brute-force/enumeration, CSRF, input validation, all mapped to
      what was actually verified, not aspirational
- [x] README.md, IMPLEMENTATION_PLAN.md, `.env.example` updated; M1-specific content left alone
      per instructions

**Verification actually run**
- [x] `npm install` (from apps/api, adding new deps) — 0 vulnerabilities on the new direct
      dependencies; one pre-existing transitive advisory investigated, not hidden (see below)
- [x] `npm run typecheck -w apps/api` / `-w apps/web` — clean, including after two real API
      mismatches were found and fixed (not from stale training assumptions — see below)
- [x] `npm run lint -w apps/api` / `-w apps/web` — clean
- [x] `npm run test -w apps/api` — 13/13 passing
- [x] `npm run build -w apps/web` (`next build`) — succeeded, includes Next's internal TypeScript
      check
- [x] Root aggregate `npm run lint` / `npm run typecheck` / `npm run test` / `npm run build` —
      full-repo regression, all workspaces, all green
- [x] `git diff` / `git status` inspected; secret scan run over the diff before reporting readiness

## Remaining M2 work

None identified as blocking M2's stated scope (register/login/logout/session/protected
routes/tests/docs all exist and were verified). Explicitly out of scope by the M2 brief itself,
not an oversight:

- [ ] Organizations, tenant scoping, roles beyond "authenticated or not" — M3.
- [ ] Rate limiting / account lockout on login — flagged as the top near-term hardening item in
      SECURITY.md, not built in M2.
- [ ] CSRF double-submit token, email verification, password reset, MFA — documented as known
      gaps in SECURITY.md, not built in M2.
- [ ] Applying the generated migration to a real Postgres instance — blocked on Docker being
      unavailable in this environment, not on missing code.

## Known limitations (M2 additions)

- **Postgres integration is unverified against a real database.** Docker remains unavailable in
  this environment. The schema is real, the migration was generated and inspected, and the exact
  same repository interface is exercised by 13 passing tests — but only against an in-memory
  implementation, not Postgres itself. Applying `apps/api/src/db/migrations/0000_clever_shiver_man.sql`
  and re-running the auth flow against real Postgres has not been done. See
  [DEPLOYMENT.md](DEPLOYMENT.md).
- **`drizzle-kit@0.31.10`** (current latest) has a transitive dependency on a deprecated,
  vulnerable `@esbuild-kit/esm-loader` (`npm audit`: 4 moderate advisories). It's a
  **devDependency only**, used solely to transpile `drizzle.config.ts` for local migration
  generation — never shipped in the running API. No newer release fixes it yet; documented rather
  than worked around with a downgrade that would likely break compatibility. See SECURITY.md §5.
- **No rate limiting / brute-force protection** on `/auth/login` or `/auth/register` — the most
  significant near-term security gap. See SECURITY.md §6.
- **No CSRF token beyond `SameSite=Lax`**, no email verification, no password reset, no MFA — see
  SECURITY.md §6.
- **Two real (not hypothetical) API mismatches were found and fixed during implementation**,
  both by checking the actually-installed package rather than relying on prior knowledge:
  1. `cookie@2.x` renamed `parse`/`serialize` to `parseCookie`/`serializeCookie` (breaking change
     from the 0.x API most examples reference) — caught by `tsc`, fixed in `src/auth/cookies.ts`.
  2. `zod`'s `.string().email()` is now deprecated in favor of top-level `z.email()` — caught by
     reading the installed type definitions, fixed in `src/validation/auth.schemas.ts`.
- **`npm install cookie` (no version specified) silently resolved to `0.7.2`**, not the actual
  latest (`2.0.1`), because npm deduped against Express's existing transitive dependency instead
  of fetching latest. Caught by checking `npm ls` output, not assumed correct. Worth remembering
  for future dependency additions in this repo: verify the version that actually lands in
  `package.json`, don't trust that a bare `npm install <pkg>` always gets latest.

## Completed — M3 Organizations and business configuration

**Data model**
- [x] `organizations` (id, name, slug unique), `organization_memberships`
      (organization_id + user_id FK cascade, role `owner|member`, unique on the pair),
      `business_profiles` (one per org — `organization_id` itself unique), `business_hours` (one
      row per org+day-of-week, unique on the pair), `services` (name/duration/price/active) —
      `apps/api/src/db/schema.ts`
- [x] Migration generated (`0001_curly_forge.sql`) and inspected directly — every constraint
      (FKs, uniques) confirmed present in the actual generated SQL, not just the schema source
- [x] Verified the current (non-deprecated) Drizzle `pgTable` extraConfig API by reading the
      installed type definitions before writing constraints — the array-return form, not the
      deprecated object-return form most existing examples online still show

**Persistence (repositories + transactional creation)**
- [x] `OrganizationRepository`, `MembershipRepository`, `BusinessProfileRepository`,
      `BusinessHoursRepository`, `ServiceRepository` interfaces + Postgres/Drizzle
      implementations (`src/repositories/drizzle/*`) + in-memory test doubles
      (`tests/support/in-memory-organization-repositories.ts`)
- [x] `UnitOfWork` abstraction (`src/repositories/unit-of-work.ts`) so organization creation is
      genuinely transactional against Postgres (`db.transaction()`) while still being testable
      without one (in-memory implementation runs the same callback directly)
- [x] Every service-lookup/update/delete repository method scoped by `organizationId` in the
      same query as the id — the concrete mechanism that makes cross-tenant service access
      impossible by construction, not just by convention

**Services + tenant isolation middleware**
- [x] `OrganizationService.createOrganization` — org + owner membership + initial business
      profile + default (all-closed) business hours, all in one transaction; an organization is
      never created without its owner membership by construction
- [x] `BusinessProfileService`, `BusinessHoursService` (always returns exactly 7 entries,
      filling in "closed" for any missing day), `ServicesCatalogService`
- [x] `requireOrgMembership` middleware — the tenant-isolation enforcement point: reads
      `:organizationId` from the URL but never trusts it, independently re-queries the database
      for a real membership row on every request, returns 404 (not 403) for non-members

**API**
- [x] `POST/GET /organizations`, `GET/PATCH /organizations/:organizationId`,
      `GET/PUT .../business-profile`, `GET/PUT .../business-hours`,
      `GET/POST .../services`, `PATCH/DELETE .../services/:serviceId` — all behind `requireAuth`,
      all but creation/listing additionally behind `requireOrgMembership`
- [x] `zod` validation for every input (`src/validation/organization.schemas.ts`), including a
      refinement rejecting business-hours payloads that don't cover all 7 days exactly once
- [x] Fixed two real `exactOptionalPropertyTypes` compiler errors properly (widened the
      `Update` interfaces to match zod's actual inferred shape, per TypeScript's own suggested
      fix) rather than suppressing them

**Frontend**
- [x] `/dashboard` rewritten: shows `CreateOrganizationForm` if the user has no organization,
      otherwise real `BusinessProfileForm`, `BusinessHoursForm`, `ServicesManager` — all real API
      calls with `credentials: 'include'`, loading/saving/saved/error states, no mocked data
- [x] No multi-organization switcher UI built (documented decision — see ARCHITECTURE.md §10);
      the backend fully supports multiple memberships regardless

**Tenant isolation tests (the core of M3) — `apps/api/tests/organizations.test.ts`**
- [x] All 12 scenarios from the M3 brief, each a real HTTP request through the full middleware
      stack: unauthenticated rejected; owner can access own org; a plain `member` (not owner) can
      access their org; non-member rejected (404); changing the org id in a request cannot
      bypass authorization (verified target data unchanged afterward); non-member cannot
      read/write another org's business profile (verified unchanged); non-member cannot
      list/modify/delete another org's service (verified unchanged); duplicate memberships
      rejected; organization creation produces exactly one correct owner membership (not "at
      least one" — counted); a spoofed `organizationId` in a request body cannot orphan a record
      into another organization (verified via direct repository lookup, not just the response)
- [x] Additional CRUD happy-path coverage: business profile get/update, business hours
      get/replace (+ rejecting a payload missing a day), services create/update/delete, org
      listing scoped to the caller's own memberships only
- [x] 21 new tests, 34 total in `apps/api` (13 from M2 unchanged and still passing)

**Documentation**
- [x] ARCHITECTURE.md §6 (Multi-tenancy) rewritten from "design intent" to "implemented", with an
      explicit note refining the original M1/M2 wording ("never from a client-supplied field") to
      the more precise property that actually matters: independent re-authorization on every
      request, regardless of where the id appears
- [x] ARCHITECTURE.md §10 (Organizations) added; §2, §3, §7 updated where M3 changed them
- [x] SECURITY.md §1 rewritten with per-bullet implementation status; new §3 "Tenant isolation
      testing" documents all 12+ scenarios; §7 known gaps updated (RLS not implemented, no RBAC
      beyond membership, Postgres-specific behavior — constraints, cascades, transaction
      rollback — unverified)
- [x] README.md, IMPLEMENTATION_PLAN.md updated; corrected a stale IMPLEMENTATION_PLAN.md claim
      that M3 would implement Postgres RLS (it doesn't — only the application-layer half)

**Verification actually run**
- [x] `npm run typecheck -w apps/api` / `-w apps/web` — clean, after fixing real compiler errors
      (not warnings) at each phase before moving on, not accumulated and fixed at the end
- [x] `npm run lint -w apps/api` / `-w apps/web` — clean
- [x] `npm run test -w apps/api` — 34/34 passing
- [x] `npm run build -w apps/web` (`next build`) — succeeded; `/dashboard` correctly dynamic,
      `/login`/`/register`/`/` correctly static
- [x] Root aggregate `npm run lint`/`typecheck`/`test`/`build` — full-repo regression, all green
- [x] `services/voice-agent` Python checks re-run (ruff/mypy/pytest) — unaffected, still passing
- [x] `git diff`/`git status` inspected; secret scan run over the diff

## Remaining M3 work

None identified as blocking M3's stated scope. Explicitly out of scope by the brief itself, not
an oversight:

- [ ] Fine-grained RBAC beyond `owner`/`member` — explicitly excluded by the M3 brief; the `role`
      column exists for a future milestone to use.
- [ ] Multi-organization switcher UI — the data model and API fully support a user belonging to
      multiple organizations; only the M3 frontend simplification (always show the first one) is
      missing a switcher, by design (see ARCHITECTURE.md §10).
- [ ] Applying `0001_curly_forge.sql` to a real Postgres instance — blocked on Docker being
      unavailable in this environment, not on missing code.
- [ ] Postgres Row-Level Security — documented as a defense-in-depth layer under the
      application-layer scoping that's already implemented and tested; not built in M3.

## Known limitations (M3 additions)

- **Postgres-specific behavior remains unverified**: the real unique constraints (`slug`,
  `(organization_id, user_id)`, `(organization_id, day_of_week)`), real foreign-key cascade
  deletes, and real transaction rollback for organization creation are all implemented in the
  schema/code but only exercised against in-memory test doubles, not actual Postgres. The
  in-memory `UnitOfWork` in particular does **not** roll back partial writes on failure the way
  the real `db.transaction()` does — a genuine behavioral gap between the test double and
  production code, documented rather than glossed over.
- **No RLS** — see SECURITY.md §7.
- **No RBAC beyond membership** — any member can read/write the full organization configuration;
  the `role` column is a deliberate placeholder for a future milestone, not wired to any
  authorization check yet.
- **Slug collision handling has a theoretical race condition** under true concurrent creation of
  same-name organizations — the database's unique constraint is the real backstop, but a race
  would currently surface as a 500 rather than a graceful retry. Acceptable at current scale.
- **CSRF**: `SameSite=Lax` remains the only mitigation, now covering real mutating endpoints
  (profile/hours/services writes) beyond just auth — see SECURITY.md §2/§7.
- **No rate limiting** on organization creation — a user could create many organizations in quick
  succession. Not currently a concern at this scale; would matter if abuse potential increases
  (e.g. once billing exists and organization count has cost implications).

## Completed — M4 Business knowledge and AI receptionist configuration

**Planning**
- [x] Full read-only inspection of M1–M3 code/schema/repositories/services/routes/frontend/tests
      before any code was written — plan mode used explicitly, per the M4 brief's own instruction
      not to redesign working architecture without a concrete reason
- [x] Written plan produced covering schema, endpoints, frontend, authorization, the future
      voice-agent contract, migration/testing strategy, exact file list, explicit scope
      boundaries, and 4 flagged architectural decisions — reviewed and approved with adjustments
      before implementation began

**Data model**
- [x] `knowledge_entries` (title, content, category `faq|policy|service_info|custom`, active,
      timestamps, organization_id) — a single flat table, no document/chunk split, no embeddings
      column; designed so a future RAG milestone adds chunking/embeddings as a new additive table
      referencing this one's stable id, not a redesign of it
- [x] `receptionist_configurations` (one per org, `organization_id` itself unique) — fully
      provider-agnostic (no model/voice/API-key columns anywhere). Per the approved adjustment,
      every field with a sensible deterministic default is `NOT NULL` with that default rather
      than nullable; `callTransferPhone` is the sole exception (no reasonable default exists)
- [x] Migration generated (`0002_next_lester.sql`) and inspected directly — confirmed all
      `NOT NULL` defaults, including string values containing apostrophes, are correctly
      SQL-escaped in the generated statement

**Persistence**
- [x] `KnowledgeRepository`, `ReceptionistConfigRepository` interfaces + Drizzle/Postgres
      implementations + in-memory test doubles, following the exact `(id, organizationId)`
      dual-scoping pattern already established for `ServiceRepository`
- [x] `OrganizationCreationRepos`/`UnitOfWork` extended to also seed a default, disabled
      receptionist configuration inside the same transaction as org + owner membership + business
      profile + business hours — `enabled: false` is forced in two independent places (the DB
      column default, and `ReceptionistConfigRepository.create()` overriding whatever it's passed)
      so organization creation can never activate a receptionist

**API**
- [x] `GET/POST /organizations/:organizationId/knowledge`,
      `PATCH/DELETE /organizations/:organizationId/knowledge/:knowledgeId`,
      `GET/PUT /organizations/:organizationId/receptionist-config` — added to the existing
      `organizations.routes.ts` (not new route files), behind the same `requireAuth` +
      `requireOrgMembership` middleware chain as every M3 endpoint, no new middleware needed
- [x] Simple case-insensitive substring search (`?q=`) on knowledge title+content via Postgres
      `ilike`/`or`, with an equivalent in-memory implementation — explicitly not full-text search,
      not embeddings, not a vector database, per the approved adjustment
- [x] Two more `exactOptionalPropertyTypes` compiler errors found and fixed properly (widening
      `KnowledgeListFilter`/`NewKnowledgeEntry` to match zod's inferred shape, the same
      TypeScript-suggested fix used in M2/M3) — not suppressed

**Frontend**
- [x] `KnowledgeManager` (list/create/edit-active/delete, category filter, text search) and
      `ReceptionistConfigForm` (all fields including the `enabled` toggle, with an explicit note
      that saving does not make the receptionist live) — both real API calls with
      loading/saving/saved/error states, no mocked data, modeled directly on M3's
      `ServicesManager`/`BusinessProfileForm`
- [x] `apps/web/src/lib/organizations.ts` extended (not a new file) with the two new types and
      fetchers, matching the established single-file convention
- [x] Dashboard page extended to fetch and render both new sections alongside M3's three

**Tenant isolation tests — the most safety-critical part of this milestone**
- [x] `apps/api/tests/knowledge.test.ts` (13 tests) and `receptionist-config.test.ts` (7 tests):
      unauthenticated rejected; non-member cannot list/read/modify/delete another org's knowledge
      or read/modify another org's receptionist config (all 404, all verified unchanged via direct
      repository checks afterward — including a specific attempt to flip a victim org's `enabled`
      to `true`, rejected exactly like any other cross-tenant write); changing the organization id
      in the request path cannot bypass authorization; a spoofed `organizationId` in a knowledge
      POST body cannot orphan the entry into another organization; organization creation seeds
      exactly one receptionist config, always disabled, with the documented deterministic
      defaults; the config API response contains no vendor/provider-shaped keys
- [x] `organizations.test.ts`'s existing org-creation test extended (not duplicated) to also
      assert the seeded receptionist config, via both the HTTP response and a direct repository
      read
- [x] `registerAgent`/`createOrg` test helpers extracted from `organizations.test.ts` into a new
      shared `tests/support/http-helpers.ts` rather than duplicated a third time — a minor,
      non-behavioral refactor applied because three near-identical copies would have been the
      actual monolithic-file problem the project's own conventions warn against
- [x] **A real bug was caught, not glossed over**: `build-test-app.ts` initially built the
      in-memory `knowledge`/`receptionistConfigs` repositories but never constructed services from
      them or passed those services into `createApp()`'s deps — so `createApp()` silently fell
      back to its Postgres-backed defaults for those two resources. All 13 new tests failed with
      real `DrizzleQueryError`/`password authentication failed` errors against a local, unrelated
      Postgres instance that happens to be listening on `localhost:5432` in this environment (not
      this project's Docker setup, not used for anything). Fixed by explicitly constructing and
      injecting `knowledgeService`/`receptionistConfigService`, with a comment added warning that
      any future resource type must be wired the same way or it silently escapes the test double.
- [x] 54/54 total tests passing (34 from M2/M3 unchanged + 13 knowledge + 7 receptionist-config)

**Documentation**
- [x] ARCHITECTURE.md §11 (Knowledge and Receptionist Configuration) added; §§2, 3, 6, 7 updated;
      the stale "M2 — Authentication" status header (missed in the M3 doc pass) corrected to M4
- [x] SECURITY.md §1, §3 (new M4 tenant-isolation scenarios), §5, §6, §7 updated — including the
      inter-service-auth deferral and knowledge-search-stays-simple decisions as explicit known
      gaps, not left implicit
- [x] README.md, IMPLEMENTATION_PLAN.md updated; M1–M3 content left alone

**Verification actually run**
- [x] `npm run typecheck -w apps/api` / `-w apps/web` — clean at every phase, not accumulated
- [x] `npm run lint -w apps/api` / `-w apps/web` — clean
- [x] `npm run test -w apps/api` — 54/54 passing (after finding and fixing the wiring bug above)
- [x] `npm run build -w apps/web` (`next build`) — succeeded
- [x] Root aggregate `npm run lint`/`typecheck`/`test`/`build` — full-repo regression, all green
- [x] `services/voice-agent` Python checks re-run — unaffected, still passing
- [x] `git diff`/`git status` inspected; secret scan run over the diff

## Remaining M4 work

None identified as blocking M4's stated scope. Explicitly out of scope by the brief itself:

- [x] ~~Service-to-service authentication for the future voice agent to call the contract
      endpoints non-interactively~~ — built in M5, see below.
- [ ] Full-text/vector search, embeddings, RAG — explicitly excluded; the schema is shaped so
      these can be added additively later (see ARCHITECTURE.md §11).
- [ ] Web crawling / website-derived knowledge ingestion — not implemented, not attempted.
- [ ] Applying `0002_next_lester.sql` to a real Postgres instance — blocked on Docker being
      unavailable in this environment, not on missing code.

## Known limitations (M4 additions)

- **Postgres-specific behavior remains unverified** for the two new tables, same caveat as M3's
  tables (constraints, cascades, transaction rollback only exercised via in-memory doubles).
- **No inter-service authentication mechanism** — the voice-agent contract endpoints currently
  require a real user session; there is no way for a backend service to call them yet. See
  SECURITY.md §7.
- **No RBAC beyond membership** — unchanged from M3, now also covering knowledge and receptionist
  configuration.
- **Knowledge search is substring-only** — no full-text index, no relevance ranking.
- **Receptionist configuration has no audit trail** — updates overwrite in place; no history of
  who changed what when. Not required by the M4 brief; worth considering once multiple members
  can edit the same organization's configuration.

## Completed — M5 Voice/AI Runtime Foundation

**Planning**
- [x] Full read-only inspection of M1–M4 code/schema/repositories/services/routes/CI/dependency
      constraints, plus web research into Pipecat's current package/APIs, before any code was
      written — plan mode used explicitly
- [x] Written plan produced and independently cross-checked by a second review pass covering
      service-to-service auth design, internal API shape, Pipecat integration boundary, provider
      abstraction, tool scope, and testing strategy — reviewed and approved with corrections
      (secret naming, `timingSafeEqual` framing, shared response type) before implementation began

**Service-to-service authentication**
- [x] `INTERNAL_SERVICE_KEY` — static, 32+ byte, manually-generated bearer token, required at
      startup (`assertServiceAuthSecret()` in `config/env.ts`, called from `server.ts` next to
      `assertAuthSecret()`), no code-level default
- [x] `middleware/require-service-auth.ts` — `Authorization: Bearer` extraction, length-guarded
      `crypto.timingSafeEqual` comparison (first use of this primitive in the codebase)
- [x] `createApp()` extended with an optional injected `internalServiceKey`; falls back to
      `env.internalServiceKey`, then to a random per-boot value (never throws) so callers that
      don't touch `/internal/v1` — including the pre-existing M1 health test — aren't forced to
      configure it; real production startup still fails closed via `server.ts`

**Internal voice API**
- [x] `GET /internal/v1/organizations/:organizationId/runtime-context` (aggregates receptionist
      config + business profile + business hours + services in one round trip) and
      `GET /internal/v1/organizations/:organizationId/knowledge` (same filter semantics as the
      public endpoint) — `routes/internal.routes.ts` + `controllers/internal.controller.ts`,
      reusing the exact M2–M4 services, no new repository logic
- [x] `RuntimeContext` response shape defined once in `packages/shared/src/voice-runtime.ts` (the
      canonical wire type), mirrored by hand-written pydantic models on the Python side since
      Python can't import a TS package
- [x] `/v1` versioning — the first versioned prefix in this project, justified because this is now
      a contract between two independently-deployable services

**Pipecat integration**
- [x] `pipecat-ai>=1.8.1,<1.9.0` added via `uv add "pipecat-ai[cartesia,deepgram,openai]"` — pinned
      narrow (its `LLMContext`/`FunctionCallParams` model already replaced an older OpenAI-specific
      context class in a prior release, confirmed via the installed package's own source, so an
      open range would be unsafe); `ruff`/`mypy --strict`/`pytest` re-verified clean immediately
      after installing, before any code was built on top of it
- [x] `pipeline.py` — transport-agnostic pipeline construction (`build_pipeline()` takes any
      Pipecat `BaseTransport`); zero telephony-specific code anywhere in it or in its imports
- [x] `bot.py` — manual, non-CI, local-only entry point using Pipecat's own official development
      runner (`pipecat.runner.run` + `create_transport()`'s factory-dict pattern) and
      `SmallWebRTCTransport`, not hand-rolled WebRTC signaling; documented as a developer workflow

**Provider abstraction**
- [x] No custom STT/LLM/TTS interface — `providers/factory.py` maps `STT_PROVIDER`/`LLM_PROVIDER`/
      `TTS_PROVIDER` env vars to Pipecat's own `DeepgramSTTService`/`OpenAILLMService`/
      `CartesiaTTSService` (imported lazily) or to a fake; unrecognized provider or missing API key
      raises a clear `ProviderConfigurationError`, never a silent fallback
- [x] `providers/fakes.py` — `FakeSTTService`/`FakeTTSService`/`FakeLLMService` genuinely subclass
      Pipecat's real `STTService`/`TTSService`/`LLMService` base classes (not a hand-rolled
      substitute); `FakeLLMService` was found during implementation to need a `process_frame`
      override (not just `_process_context`) — `LLMService`'s own base `process_frame` does not
      trigger inference on `LLMContextFrame` on its own, only concrete providers (mirroring
      `BaseOpenAILLMService`) do, confirmed by reading the installed package's source directly
      rather than assumed
- [x] `"fake"` is the default for every role — the service boots and all tests pass with zero
      provider credentials configured

**Tools**
- [x] Exactly one dynamic, read-only tool: `search_knowledge(query, category?)`
      (`tools/search_knowledge.py`), its handler embedded on a `FunctionSchema` (Pipecat
      auto-registers embedded handlers, no separate `register_function` call needed); never
      raises — API failures are delivered as a structured `{"error": ...}` result
- [x] Business profile/hours/services/receptionist config are prefetched into the system prompt
      (`runtime/context.py`) rather than exposed as tools — deliberately minimal, with
      hours/services-as-tools noted as an easy, deferred future addition, not built speculatively

**Tests**
- [x] `apps/api/tests/internal-api.test.ts` (15 new tests) covering:
      valid credential + org A; valid credential + a *different* real org B (succeeds, but each
      response verified to contain only that org's own data); missing organization-id path
      segment (404); nonexistent organization (404, both endpoints); disabled receptionist
      (200 with `enabled: false` — gating is the voice-agent's job); invalid/missing/wrong-scheme/
      wrong-length service credential (401 in every case, including a dedicated wrong-length test
      proving the `timingSafeEqual` length guard, not a crash); cross-auth isolation (a valid
      service token does not authorize `/organizations/...`, a valid session cookie does not
      authorize `/internal/v1/...`)
- [x] Python (`pytest` + `pytest-asyncio`, `respx`/`httpx.MockTransport`, zero network, zero real
      credentials): `test_providers.py`, `test_api_client.py`, `test_search_knowledge_tool.py`,
      `test_build_pipeline.py`, and `test_pipeline.py` — the last one uses Pipecat's own
      `pipecat.tests.utils.run_test` helper to run `FakeLLMService` for real and empirically prove
      the `search_knowledge` tool executes through Pipecat's actual function-calling machinery
      (asserted via the mocked internal API genuinely receiving the request, not just a frame
      appearing) — 24 Python tests, all passing
- [x] Full M1–M4 regression unaffected — 69 total Node tests (54 from M1–M4 unchanged + 15 new
      internal-API tests)

**Documentation**
- [x] ARCHITECTURE.md §12 (Voice/AI Runtime Foundation) added — internal API, service auth,
      tenant scoping, Pipecat integration, provider abstraction, tools, testing; §§1, 3, 5, 6, 8,
      11 updated where M5 changed them
- [x] SECURITY.md §8 (Service-to-service authentication) added with full credential
      format/storage/validation/scoping/revocation/unauthorized-behavior detail; §§1, 3, 4, 5, 6, 7
      updated; the M4 "no service-to-service auth" gap marked resolved with a pointer to §8
- [x] `.env.example` — `INTERNAL_SERVICE_KEY` added to both the `apps/api` and
      `services/voice-agent` sections; stale milestone labels on the Twilio ("M5, M9" → "M6") and
      LLM/STT/TTS ("M4" → "M5") placeholder variables corrected while touching this file
- [x] README.md, IMPLEMENTATION_PLAN.md updated; M1–M4 content left alone

**Verification actually run**
- [x] `services/voice-agent`: `uv run ruff check .`, `uv run ruff format --check .`,
      `uv run mypy src` (0 issues across all new modules), `uv run pytest` — all clean
- [x] `npm run typecheck -w apps/api`, `npm run lint -w apps/api`, `npm run test -w apps/api` —
      clean at every phase
- [x] Root aggregate `npm run lint`/`typecheck`/`test`/`build` and Python checks re-run together
- [x] `git diff`/`git status` inspected; secret scan run over the diff; verified
      `INTERNAL_SERVICE_KEY` never appears in any log output or HTTP response body

## Remaining M5 work

None identified as blocking M5's stated scope. Explicitly out of scope by the brief itself:

- [ ] Twilio, phone numbers, PSTN, inbound/outbound calling, SIP — M7.
- [ ] Real, always-on provider calls as part of CI/automated verification — M5's definition of
      done is the abstraction plus optional lazy real-provider wiring, verified via fakes; a live
      paid smoke test against real OpenAI/Deepgram/Cartesia is a manual/local step only.
- [ ] Credential rotation/reissue tooling for either service credential (the global
      `INTERNAL_SERVICE_KEY` or a per-organization `X-Organization-Service-Token`) — both are
      manual-only in M5; deferred until a real rotation requirement exists.
- [ ] Rate limiting on `/internal/v1/...` — same pre-existing gap as `/auth/*`, tracked for M14.
- [ ] Hours/services as separate function-calling tools — deliberately deferred, easy to add later.

## Known limitations (M5 additions)

- **Two independent service credentials, not one** — `INTERNAL_SERVICE_KEY` (global, proves a
  trusted internal service) and a per-organization `X-Organization-Service-Token` (proves
  authorization for that specific organization; a token for organization A is rejected 403 for
  organization B) — see SECURITY.md §8 for the full model.
- **No automated credential rotation for either credential** — the global key needs a manual,
  coordinated dual-restart; a leaked organization token has no reissue endpoint at all in M5.
- **Pipecat/real-provider wiring is unexercised in CI** — all automated tests run against fakes;
  real OpenAI/Deepgram/Cartesia calls have not been made or security-reviewed in this environment.
- **Session/runtime state is entirely in-process and ephemeral** — no session table, no
  call/transcript persistence (out of scope per the brief); a prompt built from
  `runtime-context` can go stale if the underlying config changes mid-call.
- **No telephony transport of any kind** — `SmallWebRTCTransport` (manual/local only) is the only
  transport ever instantiated; Twilio/Telnyx/Plivo arrive in M7.

## Completed — M6 Real AI Voice Runtime

**Provider hardening**
- [x] `DEEPGRAM_MODEL` (default `nova-3-general`, Deepgram's own SDK default) and `OPENAI_MODEL`
      (default `gpt-4.1`, `OpenAILLMService`'s own documented default) — both configurable,
      confirmed against the installed `pipecat-ai==1.8.1` source before being wired in
- [x] `CARTESIA_VOICE_ID` changed from optional to required (`_require_env`) — no default voice id
      exists (voice ids are per-account); a missing value now fails closed with a clear
      `ProviderConfigurationError` at construction time

**Turn-taking / VAD**
- [x] `VADProcessor(vad_analyzer=SileroVADAnalyzer())` added to `pipeline.py`'s `Pipeline([...])`,
      right after `transport.input()` — VAD is a pipeline processor stage in the installed Pipecat
      version, not a transport parameter; local ONNX model, no network call, no provider
      credentials. `onnxruntime`/`numba` (Silero's dependencies) are already part of the base
      `pipecat-ai` dependency tree — confirmed via `uv tree`; `pyproject.toml`/`uv.lock` are
      unchanged from M5, no new dependency was added

**Session lifecycle (`session.py`, new)**
- [x] Orchestration extracted from `bot.py`: fetch `RuntimeContext` → build real/fake providers →
      `build_pipeline()` → run via `PipelineWorker`/`WorkerRunner` → guaranteed cleanup
- [x] Idle timeout: `PipelineWorker(idle_timeout_secs=<VOICE_AGENT_IDLE_TIMEOUT_SECS, default 45>,
      idle_timeout_frames=(UserSpeakingFrame,), cancel_on_idle_timeout=False)` — narrowed to actual
      caller speech only, distinct from any overall session-duration cap (not built). On
      `on_idle_timeout`: speaks the existing `receptionistConfig.fallbackMessage` once, then ends
      gracefully — no new receptionist-config field, no `apps/api` change. The handler itself has
      no retry logic; Pipecat's own idle-monitor loop re-arms on a fixed interval independently of
      `session.py` (read directly from `pipeline/worker.py`'s `_idle_monitor_handler`), which is
      not separately exercised by the fakes-only test suite — see "Known limitations" below
- [x] Provider/pipeline failure: `processor_unusable_policy=ProcessorUnusablePolicy.END` —
      `_on_pipeline_error` logs only safe structural metadata (processor class name, exception
      class name, error category) and never calls `end`/`cancel` itself; termination is Pipecat's
      own responsibility
- [x] Client disconnect: `transport.add_event_handler("on_client_disconnected", ...)` cancels
      (never ends); safe to register unconditionally on any `BaseTransport` since an unregistered
      event name is a no-op, not a crash
- [x] Cleanup relies entirely on `async with api_client:` (no separate `_cleanup()` method) —
      verified by tests wrapping the real `ApiClient.close` and asserting it runs exactly once on
      every path (fail-fast before a pipeline exists, and after a full session)
- [x] Tenant binding unchanged and re-verified: `organization_id` is resolved once at the top of
      `run_session()` and never re-derived from conversation/tool-call content — a dedicated test
      proves a spoofed `organizationId`/`organization_id` in tool arguments cannot redirect
      `search_knowledge` to a different organization; a second dedicated test runs two full
      sessions for two different organizations (genuinely distinct mocked data — different id,
      business name, fallback message, service token) and proves neither session's runtime
      context/fallback ever leaks into the other
- [x] Idle-timeout idempotency guard: a second `on_idle_timeout` firing (Pipecat's monitor loop
      re-arms on a fixed interval regardless of whether the first `end()` call finished) is now a
      safe no-op — no second fallback message, no second `end()` call — verified by a dedicated
      test; this closes the gap previously listed under "Known limitations" below
- [x] Session start now logs which business the session is running for (the organization's own
      configured business name — public-facing content, not caller data; added to
      `logging_config.py`'s documented safe-to-log list explicitly, not left implicit)
- [x] `bot.py` now fails closed on a missing `INTERNAL_SERVICE_KEY` at startup, matching the
      existing pattern for the two `DEV_SESSION_*` variables, instead of only surfacing as a
      logged error deep inside `session.py`

**Logging (`logging_config.py`, new)**
- [x] One centralized stdlib `logging.Logger` factory; a documented never-log list (API keys,
      service tokens, `Authorization`/`X-Organization-Service-Token` header values,
      conversation/transcript content, tool arguments/results, raw request/response bodies, raw
      exception text) enforced by discipline at the single call site (`session.py`), not by
      automatic scanning
- [x] No logging call site existed anywhere in `services/voice-agent/src` before this milestone —
      a clean slate, no drift to fix

**Tests**
- [x] `tests/test_session.py` (new, 8 tests): missing organization token, runtime-context fetch
      failure, provider-configuration failure (each closes `ApiClient` exactly once and never
      builds a pipeline); normal session builds `PipelineWorker` with the correct idle-timeout/
      unusable-policy configuration; idle timeout speaks the fallback exactly once and ends without
      looping; pipeline-error handler relies on the `END` policy without terminating itself or
      looping on a second error; pipeline-error handler never logs raw error/exception text (a
      planted secret string asserted absent from captured logs); client disconnect cancels rather
      than ends. `PipelineWorker`/`WorkerRunner` are replaced with small recording stand-ins so
      these run in milliseconds and verify this service's own wiring, not Pipecat's own
      frame-draining/idle-monitor timing
- [x] `tests/test_config.py` (new, 9 tests): `VOICE_AGENT_IDLE_TIMEOUT_SECS` default/override/
      malformed/non-positive validation; `DEEPGRAM_MODEL`/`OPENAI_MODEL` default/override
- [x] `tests/test_providers.py` extended (+6 tests): Deepgram/OpenAI construct correctly with and
      without an explicit model; Cartesia fails closed without `CARTESIA_VOICE_ID` even with a
      valid API key, and constructs correctly with both
- [x] `tests/test_build_pipeline.py` extended (+1 test): `VADProcessor` present in the built
      pipeline, positioned before the STT stage
- [x] `tests/test_search_knowledge_tool.py` extended (+2 tests): a spoofed `organizationId` *and*
      `organization_id` planted together in tool-call arguments never redirects the query away from
      the organization the schema was bound to; a query matching nothing returns an honest, empty
      `{"results": []}` rather than fabricated content
- [x] `tests/test_context.py` (new, 7 tests): the fixed guardrail text is present (concise/
      conversational, never invent facts, never claim an unavailable action, never expose internal
      details) and never names a specific business vertical, while every business-specific detail
      (name, tone, fallback/after-hours wording) still comes from the configured RuntimeContext
- [x] `tests/test_session.py` extended (+3 tests): idle timeout firing twice only speaks the
      fallback once (proves the new idempotency guard); two organizations' sessions never share
      runtime context or fallback message; a full normal session never logs either credential
      anywhere (broader than the single pre-existing handler-level check)
- [x] Full regression: 62 total Python tests passing (up from 26 before this milestone);
      `apps/api`'s suite unaffected (no changes there); `ruff check`/`ruff format --check`/
      `mypy --strict` clean throughout

**Documentation**
- [x] ARCHITECTURE.md §13 (Real AI Voice Runtime) added; §5, §12.4 updated where M6 changed them
- [x] SECURITY.md §9 (Voice runtime session lifecycle and failure handling) added; stale M12/M13
      self-references elsewhere in the file corrected to M13/M14 for the M6→M7 renumbering
- [x] `.env.example` — `DEEPGRAM_MODEL`, `OPENAI_MODEL`, `CARTESIA_VOICE_ID`,
      `VOICE_AGENT_IDLE_TIMEOUT_SECS` added; stale `Twilio phone/SMS (M6, M10)` label corrected to
      `(M7, M11)` following the M6→M7 renumbering
- [x] `IMPLEMENTATION_PLAN.md` — M6 renumbered to M7 (Twilio inbound calls) and M7–M14 shifted to
      M8–M15, following the file's own "Note on M4" precedent; new M6 section added
- [x] `DEPLOYMENT.md` — "M14" (Production deployment) references corrected to "M15"
- [x] `services/voice-agent/README.md`, root `README.md` updated; M1–M5 content left alone except
      where it names a shifted milestone number

## Remaining M6 work

- [ ] **Real-provider manual smoke test not yet performed in this environment** — no Deepgram/
      OpenAI/Cartesia credentials were available during implementation. Structural/unit
      verification is complete; an actual Deepgram → OpenAI → Cartesia conversation over
      `SmallWebRTCTransport`, including a real `search_knowledge` invocation and observed
      interruption/turn-taking behavior, remains the outstanding gate before this milestone can be
      called fully done. Do not treat M6 as real-provider-verified until this is run and confirmed.
- [ ] Twilio, phone numbers, PSTN, inbound/outbound calling, SIP — M7 (unchanged from M5's
      exclusion list, just renumbered).
- [ ] Overall session-maximum-duration cap — not requested; deliberately not confused with the
      idle/silence timeout that was built.
- [ ] Credential rotation/reissue tooling — unchanged, pre-existing gap from M5, not touched.

## Known limitations (M6 additions)

- **Real-provider behavior is unverified in this environment** — every automated test runs against
  fakes; Deepgram/OpenAI/Cartesia have not actually been called. See "Remaining M6 work" above.
- **No VAD tuning** — `SileroVADAnalyzer()`/`VADProcessor()` are constructed with library defaults;
  no environment-specific sensitivity/timing tuning has been done or verified against real audio.
- **`logging_config.py`'s never-log list is a reviewed convention, not an automatic filter** — a
  future log call added outside `session.py`'s existing pattern is not mechanically prevented from
  violating it.

## Completed -- M7 Twilio Inbound Calls

**Tenant-safe phone-number routing (apps/api)**
- [x] `organization_phone_numbers` table (`id` primary key, `organization_id` a plain indexed FK,
      `phone_number` unique) -- deliberately supports multiple numbers per organization from the
      first migration, not just one
- [x] Owner-gated `POST`/`GET`/`DELETE /organizations/:id/phone-numbers` -- E.164 validation,
      duplicate-number rejection (409, checked against any organization), cross-tenant isolation
      verified by tests
- [x] `GET /internal/v1/twilio/phone-numbers/:phoneNumber` (service-auth only -- no
      organization-scoped token exists yet at this point) resolves the dialed number and mints a
      short-lived, call-bound credential for it

**Call credential (`auth/call-credential.ts` + `twilio/call_credential.py`)**
- [x] HMAC-SHA256 over a base64url-encoded JSON payload (`organization_id`, `call_sid`, `exp`) --
      deliberately not a JWT (no `alg` field, no new dependency); a hand-rolled two-part token
      verified independently in both Node (mint + verify) and Python (verify-only), with an
      interoperability test proving a token minted by a from-scratch reimplementation of the
      Node algorithm verifies correctly in the Python implementation
- [x] 4-hour TTL, justified rather than arbitrary: `call_sid` binding (checked against Twilio's
      own real `CallSid` for the connection presenting the token) is the primary defense against
      replay across calls; the TTL is a generous backstop bound chosen far above any realistic
      call duration, so no real call risks losing authorization mid-conversation
      (`session.py`'s `ApiClient` sets its auth header once, at construction, with no
      mid-session re-authentication)
- [x] `exp` validated as a strict int, not merely `int | float` -- Python's `bool` is an `int`
      subclass, so both a float and a bool `exp` are explicitly rejected as malformed, even when
      correctly signed
- [x] Timing-safe comparison on both sides (`crypto.timingSafeEqual` / `hmac.compare_digest`)

**M5 boundary preserved, not extended**
- [x] `middleware/require-organization-service-token.ts` has a byte-for-byte empty diff --
      confirmed via `git diff` at every verification step throughout M7, not just asserted
- [x] A new, separate `middleware/require-organization-auth.ts` composes the call-credential
      check *in front of* the unmodified original middleware (tries the credential first; falls
      through to the exact same original function for anything that isn't a valid credential) --
      proven byte-identical to calling the original middleware directly, for five scenarios, in
      `tests/require-organization-auth.test.ts`

**Twilio webhook and Media Stream bridge (services/voice-agent)**
- [x] `POST /twilio/voice`: strict order enforced and tested -- signature validation (stdlib
      `hmac`/`hashlib`/`base64`, no `twilio` SDK dependency) against an explicitly
      operator-configured `VOICE_AGENT_PUBLIC_BASE_URL` (never derived from `X-Forwarded-*`
      headers) happens before any organization lookup; an invalid/missing signature 403s with
      zero calls to apps/api, verified by a mock-call-count assertion, not just the response code
- [x] Phone number not mapped, or apps/api unreachable -> a generic spoken failure message +
      hangup TwiML, `200`, never a raw error or `500` to the caller
- [x] `WS /twilio/media-stream`: the call credential is verified **locally** (pure HMAC, no
      network, no DB) before any Pipecat object (`TwilioFrameSerializer`,
      `FastAPIWebsocketTransport`) is constructed -- an unauthenticated connection costs at most
      one WS handshake, two small JSON reads, and one HMAC computation
- [x] **Tenant identity comes only from the verified credential** -- the WS handshake's own
      `organization_id` custom parameter is read only for an observability log line and never
      influences which organization the session runs for; proven by a dedicated adversarial test
      (`organization_id=org-B` in the metadata alongside a credential validly signed for org A ->
      `session.run_session()` is called with org A)
- [x] `session.run_session()` -- the M6 orchestrator -- is called completely unmodified; the
      credential string itself is passed through as the existing opaque
      `organization_service_token` parameter, exactly as `bot.py` already does with the dev token
- [x] `TwilioFrameSerializer` constructed with `auto_hang_up=False` explicitly -- relies on the
      documented `<Connect><Stream>` TwiML semantics (the call ends when the connected stream
      disconnects) rather than requiring `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` for an explicit
      REST hangup call; `auto_hang_up=True` is a documented, dependency-free fallback if the
      manual live-call test shows this doesn't reliably end the call

**Tests**
- [x] `tests/call-credential.test.ts` (13), `tests/require-organization-auth.test.ts` (14),
      `tests/twilio-phone-lookup.test.ts` (9), `tests/phone-numbers.test.ts` (19) -- apps/api,
      138 total tests passing (up from 83 pre-M7)
- [x] `tests/test_twilio_signature.py` (9), `tests/test_twilio_call_credential.py` (12),
      `tests/test_twilio_webhook.py` (9, `respx`-mocked HTTP, never monkeypatching the lookup
      function itself), `tests/test_twilio_media_stream.py` (10, `session.run_session`
      monkeypatched at the point `routes/twilio.py` imports it, matching `test_session.py`'s own
      established pattern; a realistic two-message Twilio handshake in every test, matching what
      `parse_telephony_websocket` actually expects) -- voice-agent, 108 total tests passing (up
      from 62 pre-M7)
- [x] `session.py`, `pipeline.py`, `runtime/context.py`, `providers/factory.py`,
      `tools/search_knowledge.py`, `logging_config.py` -- confirmed zero diff at every M7
      verification step, not just at the end

**Documentation**
- [x] ARCHITECTURE.md §14 (Twilio Inbound Calls) added; §5, §12.4, §13.3 corrected where M7
      changed or clarified them (including a stale M6-era assumption about *how* M7 would
      integrate with Pipecat's transport factory, which turned out not to match what was
      actually built)
- [x] SECURITY.md §10 (Twilio inbound call security) added; stale `M5` status label corrected to
      `M7`
- [x] `.env.example`, `IMPLEMENTATION_PLAN.md`, `services/voice-agent/README.md`, root
      `README.md`, `DEPLOYMENT.md` updated; M1-M6 content left alone except where it names M7 or
      a fact M7 changed

**Commit and CI**
- [x] Committed as `276db55` and pushed to `origin/main`. GitHub Actions CI for that exact
      commit passed: the Node job (lint, typecheck, test, build) and the voice-agent job
      (ruff, mypy, pytest) both succeeded. This confirms repository/build/test correctness
      only -- it does not validate real Twilio/PSTN behavior; see "Remaining M7 work" below.

## Remaining M7 work

- [ ] **Real live Twilio/PSTN call not yet performed in this environment** -- no real Twilio
      account was available during implementation. Structural/unit verification is complete
      (CI-safe, zero real Twilio credentials); an actual inbound call from a real phone, through
      real Twilio, into real Deepgram/OpenAI/Cartesia, remains the outstanding gate before this
      milestone can be called fully done -- including whether `auto_hang_up=False` actually ends
      the call reliably on a real connection. Do not treat M7 as live-call-verified until this is
      run and confirmed.
- [ ] SMS, outbound calling, call recording/transcription storage, CRM integration, lead capture,
      appointment booking, payments, call analytics -- all explicitly out of scope for M7, per
      the approved M7 plan; unchanged from M5/M6's own exclusion lists where applicable.
- [ ] No `apps/web` UI for phone-number provisioning -- settable via the authenticated API today;
      a dashboard page is a natural, separately scoped follow-up.

## Known limitations (M7 additions)

- **Real Twilio/PSTN behavior is unverified in this environment** -- every automated test runs
  against fakes/mocks; no real Twilio webhook, signature, or Media Stream connection has actually
  been exercised. See "Remaining M7 work" above.
- **No nonce/single-use replay tracking for call credentials** -- bounded by the 4-hour TTL and
  `call_sid` binding instead (see the "Call credential" section above); a credential leaked
  during its narrow validity window could in principle be replayed against the same call, an
  accepted, documented trade-off rather than an oversight.
- **No connection-rate limiting or concurrent-connection cap on `/twilio/media-stream`** -- the
  credential-before-any-expensive-work ordering bounds the *cost* of an unauthenticated
  connection attempt, but nothing caps how many such attempts can happen concurrently; left to a
  future, infra-aware milestone (a reverse proxy/load balancer in front of a real deployment is
  the natural place for this, not application code here).
- **`auto_hang_up=False` is unverified against a real call** -- relies on documented
  `<Connect><Stream>` TwiML semantics that have not been confirmed against real Twilio traffic;
  `auto_hang_up=True` is the documented fallback if the manual live-call test shows otherwise.

## Completed -- M8 Steps 1-11 (Knowledge Chunking, Embedding, and Semantic Search)

**Step 1: Data model (`knowledge_chunks`)**
- [x] `knowledge_chunks` table -- new, additive table referencing `knowledge_entries.id`, per
      ARCHITECTURE.md §11's own reserved extension point; `organization_id` denormalized for
      one-predicate tenant scoping; `embedding` a plain Postgres `real[]` column (no pgvector);
      nullable to support graceful degradation before/without embedding generation

**Step 2: Chunking (`services/knowledge-chunking.ts`)**
- [x] `chunkKnowledgeContent()` -- pure, paragraph-first with sentence-boundary and hard-split
      fallbacks, `DEFAULT_MAX_CHUNK_LENGTH = 800`, positive-integer validation on `maxChunkLength`

**Step 3: Embedding provider (`services/embedding-provider.ts`)**
- [x] `createEmbeddingProvider()` -- "fake" (deterministic, no network) default; "openai" real
      provider via direct REST (no SDK); `EMBEDDING_DIMENSIONS = 1536`; `fetch`/response-parsing
      failures wrapped in `EmbeddingProviderError`; `EmbeddingConfigurationError` reserved for
      setup-time misconfiguration only

**Step 4: Ingestion wiring (`knowledge.service.ts`, `knowledge-chunk.repository.ts`)**
- [x] Knowledge-entry create/update chunk + batch-embed automatically; metadata-only updates skip
      re-embedding; delete cleans up chunks explicitly; `EmbeddingProviderError` degrades
      gracefully (chunks persisted with `embedding: null`, logged safely); tenant ownership
      verified inside the same transaction as the write (no composite FK exists to rely on)

**Step 5: Semantic search (`services/knowledge-search.ts`)**
- [x] `searchKnowledge()` -- ranks by cosine similarity for entries with usable embeddings,
      substring fallback otherwise, capped at `DEFAULT_KNOWLEDGE_SEARCH_LIMIT = 5`; used only by
      the internal voice-agent-facing endpoint (`internal.controller.ts`), same route/auth/
      response shape; dashboard's `listKnowledge` unchanged

**Step 6: Voice-agent review**
- [x] Reviewed `services/voice-agent` for any change M8 might require -- none found;
      `search_knowledge` already calls the same internal `listKnowledge` endpoint whose
      server-side ranking behavior changed underneath it. No voice-agent source file touched.

**Step 7: Regression**
- [x] Full existing test suites re-run: `services/voice-agent` 108/108 passed; `apps/api` reached
      a clean 206/206 (14/14 files) on a third run, after two earlier runs each hit one
      intermittent Windows/Vitest worker crash (exit code `0xC0000005`, a different test file each
      time, otherwise-identical pass counts) -- recorded as an unexplained environmental/
      test-runner flake, not a code defect; no code changed in response to it.

**Step 8: Secret/logging scan**
- [x] Five read-only checks across the M8 diff (embedding-provider error paths, ingestion-wiring
      log calls, search-path log calls, `.env.example` coverage, and a repo-wide grep for the
      OpenAI key/embedding vectors in log statements) found nothing unsafe logged; found
      `EMBEDDING_PROVIDER`/`OPENAI_EMBEDDING_MODEL` undocumented in `.env.example` -- recorded as
      a Step 9 documentation item, not a security issue (both already default safely to `fake`/
      unset behavior when omitted).

**Step 10: Pre-commit audit**
- [x] Full read-only pre-commit audit across seven areas -- git working-tree scope, M8
      implementation-vs-documentation consistency, tests/typecheck/lint/CI status,
      migration/schema consistency, tenant-isolation/security-sensitive paths, embedding-provider
      configuration/secrets, and dependency/unintended-file checks -- plus a final synthesis; all
      passed with one recorded finding (below), no code change required.
- **Pre-existing M6 gap, not an M8 regression.** `mypy --strict` on `services/voice-agent` reports
      one error: `tests/test_session.py:46: error: Need type annotation for "RUNTIME_CONTEXT_JSON"
      [var-annotated]`. Confirmed facts (git history): `test_session.py`'s entire commit history
      is exactly one commit, `65247bb` ("feat: add real AI voice runtime and session lifecycle
      handling (M6)"); `git blame` attributes line 46 to that same commit; and none of M8's own
      commits (`5a837ef`, `c49dda2`, `897c1d4`) touch this file -- so the unannotated code itself
      predates M8. Not independently verified: whether `mypy --strict` actually raised this error
      back when `65247bb` was committed (would require checking out that historical commit, which
      was not done). Recorded as a pre-existing M6 code pattern discovered during the M8 Step 10
      audit; not fixed as part of M8 Step 10 -- out of scope for this milestone.

**Step 11: Manual review of real OpenAI embedding quality**
- [x] Real `EMBEDDING_PROVIDER=openai` smoke test against a small, synthetic SMB knowledge set (6
      entries covering hours, cancellation policy, pricing, walk-in policy, plus two unrelated
      entries) and 4 paraphrased queries, using the real `createEmbeddingProvider`/
      `rankKnowledgeEntries`/`cosineSimilarity` production code unmodified, via exactly 2 batched
      `embed()` calls (all entry chunks in one request, all queries in the other) -- not committed
      to the repository, run from a local, out-of-band script only. Results: both batched requests
      succeeded; every returned vector was exactly `EMBEDDING_DIMENSIONS = 1536`; all 4/4 queries
      ranked their semantically-matching entry first despite paraphrasing (no keyword overlap); the
      two unrelated entries never ranked first for any query; the `DEFAULT_KNOWLEDGE_SEARCH_LIMIT =
      5` cap held against 6 real candidates. Substring-fallback and provider-error-handling paths
      were not re-exercised by this run -- those remain covered only by the existing fake-provider
      unit tests, unaffected by this review.

Commits `5a837ef` (Steps 1-4), `c49dda2` (Step 5), and `e91a66e` (Step 9 documentation + Step 10
audit-finding note), all pushed to `origin/main`, CI verified green (`c49dda2`: run
[34029628175](https://github.com/Krithikezhil/ai-receptionist/actions/runs/34029628175); `e91a66e`:
run [34037969636](https://github.com/Krithikezhil/ai-receptionist/actions/runs/34037969636)). Steps
6-8, 10, and 11 involved no source changes and no new commits. All 11 established M8 steps are now
complete.

## M9 -- Lead capture (in progress)

**Step 4 verification note (test-runner flake, not a code defect)**
- The first `npm run test -w apps/api` verification run after M9 Step 4 (service layer) hit the
      same Windows/Vitest worker-process crash already documented in M8 Step 7:
      `STATUS_ACCESS_VIOLATION`, exit code `3221226505` / `0xC0000005`, while running
      `apps/api/tests/internal-api.test.ts`. 13/14 test files and 205/206 tests had already passed
      before the worker error. A single authorized diagnostic rerun immediately afterward completed
      cleanly: 14/14 test files passed, 206/206 tests passed, no worker error. No source or
      configuration file was changed between the two runs, and the crash did not reproduce on
      rerun -- recorded as a transient, non-reproduced test-runner/environmental flake, consistent
      with the existing M8 precedent, not a proven root cause.

**Step 7: Voice-agent lead capture**
- [x] `create_lead()` added to `ApiClient` (the voice agent's only write-capable internal-API
      call); new `capture_lead` tool (`tools/capture_lead.py`) with no JSON-schema-required
      fields and an explicit no-invention/no-guessing description; registered alongside
      `search_knowledge` in `pipeline.py`'s tool list; `call_sid` threaded from the real M7
      Twilio path (`routes/twilio.py`) through `run_session()`/`build_pipeline()` as an optional,
      server-bound value, never read from LLM tool arguments -- `organizationId` remains bound
      once at pipeline-build time the same way, unreachable from tool arguments. Post-fix
      verification: targeted tests 26/26; full voice-agent suite 120/120 across 14 test files;
      `ruff check .` PASS; `ruff format --check .` PASS; `mypy src` PASS. Two defects found during
      first verification were fixed and re-verified: `tests/test_twilio_media_stream.py`'s
      `fake_run_session()` stub needed the new `call_sid` keyword added to its signature, and
      `tools/capture_lead.py`'s `notes` property description exceeded the 100-character line
      limit (Ruff E501) -- both confirmed resolved on rerun.

**Step 8: Full regression across both suites**
- [x] apps/api: `npm run typecheck -w apps/api` PASS; `npm run lint -w apps/api` PASS;
      `npm run test -w apps/api` PASS -- 15/15 test files, 227/227 tests. services/voice-agent:
      `uv run ruff check .` PASS; `uv run ruff format --check .` PASS (42 files already
      formatted); `uv run mypy src` PASS (27 source files); `uv run python -m pytest tests`
      PASS -- 14/14 test files, 120/120 tests. No regressions found anywhere outside M9's own
      new/touched files; the regression run itself made no working-tree changes.

**Step 10: Pre-commit audit**
- [x] Full read-only pre-commit audit of the accumulated M9 change set (Steps 1-9), covering M9
      scope/changed-file review, database/migration consistency, tenant isolation, write-path
      security, validation/input limits, dashboard and internal API boundaries, voice-agent
      integration, PII/error-logging review, documentation review, and git hygiene -- all passed
      with one recorded finding (below), no code change required beyond that finding's own fix.
      An extra trailing blank line at EOF in `apps/api/tests/internal-api.test.ts` (flagged by
      `git diff --check`) was removed; a subsequent `git diff --check` reported no whitespace
      errors.
- **Post-cleanup verification: intermittent Windows/Vitest worker flake, no identified root
      cause.** `npm run typecheck -w apps/api` PASS; `npm run lint -w apps/api` PASS. The full
      apps/api test suite was run three times after the EOF cleanup: Run 1 hit a worker-process
      crash (`STATUS_ACCESS_VIOLATION`, exit code `3221226505` / `0xC0000005`) while
      `apps/api/tests/twilio-phone-lookup.test.ts` was running -- 221/227 completed tests passed,
      zero assertion failures; Run 2 hit the same crash signature while
      `apps/api/tests/internal-api.test.ts` was running -- 224/227 completed tests passed, zero
      assertion failures; Run 3 completed cleanly -- 15/15 test files, 227/227 tests passed. The
      crash occurred intermittently, in different Vitest worker-fork processes/files each time,
      with no test ever failing an assertion. Recorded as an intermittent Windows/Vitest
      worker-process flake with no identified root cause -- not claimed as definitively
      environmental, and not claimed as definitively unrelated to any code. No configuration
      change or workaround was applied. The final clean run, together with zero assertion
      failures across all three runs, supports commit readiness; the flake itself remains a known
      verification caveat.

**Step 11: Final manual verification**
- [ ] **Real end-to-end persistence verification not yet performed in this environment.** M9's
      final manual-verification step -- the milestone's equivalent of M6's real-provider
      conversation verification and M7's real live Twilio/PSTN call verification -- has not been
      performed here, because: no PostgreSQL instance is currently available/running in this
      environment; Docker/Docker Compose is not installed in this environment; the M9 migration
      (`0006_equal_sebastian_shaw.sql`) has been generated and inspected but has not been applied
      to a real PostgreSQL database here; and a genuine voice conversation using the real
      provider/Twilio path has not been manually verified here (M6/M7's own real-provider/real-call
      manual verification remain outstanding as well -- see "Remaining M6 work" and "Remaining M7
      work" above). As a result, the complete real-world chain from the voice agent's
      `capture_lead` tool call, through the real internal API, through Drizzle, into real
      PostgreSQL persistence, has not yet been proven end-to-end. Do not treat M9 as
      persistence-verified until this is run and confirmed.
- [ ] **Automated M9 verification remains complete and passing, but does not substitute for this.**
      Steps 1-10's full apps/api (227/227) and voice-agent (120/120) automated test suites --
      exercising the schema, repository, validation, service, dashboard, internal API, and
      voice-agent tool logic against in-memory repositories and mocked HTTP transports -- all pass
      and remain valid evidence of correctness at the unit/integration level. That coverage is not
      a substitute for the real-infrastructure verification described above.

## M10 -- Appointment booking (in progress)

**Step 1: Data model (`appointments`, `organization_calendar_connections`)**
- [x] `appointments` table (organization/service FKs, nullable customer contact fields, status enum
      `scheduled|confirmed|cancelled|completed|no_show`, `call_sid`/`google_event_id` unmanaged
      foreign keys) plus a hand-authored `EXCLUDE USING gist` constraint appended to the generated
      migration -- Drizzle has no schema-builder representation for Postgres exclusion constraints
      or `CREATE EXTENSION`; the exception is narrow and documented in both the schema comment and
      the migration's own header. `organization_calendar_connections` mirrors
      `organization_service_credentials`'s one-row-per-org shape.

**Step 2: Repository layer**
- [x] `AppointmentRepository`/`OrganizationCalendarConnectionRepository` (Drizzle + in-memory test
      doubles); `create()` translates the Postgres exclusion-constraint violation (`23P01`) into a
      typed `AppointmentOverlapError`.

**Step 3: Validation**
- [x] `appointment.schemas.ts` -- date/time shape validation only (DST/calendar correctness is
      Step 4's responsibility), field caps matching `lead.schemas.ts`'s existing precedent.

**Step 4: Services**
- [x] `google-token-crypto.ts` -- AES-256-GCM refresh-token encryption, strict two-part base64 key
      validation (rejects what Node's lenient `Buffer.from(str,"base64")` would silently accept).
- [x] `appointment-time.ts` -- pure timezone/DST helpers, including a custom +/-24-hour
      offset-bracketing algorithm for detecting nonexistent (spring-forward) and ambiguous
      (fall-back) local times, empirically verified against real 2026 `America/New_York` DST
      transition dates (Luxon itself does not detect either case).
- [x] `calendar-connection.service.ts`/`google-calendar-client-types.ts` -- the credential
      boundary: `GoogleCalendarClient` receives only a short-lived access token, never a refresh
      token; `CalendarConnectionService` owns the entire token lifecycle internally.
- [x] `appointment.service.ts` -- availability computation against both business hours and live
      Google FreeBusy, booking-write ordering with compensating rollback on partial failure,
      duplicate-booking hard-block by `call_sid`+`service_id`+`start_time`.

**Step 5: Dashboard API**
- [x] `GET/PATCH /organizations/:id/appointments` (status-update-only, cancellation transitions
      enforced in the service, not the schema); `GET/POST/DELETE /organizations/:id/calendar`,
      connect/disconnect owner-gated.

**Step 6: Google OAuth real implementation**
- [x] File 1 -- `google-calendar-client.ts`: native `fetch` only, no SDK; FreeBusy parsing fails
      closed on any calendar-level `errors` value (including a present-but-malformed one).
- [x] File 2 -- `calendar-connection.service.ts` restructured: `completeOAuthConnection()` owns the
      entire authorization-code exchange (token endpoint -> userinfo endpoint -> encrypt -> persist)
      internally; the old `connect()` (confirmed zero callers before removal) is gone.
- [x] File 3 -- `auth/oauth-state.ts` (HMAC-SHA256, 10-minute TTL, binds organization + dashboard
      user, explicitly documented as NOT a server-side one-time-use nonce); `connect()`/
      `handleOAuthCallback()` in `calendar-connection.controller.ts`; `routes/oauth.routes.ts`
      mounts the fixed, auth-free `GET /oauth/google/callback`.
- [x] File 4 -- `app.ts` wired to the real `createGoogleCalendarClient()`; `.env.example` documents
      the five real `GOOGLE_OAUTH_*`/`GOOGLE_TOKEN_ENCRYPTION_KEY` vars. Two logging-leak gaps
      found and fixed during this step: `httpRequestSerializer` strips the query string from
      `/oauth/*` request URLs and blanks the serialized `query` object (pino-http hands custom
      request serializers the already-serialized object, not the raw request -- confirmed
      empirically); `res.headers.location` added to `redact` after finding the OAuth `connect()`
      redirect would otherwise log the signed state token via the `Location` header.
- [x] Tests: `oauth-state.test.ts` (22), `google-calendar-client.test.ts` (26),
      `oauth-flow.test.ts` (18), `http-request-serializer.test.ts` (9),
      `logger-redaction.test.ts` (7, exercising the real logger singleton end to end via a
      `vi.hoisted()` stdout-capture fix rather than a reconstructed/duplicated redact config) --
      82/82 passing.

**Outstanding**
- [x] **Step 7 (voice-agent booking tool: `check_availability`/`book_appointment` tools, related
      internal API endpoints) implemented and verified.**
- [x] **Real-infrastructure manual verification performed and confirmed end-to-end** -- a real
      PostgreSQL instance, a real Google OAuth consent screen, and real Google Calendar API calls
      (availability, booking, and cancellation) have all been exercised successfully.

## Completed -- M11 SMS confirmations and reminders

**Step 1: Data model (`sms_notifications`)**
- [x] `sms_notifications` table -- nullable `appointment_id`/`lead_id` FKs (`ON DELETE cascade`),
      a `CHECK` constraint enforcing exactly one of the two is set, two partial unique indexes
      (`(notification_type, appointment_id)` / `(notification_type, lead_id)`, each
      `WHERE ... IS NOT NULL`) preventing duplicate scheduling, `status` enum
      `pending|processing|sent|failed|skipped`, `next_attempt_at timestamptz NOT NULL DEFAULT
      now()` (every row, confirmations and lazily-materialized reminders alike, is only ever
      inserted already-due). Both the `CHECK` and the partial `uniqueIndex().where()` are
      genuinely supported by the installed `drizzle-orm`/`drizzle-kit` versions (confirmed by
      direct source inspection) -- unlike M10's `EXCLUDE` constraint, no hand-authored SQL was
      needed; migration `0008_lonely_captain_midlands.sql` generated as-is. Real-database
      constraint behavior (both the CHECK and both unique indexes) verified against a live
      PostgreSQL instance.

**Step 2: Repository layer**
- [x] `SmsNotificationRepository` (Drizzle + in-memory test double); `create()` translates
      `23505`/`23514` into typed `DuplicateSmsNotificationError`/`SmsNotificationEntityReferenceError`;
      `claimDue()` atomically claims due rows via `SELECT ... FOR UPDATE SKIP LOCKED` inside a
      transaction, matching the existing job-queue-claim precedent. `NewSmsNotification`'s
      appointment-XOR-lead shape is enforced at the type level with zero casts. Verified:
      `npm run typecheck -w apps/api` clean (only pre-existing, unrelated M10 errors remained);
      157/157 existing tests passing unchanged.

**Step 3: Service layer and SMS-confirmation test coverage**
- [x] `SmsNotificationService` (`scheduleAppointmentConfirmation`/`scheduleLeadConfirmation`) --
      never throws: a duplicate is a silent no-op, any other failure is logged
      (`logger.warn`, mirroring `knowledge.service.ts`'s existing precedent) and absorbed, so it
      can never turn an already-successful booking or lead creation into a failure. Wired into
      `AppointmentService`/`LeadService` (called immediately before their own success return) and
      into `app.ts`. A missing customer phone/contact phone schedules no row at all (no schema
      change, no placeholder row).
- [x] Test coverage: a new, narrowly-injected `FakeCalendarConnectionService`
      (`tests/support/fake-calendar-connection-service.ts`) lets `AppointmentService` reach a real
      `"booked"` result deterministically in tests, with no network call -- the public OAuth
      router keeps using the real `CalendarConnectionService` unchanged, so `oauth-flow.test.ts`'s
      existing real encrypt/decrypt/network-exchange coverage is untouched. Four new HTTP-level
      tests added to `internal-api.test.ts` (two for appointment booking, two for lead capture)
      exercise the real HTTP -> middleware -> controller -> service -> `SmsNotificationService` ->
      in-memory `smsNotifications` repository path: a phone-present booking/lead schedules exactly
      one correctly-typed, correctly-associated notification; a phone-absent one schedules none.
      A first targeted run of `internal-api.test.ts` hit the same intermittent Windows/Vitest
      worker-process crash already documented under M9 Step 4/Step 10
      (`STATUS_ACCESS_VIOLATION`, exit code `3221226505`/`0xC0000005`) after 25/42 tests had
      already passed with zero assertion failures; one authorized rerun completed cleanly, 42/42.
      Recorded as a non-reproduced flake, consistent with the existing M9 precedent, not an M11
      regression. **Final verification: full `apps/api` suite -- 20/20 test files, 313/313 tests
      passed, no regressions.**

**Step 4: SMS-sending worker, Twilio client, delivery-status webhook, opt-out handling, reminder scheduling**
- [x] Implemented as the single bundled step originally scoped -- no Step 4A/4B/4C/4D split:
      `workers/sms-worker.ts` (the `claimDue()`-driven poll/claim/retry/backoff loop, stale-processing
      reclaim, and reminder materialization), `services/twilio-sms-client.ts` (real Twilio REST
      client, no SDK), `controllers/twilio-sms-status.controller.ts` (delivery-status webhook) and
      `twilio-sms-inbound.controller.ts` (STOP/START/HELP keyword handling backed by a new
      tenant-scoped `sms_opt_outs` table, migration `0010_opposite_proemial_gods.sql`),
      `auth/twilio-webhook-signature.ts` (shared Twilio signature verification, reused by both
      webhooks), and the standalone `worker.ts` process entrypoint (`npm run worker`).
- [x] Full read-only pre-commit audit -- security (signature verification, tenant isolation,
      opt-out enforcement, phone normalization, logging/privacy), functionality (retries/backoff,
      reminders, delivery status, Twilio client), database (migrations `0009`/`0010` vs.
      schema/journal consistency), and scope (all 42 changed files confirmed as M11 Step 4 or
      direct supporting infrastructure) -- returned a **READY TO COMMIT** verdict with zero
      blocking findings.
- [x] Verified: `npm run test -w apps/api` -- 473/473 tests, 30/30 files passing; `npm run lint -w
      apps/api` clean; `npm run typecheck -w apps/api` showing only the same pre-existing,
      unrelated errors already catalogued in earlier milestones (`http-request-serializer.test.ts`,
      `oauth-flow.test.ts`, `oauth-state.test.ts`, and one `exactOptionalPropertyTypes`
      fixture-typing note in `sms-worker.test.ts`) -- no new errors introduced.
- [x] Committed as `a336e55` (`feat(api): implement M11 SMS worker and opt-out handling`, full SHA
      `a336e557b7f6a420ce1c98723f083c76c84b0d49`) and pushed to `origin/main`.
- [ ] **Real end-to-end verification not yet performed in this environment.** Mirrors M9 Step 11's
      and M10's own real-infrastructure verification gate: migrations `0009`/`0010` have been
      generated and reviewed but not applied to a live PostgreSQL database here, and no real Twilio
      account/phone number has been used to send/receive an actual SMS or exercise a real STOP/
      START/HELP round-trip or delivery-status callback. Automated coverage (473/473 tests against
      in-memory repositories and a fake Twilio client) remains complete and passing, but does not
      substitute for this.

## M12 -- Dashboard (planned, not started)

**Planning artifact only -- no implementation has started.** This section establishes the
authoritative M12 step breakdown per the official scope in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): "Customer-facing dashboard in `apps/web`: call
transcripts, call summaries, leads, appointments, business analytics, usage tracking." Derived by
reading the existing `apps/web` structure (`src/app/dashboard/page.tsx`, `src/lib/session.ts`,
`src/lib/organizations.ts`, `src/components/*`), the existing `apps/api` routes/repositories
leads/appointments already expose, and the existing security/tenant-isolation model -- so this plan
reuses what already exists rather than duplicating it, and explicitly flags what genuinely does not
exist yet instead of inventing it.

**Confirmed starting state (read-only findings this planning pass depends on):**
- `apps/web` currently has exactly one dashboard page (`src/app/dashboard/page.tsx`, a server
  component) rendering business-profile/business-hours/services/knowledge/receptionist-config forms
  for the user's first organization only (no multi-organization switcher; every request is still
  independently re-authorized server-side regardless of this frontend simplification -- see
  ARCHITECTURE.md "Current organization"). No shared layout/nav component exists beyond the root
  `layout.tsx`. No client-side data-fetching library is used (`fetch` directly, local `useState`,
  no SWR/React Query). **`apps/web` has no test framework configured at all** (`package.json` has
  no `test` script and no testing dependency) -- M8-M11's Vitest convention exists only in
  `apps/api`/`services/voice-agent`.
- `GET/PATCH/DELETE /organizations/:id/leads` and `GET/PATCH /organizations/:id/appointments`
  already exist (`organizations.routes.ts`), explicitly built dashboard-only ahead of this
  milestone (see the M9 Step 5 / M10 Step 5 comments in that file) -- M12's Leads and Appointments
  views consume these directly; no new backend endpoints are required for either.
- **No call/transcript/session data model exists anywhere in this codebase.** `db/schema.ts`'s
  `leads.callSid`/`appointments.callSid` are explicitly documented as "informational only, not a
  foreign key -- no calls/sessions table exists." M6/M7 explicitly deferred call recording/
  transcription storage as out of scope. This means "call transcripts, call summaries" has no
  existing data source -- Steps 5-6 below must design this from scratch, and the depth of that
  design (metadata only vs. full transcript text) is flagged as a genuinely open, unresolved
  product/security decision, not decided by this plan.
- No business-analytics or usage-tracking endpoint exists anywhere in `apps/api`.

**Step 1: Dashboard foundation -- layout, navigation, routing**
- [x] Introduce a shared dashboard layout (`src/app/dashboard/layout.tsx`) providing a persistent
      nav/header (organization name, logged-in user, `LogoutButton`) shared across every dashboard
      subpage, replacing the ad hoc per-page header currently duplicated in `page.tsx`.
- [x] Split the current single `dashboard/page.tsx` into a routed section structure, e.g.
      `dashboard/page.tsx` (overview), `dashboard/leads/page.tsx`, `dashboard/appointments/page.tsx`,
      `dashboard/calls/page.tsx`, `dashboard/analytics/page.tsx`, `dashboard/settings/page.tsx`
      (housing the existing business-profile/hours/services/knowledge/receptionist-config forms,
      moved as-is, not rewritten). Exact route names/grouping to be finalized at implementation
      time; the principle (one focused page per resource, existing forms relocated not rebuilt) is
      the binding part of this step.
- [x] Nav links reflect only what is actually implemented at any given point (no dead links to
      not-yet-built sections).

**Step 2: Authenticated organization/business context**
- [x] Extract the existing `getCurrentUser()` + `listOrganizations()` + redirect-if-unauthenticated
      + redirect/empty-state-if-no-organization logic (currently inline in `dashboard/page.tsx`)
      into one reusable server-side helper consumed by every dashboard subpage from Step 1, instead
      of being copy-pasted per page. No new authorization mechanism -- reuses `getCurrentUser`
      (`lib/session.ts`) and `listOrganizations` (`lib/organizations.ts`) unmodified; the frontend
      redirect remains a UX convenience only, never the security boundary (per SECURITY.md --
      every API call below is still independently re-authorized server-side).
- [x] Preserve the existing, explicitly-documented "first organization only" simplification unless
      a multi-organization switcher is explicitly scoped as its own sub-step here -- not assumed.

**Step 3: Leads dashboard view**
- [x] Add `Lead`/`LeadStatus` types and `listLeads`/`updateLeadStatus`/`deleteLead` helpers to
      `lib/organizations.ts` (or a new `lib/leads.ts`, mirroring the existing module-per-resource
      precedent), calling the already-existing `GET/PATCH/DELETE /organizations/:id/leads[/:id]`
      endpoints -- no backend change.
- [x] `components/leads/leads-table.tsx` (client component, mirroring `knowledge-manager.tsx`'s
      established pattern): list, status filter, status-update action, delete action, using the
      same `fetch(..., { credentials: "include" })` + optimistic local-state-update convention
      already established.
- [x] Loading/empty ("no leads yet")/error states (see Step 9).

**Step 4: Appointments dashboard view**
- [x] Add `Appointment`/`AppointmentStatus` types and `listAppointments`/`updateAppointmentStatus`
      helpers, calling the already-existing `GET/PATCH /organizations/:id/appointments[/:id]`
      endpoints -- no backend change (booking/creation remains voice-agent-only, unchanged from
      M10; this view is read + cancellation-status-update only, matching the existing API surface).
- [x] `components/appointments/appointments-table.tsx`: list (upcoming/past grouping computed
      client-side from `startTime`, no new backend filter needed), cancellation action, empty/
      loading/error states.

**Step 5: Calls/conversations data model and capture (backend)**
- [x] **Open design decision, not resolved by this plan:** define a new, minimal `calls` (or
      `call_sessions`) table -- organization-scoped, `call_sid` (from the real M7 Twilio webhook
      data already flowing through `services/voice-agent/src/voice_agent/routes/twilio.py`),
      `started_at`/`ended_at`, and an outcome/disposition field. Whether this step also stores full
      verbatim transcript text is an explicit open question: doing so is a materially different,
      more privacy-sensitive capability than the metadata-only scope M6/M7 deliberately excluded,
      and would need its own SECURITY.md review (retention, access control, redaction) before
      being built -- this plan does not decide that question and scopes Step 5 to call metadata
      (+ optional short summary, Step 6) only, pending that separate decision.
- [x] `services/voice-agent` needs a new write path to record call start/end against this table --
      a new `ApiClient` method + internal-API endpoint, mirroring the established `create_lead`
      (M9 Step 7) / `book_appointment` (M10 Step 7) pattern: service-auth + organization-bound,
      never trusting an LLM-tool-supplied organization id.
- [x] Dashboard-facing `GET /organizations/:id/calls` (list) endpoint, same `requireAuth` +
      `requireOrgMembership` pattern as every other resource in `organizations.routes.ts`.

**Step 6: Call summaries**
- [x] Depends on Step 5's data model and its open transcript-storage decision. Scoped here as an
      optional short, free-text summary field on the Step 5 table, populated by the voice agent at
      call end (e.g., from the LLM's own end-of-call context) rather than a separate
      summarization pipeline -- avoids inventing new infrastructure beyond what Step 5 already
      requires. If Step 5 resolves to metadata-only (no transcript), this field is the entire
      "call summary" feature; if Step 5 later adds transcript storage, this field remains
      independent of it.

**Step 7: Calls dashboard view (frontend)**
- [x] Blocked by Steps 5-6. `lib/calls.ts` (`listCalls`) + `components/calls/calls-table.tsx`:
      list of calls per organization with metadata + summary (if present), empty/loading/error
      states. No transcript rendering unless Step 5's open question resolves to storing one.

**Step 8: Business analytics**
- [x] **Assumption requiring confirmation:** initial scope is simple, derived aggregate counts
      over a period (e.g., appointments by status, leads by status, calls handled once Step 5
      exists, SMS sent via the existing `sms_notifications` table) -- not a general-purpose BI/
      reporting system. New `GET /organizations/:id/analytics` endpoint (or several narrower ones),
      same auth pattern as every other resource, computing aggregates from existing tables rather
      than a new denormalized analytics store.
- [x] Frontend: `components/analytics/analytics-summary.tsx` -- summary cards/simple charts.
      No charting library is currently a dependency of `apps/web`; whether to add one (and which)
      is left to implementation time rather than decided here, to avoid adding a dependency this
      plan can't justify against real requirements yet.

**Step 9: Usage tracking**
- [x] **Assumption requiring confirmation:** IMPLEMENTATION_PLAN.md lists "usage tracking" under
      M12 (Dashboard) and "metered usage billing" separately under M13 (Stripe billing). This plan
      treats M12's usage tracking as a lightweight, read-only display of already-derivable
      per-organization counts (calls handled, SMS sent, appointments booked) over a period --
      explicitly NOT the metered/billable usage-metering system, which remains M13's scope. If
      that boundary is wrong, it should be corrected before Step 9 is implemented, not assumed
      silently.
- [x] If Step 9's counts are a strict subset of Step 8's analytics aggregates, consider folding
      Step 9 into Step 8's endpoint/view rather than building a second, near-duplicate one --
      a decision for implementation time once both steps' exact shape is clearer.

**Step 10: Loading/empty/error states (cross-cutting)**
- [x] Formalize one shared convention (e.g., shared skeleton/empty-state/error-banner components
      under `components/`) applied consistently across Steps 3-4 and 7-9's views, rather than each
      view inventing its own ad hoc handling -- matches this project's general preference for one
      shared pattern over N independently-drifting ones.

**Step 11: Tenant isolation and authorization review**
- [x] Dedicated audit step, mirroring the tenant-isolation review every prior milestone with new
      backend endpoints has performed: confirm every new endpoint from Steps 5/8/9 uses the exact
      same `requireAuth` + `requireOrgMembership` (+ owner-only gate where warranted, matching the
      `phone-numbers`/`calendar` precedent) pattern as every existing resource; confirm no new
      endpoint accepts a bare resource id without an `organizationId` scope in the query itself
      (matching `LeadRepository`/`AppointmentRepository`'s existing "deliberately unrepresentable
      at the type level" precedent); confirm the frontend never treats client-side state as an
      authorization boundary.

**Step 12: Tests**
- [x] `apps/api`: new tests for any Step 5/8/9 backend endpoints, following the existing Vitest +
      in-memory-repository + supertest convention used throughout `apps/api/tests/`.
- [x] `apps/web`: **currently has no test framework at all** -- this step must first introduce one.
      Recommendation (not a decision made by this plan): Vitest + React Testing Library, for
      consistency with `apps/api`'s existing Vitest choice, added as a new `apps/web` devDependency
      at implementation time (out of scope for this documentation-only planning pass). Component
      tests for Steps 3-4, 7-9's views (rendering, loading/empty/error states, action handlers)
      and the Step 2 context helper.

**Step 13: Accessibility and responsive behavior**
- [x] Pass over every new view from Steps 1, 3-4, 7-9: semantic HTML, keyboard navigability,
      ARIA labeling for tables/forms/actions, responsive layout at common breakpoints -- using the
      existing Tailwind styling approach already established by the M3/M4 forms, not a new UI
      framework.

**Step 14: Final verification**
- [ ] Full regression: `apps/web` typecheck/lint/build clean; `apps/api` typecheck/lint/test clean
      (including any Step 5/8/9 additions); `services/voice-agent` regression if Step 5 touches it
      (ruff/mypy/pytest). Manual verification checklist: the dashboard renders real data end-to-end
      against a live backend, and (if Step 5 is implemented) a real Twilio-originated call actually
      produces a visible calls-dashboard entry. Documentation pass: `TASKS.md` completion status,
      `ARCHITECTURE.md`/`SECURITY.md` updates for any new endpoints or (if resolved) the transcript-
      storage decision from Step 5.

## M13 -- Stripe billing (in progress)

Authoritative M13 step breakdown per the official scope in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): "Subscription plans, metered usage billing,
Stripe webhook handling, billing UI." Derived by reading the actual current `apps/api` source
tree and git history rather than assumed -- several backend pieces already exist and are
committed; several others (anything requiring a live Stripe account/credentials, and all billing
UI) do not exist yet.

**Confirmed starting state (read-only findings this checklist depends on):**
- No `stripe` package is a dependency anywhere in this repository (native `fetch` is the approved
  integration approach, not the Stripe SDK). No `STRIPE_SECRET_KEY` exists in `config/env.ts` or
  anywhere else -- only `STRIPE_WEBHOOK_SECRET`, read directly via `process.env` at the controller
  boundary (see `stripe-webhook.controller.ts`), following this codebase's existing two-tier
  secret convention.
- No Stripe customer creation, Checkout Session creation, native Billing Meter/Price creation, or
  Billing Portal session creation code exists anywhere.
- No service or worker exists that computes billable minutes from `calls` rows or reports usage
  to Stripe. The durable local ledger for that future work (Step 5 below) exists, but is not yet
  populated or consumed by anything.
- No billing UI exists anywhere in `apps/web` (confirmed via directory listing -- no
  `components/billing`, no `lib/billing.ts` equivalent).

**Step 1: Organization subscription schema and status endpoint**
- [x] `organization_subscriptions` table (organization-scoped, nullable Stripe linkage fields,
      lazy row creation) -- commit `4ea0142`.
- [x] `OrganizationSubscriptionRepository` (Drizzle + in-memory) -- commit `1b8ac6d`.
- [x] Public `GET /organizations/:id/subscription` status endpoint, deliberately excluding
      `stripeCustomerId`/`stripeSubscriptionId` from the response -- commit `b346376`.

**Step 2: Stripe webhook signature and raw-body boundary**
- [x] Native (no SDK) `Stripe-Signature` verification (`t=`/`v1=` HMAC-SHA256, 300s tolerance,
      timing-safe comparison) and the `express.raw()` route boundary mounted before the global
      JSON body parser -- commit `89874f4`.
- [x] `stripe_webhook_events` dedupe/ordering ledger table and repository scaffold -- commit
      `7ec5c58`.

**Step 3: Stripe subscription lifecycle synchronization**
- [x] `StripeSubscriptionSyncService`: organization resolution (subscription id / customer id /
      verified `metadata.organizationId`), event dedupe, stale/out-of-order rejection, status
      mapping, and the accepted Option C first-row concurrency decision (documented in
      SECURITY.md, not closed by an advisory lock or extra schema) -- commit `627b94b`.
- [x] Licensed-vs-metered subscription item resolution (`price.recurring.usage_type`, never
      positional `items[0]`) so the sync service is compatible with the approved two-item
      (licensed + metered) subscription shape -- same commit, extended in this session.
- [x] `currentPeriodStart`/`currentPeriodEnd` synchronized from the resolved licensed item's
      Stripe billing-period fields, with existing-value preservation when Stripe omits a period
      field -- commit `b1c9dd5`.

**Step 4: Durable call-usage-report ledger**
- [x] `call_usage_reports` table (`callId` unique/cascade to `calls.id`, denormalized
      `organizationId`, nullable `billableMinutes`/`meterEventIdentifier`/`reportedAt`),
      `CallUsageReportRepository` (Drizzle + in-memory), and focused repository tests -- commit
      `5cf07aa`.
- [x] Migration `0016_unique_mimic` generated for this table.
- [ ] **Migration `0016` has been generated but is NOT applied to any database.** This checklist
      item does not claim the table exists in a running database, only that the schema/migration
      source is committed.
- [x] This ledger is now populated and consumed: `call.service.ts`'s `recordCall()` computes and
      persists `billableMinutes` from `calls.startedAt`/`endedAt` at call-record time, and
      `workers/usage-reporting-worker.ts` reports each unreported row's usage to Stripe via Meter
      Events, writing `meterEventIdentifier`/`reportedAt` only after Stripe confirms acceptance --
      both delivered by Step 7 below, which did not exist yet when this line was originally written.

**Step 5: Stripe customer creation and organization association**
- [x] Server-side Stripe Customer creation (native fetch), idempotent per organization
      (deterministic `Idempotency-Key` derived from `organizationId`, not a random key), reusing
      an existing `stripeCustomerId` on `organization_subscriptions` rather than creating a
      duplicate. Owner-gated, organization id taken only from authenticated server-side context.

**Step 6: Stripe Products/Prices, native Billing Meter, and Checkout flow**
- [ ] Native Stripe Billing Meter + graduated-tier metered Price (first 10,000 minutes at $0,
      additional minutes at $0.25) configured outside the repository (Stripe Dashboard/API,
      referenced here by env-configured Price/meter identifiers, never created by application
      code at runtime).
- [x] Checkout Session creation: one-time $1,000 setup Price + $2,500/mo recurring licensed
      Price + the metered overage Price (no `quantity` on the metered line item, per Stripe's
      documented requirement), owner-gated.

**Step 7: Usage computation and Meter Event reporting**
- [x] Service/worker that computes billable minutes per call (existing approved rule: exclude
      `disposition = "failed"`, `ceil(durationSeconds / 60)`, minimum 1 minute), populates
      `call_usage_reports.billableMinutes`, and reports each call's usage to Stripe via
      `POST /v1/billing/meter_events` using the ledger's `callId`-derived idempotency key, then
      records `meterEventIdentifier`/`reportedAt`. Depends on Steps 4 and 6.

**Step 8: Stripe Billing Portal**
- [x] Owner-gated endpoint creating a Billing Portal session for the organization's existing
      Stripe customer (server-resolved `stripeCustomerId`, never client-supplied), returning only
      the portal URL.

**Step 9: Billing UI (frontend)**
- [x] `apps/web` billing dashboard view: current plan, monthly price, included/used/remaining
      minutes for the current Stripe billing period (explicitly distinct from M12's rolling
      30-day analytics usage metric, never reusing it), subscription status, setup-fee status,
      and a Billing Portal action -- consuming Steps 1-3's existing status endpoint plus new
      endpoints from Steps 5-8.

**Step 10: Tenant isolation and authorization review**
- [x] Dedicated audit step, mirroring M12 Step 11: confirm every new M13 endpoint from Steps 5-8
      uses the existing `requireAuth` + `requireOrgMembership` + owner-only gate pattern, never
      accepts a client-supplied organization id, and never returns another organization's Stripe
      identifiers.

**Step 11: Tests and final verification**
- [x] Focused tests for every new Steps 5-8 service/endpoint (mocked Stripe HTTP calls, no live
      network access), following the existing Vitest + in-memory-repository convention.
- [ ] Full regression: `apps/api` typecheck/lint/test clean. Manual verification checklist:
      billing flow exercised against Stripe test-mode credentials once those exist (not before).
      Documentation pass: `TASKS.md` completion status, `ARCHITECTURE.md`/`SECURITY.md` updates
      for the finalized usage-reporting idempotency design and any new endpoints.

## M14 -- Security and testing (in progress)

Authoritative M14 scope per [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): "Dedicated hardening
pass: CI-enforced dependency scanning (`npm audit`, `pip-audit`, secret scanning), tenant-isolation
test coverage across every org-scoped endpoint introduced since M3, rate limiting, load testing on
the voice path." Four sub-scopes, nothing beyond what that sentence states.

**Confirmed starting state (read-only findings this checklist depends on):**
- `.github/workflows/ci.yml` runs only `npm run lint`/`typecheck`/`test`/`build` (Node) and
  `uv run ruff check`/`ruff format --check`/`mypy`/`pytest` (voice-agent) -- no `npm audit`, no
  `pip-audit`, no secret-scanning step exists anywhere in CI.
- No rate-limiting package (e.g. `express-rate-limit`) is a dependency of `apps/api` -- only
  `helmet` (security headers, unrelated) is installed. SECURITY.md's own "Known gaps" sections
  have documented the absence of rate limiting on `/auth/*` (since M2), `/internal/v1/...` (since
  M5), and `/twilio/media-stream` (since M7) without it ever being closed, each explicitly
  deferring the fix to M14.
- No load-testing tool (k6, Artillery, Locust, or a custom script) exists anywhere in this
  repository -- no config, no script, no CI job.
- Tenant-isolation tests already exist for every milestone from M3 onward (M3 organizations, M4
  knowledge/receptionist-config, M5 service-auth, M7 phone-numbers/call-credential, M8 knowledge
  chunks, M9 leads, M12 dashboard/analytics, M13 Stripe billing), each documented in its own
  SECURITY.md section. What does not yet exist is a single, dedicated, cross-milestone audit pass
  confirming that coverage holistically, across every org-scoped endpoint that exists today.

**Step 1: CI-enforced dependency and secret scanning**
- [x] Decide the secret-scanning approach -- **Gitleaks Action v3** (`gitleaks/gitleaks-action@v3`),
      explicitly chosen over trufflehog/detect-secrets/GitHub native secret scanning.
- [x] Add `npm audit` as a CI step for the Node workspaces -- `npm audit --audit-level=high` in the
      `node` job; HIGH/CRITICAL findings fail the build, lower severities are reported but do not
      fail (commit `b86cfd5`).
- [x] Add `pip-audit` as a CI step for `services/voice-agent` -- `uv run pip-audit` in the
      `voice-agent` job; any reported vulnerability fails the build, since pip-audit has no
      supported severity threshold (commit `b86cfd5`).
- [x] Add the selected secret-scanning step to CI -- a dedicated `secrets` job runs
      `gitleaks/gitleaks-action@v3` with `actions/checkout@v7`/`fetch-depth: 0` and `GITHUB_TOKEN`;
      no `GITLEAKS_LICENSE` (not required for this personal-account repository); no
      allowlist/exclusions; fails CI on any finding (commit `07f955f`).
- [x] Decide and document the failure policy -- npm audit: `--audit-level=high` (HIGH/CRITICAL fail,
      lower severities reported only); pip-audit: any finding fails (no severity API available --
      see notes below); Gitleaks: any finding fails, no bypass.

**Step 1 implementation notes:**
- The `pip-audit` step surfaced a real, then-current vulnerability (`PYSEC-2026-3740` /
  `GHSA-8mgp-746c-j5xp` / `CVE-2026-81726`) in `nltk 3.10.3`, transitively required by
  `pipecat-ai 1.8.1`. Remediated by upgrading `pipecat-ai` to `1.12.0` (commit `b86cfd5`), which
  drops `nltk` entirely in favor of `sentencex==1.0.31` -- confirmed via a source-level
  compatibility review (all 33 Pipecat symbols this codebase imports still resolve, live-verified
  against the installed 1.12.0 package) and a clean post-upgrade `pip-audit` run (0
  vulnerabilities).
- Local Windows Application Control (Smart App Control) blocked `pytest`/`mypy` native executable
  startup on the development machine during verification of this upgrade -- a local-environment
  limitation, not a defect in the upgrade or the CI configuration; no Windows security control was
  disabled to work around it. `ruff check`/`ruff format --check` ran successfully (aside from two
  pre-existing, unrelated formatting-drift files).
- **Remote verification complete for M14 Step 1's three mechanisms:** GitHub Actions run
  `36578099571`, triggered by commit `07f955f`, executed all three checks against the pushed
  history.
  - `npm audit --audit-level=high`: **PASSED**. Actual CI output reported 4 moderate-severity
    `esbuild` vulnerabilities; reported but did not fail the step, since the configured threshold
    is HIGH/CRITICAL.
  - `uv run pip-audit`: **PASSED**. Actual remote output reported no known vulnerabilities. The
    private `voice-agent` package was skipped as not published to PyPI; the audited dependency
    tree was the pushed Pipecat 1.12.0 / sentencex 1.0.31 tree with NLTK removed.
  - Gitleaks: **PASSED**. The dedicated `secrets` job ran `gitleaks/gitleaks-action@v3` with
    `actions/checkout@v7` and `fetch-depth: 0`; the actual run reported 13 commits scanned and
    `No leaks detected`.
  - All three M14 Step 1 security mechanisms are therefore remotely verified.
  - **This does not mean the overall CI workflow is green.** The same run (`36578099571`) also had
    an unrelated `Node` job `npm run typecheck` failure, which caused the subsequent Node
    `test`/`build` steps in that job to be skipped. That failure is outside M14 Step 1's scope and
    stems from application-source changes that remain uncommitted locally and are therefore not
    yet present on `origin/main`. M14 Step 1's remote security-check verification is complete;
    overall CI remains red because of that separate, unrelated typecheck issue.

**Step 2: Cross-milestone tenant-isolation audit**
- [x] Dedicated audit/review step: walked org-scoped endpoints introduced since M3 and confirmed
      each still uses the established `requireAuth`/`requireOrgMembership` (or the M5/M7
      service-auth equivalent) pattern, with no bare-resource-id-without-organization-scope
      regression found.
- [x] Documented the audit's findings -- see the implementation notes below.
- [x] Where the audit found a genuine coverage gap, added a focused test for that specific gap;
      no blanket new tests were added for endpoints whose existing milestone-level test suite
      already provided adequate coverage.

**Step 2 implementation notes:**
- Confirmed existing tenant-isolation test coverage already adequately protects four
  previously audited areas -- no new tests were added for these, since their existing coverage
  already includes explicit cross-organization denial assertions:
  - public `GET /:organizationId/calls`
  - public `GET /:organizationId/analytics`
  - public `PATCH`/`DELETE /:organizationId/knowledge/:knowledgeId`
  - internal `POST /organizations/:organizationId/calls`
- Identified a test-coverage gap -- not a newly discovered production authorization bypass,
  since both routes already use the same `serviceAuth`/`organizationAuth` middleware chain
  already proven correct on their sibling internal routes -- for two internal appointment
  endpoints that lacked cross-organization test coverage:
  - `GET /internal/v1/organizations/:organizationId/appointments/availability`
  - `POST /internal/v1/organizations/:organizationId/appointments`
- Closed that gap in `apps/api/tests/internal-api.test.ts` with test-only changes; no
  production authentication, authorization, middleware, rate-limit, schema, migration, or
  dependency change was required:
  1. a same-organization appointment-availability success test;
  2. a cross-organization appointment-availability denial test;
  3. the deterministic fake-calendar-connection setup required by the same-org availability
     test, reusing the existing `fakeCalendarConnectionService` fixture already used by the
     sibling booking tests;
  4. an `orgBId` setup added to the existing booking describe block's fixture, for the new
     isolation test;
  5. exactly one cross-organization appointment-booking denial test.
  The two existing appointment-confirmation SMS tests were left unchanged. An unused
  `orgBToken` declaration/assignment introduced during an intermediate edit was removed before
  finalizing.
- Targeted verification (Vitest's `-t` name filter, run individually): same-organization
  availability -- passed; cross-organization availability denial -- passed; cross-organization
  booking denial -- passed; the existing appointment-confirmation SMS test (with phone) --
  passed; the existing no-phone SMS test -- passed. 5 of 5 relevant tests passed in targeted
  isolation.
- The full `tests/internal-api.test.ts` file run was attempted twice; both attempts hit the
  same pre-existing, intermittent Windows Vitest worker crash (`0xC0000005` /
  `STATUS_ACCESS_VIOLATION` -- the same documented flake referenced under Step 3's environment
  blocker below) at different points in the file, with no assertion failure in either attempt.
  This is not a fix for that crash, and the full-file run has not completed successfully
  end to end on this local machine -- only the individually targeted tests above are confirmed
  passing.
- `git diff --check` passed (exit 0) and `npm run typecheck` passed (exit 0) against the
  working tree including this change. A final diff review confirmed only the intended M14
  Step 2 test changes were present in `apps/api/tests/internal-api.test.ts`; pre-existing
  unrelated dirty hunks in that file were left untouched.
- Nothing from this Step 2 work has been staged, committed, or pushed.

**Step 3: Rate limiting**
- [x] Decide the rate-limiting approach -- PostgreSQL-backed, using the existing shared
      `apps/api` database as the authoritative store. No Redis is used, despite Redis already
      being provisioned in `infrastructure/docker/docker-compose.yml` for other purposes.
- [x] Decide which library, if any, implements the chosen approach -- none; implemented with
      native `pg`/Drizzle primitives only (atomic `INSERT ... ON CONFLICT ... DO UPDATE`
      increment), no rate-limiting package added.
- [x] Apply rate limiting to `/auth/login`/`/auth/register` (the longest-standing documented
      gap) -- implemented (10/15min and 5/60min per IP respectively).
- [x] Apply rate limiting to `/internal/v1/...` (documented gap since M5) -- implemented: 1000
      requests/minute, via two independent bucket types confirmed directly from
      `internal.routes.ts` -- a per-organization bucket (`internal-org:{organizationId}`,
      verified via the caller's per-organization service token) applied to six
      organization-scoped routes, and a single global bucket (`internal-global`) applied to the
      one route that precedes organization-token verification (the phone-number lookup route
      that establishes organization identity).
- [x] `/twilio/media-stream` connection-rate limiting / connection cap -- resolved as
      **deferred to infrastructure**, not application code. This is not a new decision made in
      M14: it restates the existing M7 architectural decision already recorded in
      [SECURITY.md §10](SECURITY.md) ("no connection-rate limiting or concurrent-connection cap
      on `/twilio/media-stream`, left to a future infra-aware milestone (a reverse proxy/load
      balancer in front of a real deployment, not application code here)"). No Python/FastAPI
      connection-cap logic was proposed or implemented in `services/voice-agent` for M14.
- [x] Twilio SMS status (`POST /twilio/sms-status`) application-level rate limiting --
      implemented: 300 requests/minute per organization, fixed 60,000ms window, org-scoped key
      `twilio:sms-status:${organizationId}`. Signature verification (`verifyTwilioSignature`) and
      organization resolution (via the existing provider-message-SID lookup) both run before the
      limiter. Verified by focused tests in `tests/twilio-sms-status-webhook.test.ts`.
- [x] Twilio SMS inbound (`POST /twilio/sms-inbound`) application-level rate limiting --
      implemented: 60 requests/minute per organization, fixed 60,000ms window, org-scoped key
      `twilio:sms-inbound:${organizationId}`. Signature verification (`verifyTwilioSignature`) and
      organization resolution (via the existing phone-number-to-organization lookup) both run
      before the limiter. Verified by focused tests in `tests/twilio-sms-inbound-webhook.test.ts`.
- [x] Stripe webhook (`POST /stripe/webhook`) application-level rate limiting --
      implemented: 100 requests/minute per organization, fixed 60,000ms window, org-scoped key
      `stripe:webhook:${organizationId}`. Signature verification (`verifyStripeSignature`) and a
      faithful organization resolution (the existing three-tier subscription-event resolution --
      Stripe subscription ID, then Stripe customer ID, then validated `metadata.organizationId`
      -- or the existing single-customer-ID invoice/setup-fee resolution, depending on event
      category) both run before the limiter, which itself runs before `processEvent()`. A
      rejected request receives 429 and never reaches `processEvent()`. Invalid signatures,
      unsupported event types, and events whose organization cannot be resolved are never
      rate-limited (no global fallback bucket). Existing `processEvent()` transaction boundaries,
      dedupe behavior, advisory-lock behavior, and mutation ordering were not decomposed. Verified
      by focused tests in `tests/stripe-webhook-route.test.ts` and
      `tests/stripe-setup-fee-sync.service.test.ts`.
- [x] Tests for rate-limiting behavior (threshold reached results in a rejection response),
      following the existing Supertest HTTP-integration convention -- real HTTP-level 429
      boundary tests exist for the three smaller-limit buckets (A: login 10/15min, B: register
      5/60min, C2: organization billing-portal 10/10min). The two larger-limit buckets (C1:
      300/min per organization, D: 1000/min per organization/global) are proven at their
      configured threshold by the existing `rate-limit.service.test.ts` unit-level suite rather
      than a real 300- or 1000-request HTTP loop, a deliberate decision to avoid slow/flaky HTTP
      loops -- see the verification notes below for the full per-file breakdown.

**Step 3 verification notes:**
- `tests/rate-limit.service.test.ts`: 10/10 passed (unit-level, real service/middleware against
  a real in-memory repository, no HTTP layer). This suite is the sole verification that the C1
  (300/min) and D (1000/min) buckets actually reject once their configured threshold is reached;
  no real 300- or 1000-request HTTP loop was created for either bucket, by deliberate decision.
- `tests/organizations.test.ts`: 27/27 passed (full file). Of these, the 6 M14 C1 rate-limiting
  tests were independently re-run in isolation this session (`-t "rate limiting"`): 6 passed, 21
  skipped, exit 0. C1 HTTP coverage: `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset`
  headers on an allowed response, per-organization bucket isolation, that a rejected cross-org
  request carries no rate-limit headers and does not consume the caller's own bucket, and that
  `POST`/`GET /organizations` and `DELETE .../calendar` are excluded from the limiter. No real 429
  is reached here (300/min); that threshold is covered only by `rate-limit.service.test.ts` above.
- `tests/organization-subscription.test.ts`: 40/40 passed (full file; grew by one test this round
  from the previously documented 39/39). Of these, the 3 M14 C2 rate-limiting tests were
  independently re-run in isolation this session: 3 passed, 37 skipped, exit 0. C2 HTTP coverage:
  header-contract on an allowed response, per-organization bucket isolation, and -- newly added
  this round -- a real HTTP boundary test sending 10 allowed requests followed by an 11th that
  returns 429 with `RateLimit-Limit=10`, `RateLimit-Remaining=0`, `RateLimit-Reset`, and
  `Retry-After` all present.
- `tests/twilio-phone-lookup.test.ts`: 11/11 passed (full file). Of these, the 2 M14 D
  (global-bucket) rate-limiting tests were independently re-run in isolation this session: 2
  passed, 9 skipped, exit 0 (this session's own observed figure; an earlier draft of this note
  had incorrectly stated 1 passed/10 skipped for this file and was corrected against the actual
  run). Coverage: header-contract on an allowed response, and that the global bucket is shared
  across different organizations' phone numbers (the second lookup's `RateLimit-Remaining` is
  exactly one less than the first's). No real 429 is reached here (1000/min); that threshold is
  covered only by `rate-limit.service.test.ts` above.
- `tests/internal-api.test.ts`: the 3 M14 D (per-organization bucket, internal API)
  rate-limiting tests were independently run in isolation this session (`-t "rate limiting"`, to
  avoid the documented Windows Vitest worker crash risk on a full-file run of this file): 3
  passed, 59 skipped, exit 0. Coverage: header-contract on an allowed response, per-organization
  bucket isolation, and that a rejected wrong-org-token request (403, decided before the limiter
  runs) carries no rate-limit headers and leaves the target organization's own bucket unconsumed.
  The full file (62 tests total) was not run in this pass -- see the Windows Vitest worker-crash
  note below for why a full-file run of this specific file is avoided where a targeted `-t`
  filter is sufficient.
- `tests/auth.test.ts`: 16/16 passed (full file). Of these, the 4 M14 A/B rate-limiting tests were
  independently re-run in isolation this session (`-t "rate limiting"`): 4 passed, 12 skipped,
  exit 0. Coverage for both A (login, 10/15min) and B (register, 5/60min): a real HTTP 429
  boundary test (11th/6th request respectively) asserting `RateLimit-Remaining=0`,
  `RateLimit-Reset`, and `Retry-After`, plus a header-contract test on an allowed response
  asserting `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset`. Separately,
  `tests/auth.test.ts`'s M14 A login rate-limiting test had earlier required a test-only
  correction: `expect(res.status).toBe(400)` was changed to `expect(res.status).toBe(401)`,
  because `auth.controller.ts`'s `login` handler deliberately returns 401 (not 400) for
  schema-validation failure. No production behavior was changed. After that fix, the then-narrower
  targeted test passed (1 passed, 15 skipped, exit code 0); the broader `-t "rate limiting"` filter
  used in this round's verification matches all 4 A/B tests, as reported above.
- Header contract, confirmed directly from `require-rate-limit.ts`'s source and now asserted at
  the HTTP layer across all five files above: every request that reaches and passes the limiter
  (an allowed response) receives `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`;
  only a rejected (429) response additionally receives `Retry-After`, because the middleware sets
  that header exclusively in its rejection branch. Allowed-response tests therefore intentionally
  never assert `Retry-After` -- this is not a coverage gap, it is what the middleware's actual
  behavior makes possible to assert.
- No Windows Vitest worker crashes occurred during any of the five targeted `-t "rate limiting"`
  runs performed this session.
- The previously documented argon2/Windows Application Control (Smart App Control) blocker did
  **not reproduce** during this session's runs -- `auth.test.ts`, `organizations.test.ts`,
  `organization-subscription.test.ts`, `twilio-phone-lookup.test.ts`, and (via the targeted `-t`
  filter) `internal-api.test.ts` all loaded and ran to completion. This is not a claim that the
  underlying Windows-level condition is permanently resolved -- see the original investigation
  retained below.
- Migration `apps/api/src/db/migrations/0018_dusty_human_fly.sql` exists in the working tree and
  has **not** been applied to any database.
- No production security vulnerability was identified during this rate-limiting verification
  pass.
- Of the items above that were formerly bundled together: `/twilio/media-stream` is resolved as
  deferred to infrastructure (restating the existing M7 SECURITY.md §10 decision, not a new one).
  The Twilio SMS status (`POST /twilio/sms-status`) and Twilio SMS inbound (`POST
  /twilio/sms-inbound`) webhook rate-limiting items are implemented and verified: 300 and 60
  requests/minute/org respectively, each with a fixed 60,000ms window and an org-scoped bucket key.
  The Stripe webhook (`POST /stripe/webhook`) item is now also implemented and verified: 100
  requests/minute/org, fixed 60,000ms window, org-scoped bucket key, with limiting applied after
  signature verification and faithful organization resolution and before `processEvent()`. All
  three items have passing focused tests.

**Known environment blocker (Step 3 test execution, local Windows machine) -- historical
investigation, superseded above for the four files that have since run successfully:**
- The standalone unit-level suite `tests/rate-limit.service.test.ts` passed 10/10 tests, exercising
  the real rate-limit service/middleware against a real in-memory repository directly (no HTTP
  layer, no `buildTestApp()`).
- The five HTTP-level focused suites intended to verify Step 3's rate-limiting behavior end to end
  -- `tests/auth.test.ts`, `tests/organizations.test.ts`, `tests/organization-subscription.test.ts`,
  `tests/internal-api.test.ts`, `tests/twilio-phone-lookup.test.ts` -- failed to load on this
  machine, before any individual test executed. The failure occurs while transitively loading the
  pre-existing argon2 authentication path (via `buildTestApp()` / `auth.service.ts`), not from a
  rate-limit assertion failure.
- Exact runtime error: "An Application Control policy has blocked this file."
- Affected native binary: `node_modules/argon2/prebuilds/win32-x64/argon2.glibc.node` (argon2
  `0.45.1`).
- `Get-AuthenticodeSignature` reports `Status: NotSigned` for this binary.
- Full-history searches of `Microsoft-Windows-CodeIntegrity/Operational` and
  `Microsoft-Windows-AppLocker/EXE and DLL` found no matching event mentioning the exact block
  phrase, Smart App Control, argon2, or `.node`.
- `CiTool.exe -lp` (Microsoft's supported App Control policy-listing diagnostic) returned
  `E_ACCESSDENIED (0x80070005)` because the session was not elevated -- this result is inconclusive
  and is not evidence for or against Smart App Control.
- Windows Security UI was manually observed showing Smart App Control = On; registry
  `HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState` was observed as
  `1` (per Microsoft's documented mapping, `1` = Enforce).
- The collected evidence strongly points to Smart App Control as the likely blocking mechanism, but
  this is an inference, not direct proof -- no retained Code Integrity/AppLocker event directly
  names Smart App Control and this specific argon2 binary as the blocker.
- No remediation has been performed: no Windows security setting has been changed, and no
  dependency/`node_modules` remediation has been performed. Further remediation is intentionally
  deferred pending explicit authorization.

**Step 4: Load testing on the voice path**
- [x] Decide the load-testing tool -- **Artillery**, explicitly approved. Selected because the
      milestone's intended load-testing scope spans two structurally different surfaces: Node/
      Express HTTP API endpoints (`apps/api`) and the Python/FastAPI `/twilio/media-stream`
      WebSocket path (`services/voice-agent`); Artillery supports both HTTP and WebSocket
      load-testing scenarios, allowing one framework to cover both rather than requiring two
      separate tools. Artillery ^2.0.34 has since been installed as a devDependency of a new,
      dedicated load-test npm workspace, added to the root workspaces array specifically for this
      purpose; no load-test scenario, script, or configuration has been created yet. This
      installation surfaced one new moderate dependency-audit finding, GHSA-8cw4-87c7-c6xx,
      affecting csv-parse <7.0.2 (a direct dependency of artillery@2.0.34). Source inspection
      found the vulnerable code path requires columns: true and group_columns_by_name: true to be
      set together, plus a crafted CSV row containing a duplicated __proto__ header; Artillery's
      own default options never set either flag, and the only path by which Artillery reaches
      csv-parse at all is its config.payload CSV-file-loading feature, which none of the approved
      Scenario A/B/C designs use. No remediation has been applied for this milestone.
      The following remain separate, still-undefined future decisions: the specific scenario(s)
      to test, concurrency levels, arrival/request rates, durations, ramp profile, latency/
      error-rate thresholds, and whether execution happens locally, in CI, or against a
      staging/production-like environment.
- [x] Define the specific voice-path scenario(s) to load-test -- three scenarios approved:
      - **Scenario A -- `/twilio/media-stream` concurrent connection lifecycle.** Concurrent
        WebSocket connections exercising: connection establishment; the `connected` message; the
        `start` message carrying a locally-minted, validly-signed call credential (mirroring
        `test_twilio_media_stream.py`'s existing signing approach); local HMAC credential
        verification; the resulting `run_session()` path far enough to exercise the real
        voice-agent/`apps/api` integration, including the internal `get_runtime_context` call;
        and clean client disconnect/cleanup. Uses the repository's default fake STT/LLM/TTS
        providers (`STT_PROVIDER`/`LLM_PROVIDER`/`TTS_PROVIDER` all default to `"fake"`) --
        deliberately does not generate real Deepgram/OpenAI/Cartesia traffic. Explicitly excludes
        full audio-frame exchange: no existing repository pattern exercises that depth, so this
        scenario stops at the connection/session-lifecycle level the current implementation and
        fake-provider setup actually support.
      - **Scenario B -- internal API under concurrent load.** `GET
        /internal/v1/organizations/:organizationId/runtime-context` against a real running
        `apps/api` instance backed by PostgreSQL, as the initial target: it requires both service
        authentication and organization authentication, uses the per-organization 1000/min
        internal rate-limit bucket, performs meaningful database-backed work (a 4-way concurrent
        read aggregation), and does not inherently require Google Calendar or another external
        provider. Exercises concurrent HTTP requests through the real API and the real
        PostgreSQL-backed rate limiter.
      - **Scenario C -- Stripe webhook first-row concurrency/race investigation.** Concurrent,
        locally-signed `customer.subscription.*` `POST /stripe/webhook` requests for the same
        brand-new subscription/customer pair with no existing `organization_subscriptions` row,
        using the repository's local HMAC signing mechanism and a test webhook secret (mirroring
        `stripe-webhook-route.test.ts`'s existing `sign()` helper) -- no real Stripe account or
        delivery involved. Purpose: determine whether the theoretical first-row ordering race
        documented in SECURITY.md §14 can actually be reproduced under concurrent execution, and
        if so, document its actual observed effect. This is a planned investigation only -- no
        race has been reproduced, and none is claimed to have been reproduced, by this entry.
      Explicitly out of scope for Step 4: Twilio-SMS webhook load testing, public `/organizations`
      API load testing, Google Calendar load testing, and any load testing intended to generate
      real third-party provider traffic. Still explicitly undefined and deferred to a later,
      separate approval for all three scenarios: concurrency levels, requests/second or
      WebSocket/HTTP arrival rate, test duration, ramp-up/ramp-down profile, latency thresholds,
      error-rate thresholds, exact pass/fail criteria, CI-vs-local execution, staging-vs-
      production-like execution, PostgreSQL sizing, and external-provider quotas. No Artillery
      configuration, script, or dependency has been created or installed for this entry.
- [x] Run the load test and record the results.
- [x] Document any concurrency/race findings the load test surfaces (e.g. against the
      already-documented, currently-unverified webhook first-row race in SECURITY.md §14).

**Step 4 implementation notes (Artillery load-test results):**
- **Scenario A -- media stream** (`arrivalRate: 2`, `maxVusers: 5`, `duration: 10s`): 16 VUs
  created, 16 completed, 0 failed, 4 skipped due to the `maxVusers` cap; 32 WebSocket messages
  sent; session length min 2008.7ms, max 3456ms, mean 2297ms, median 2059.5ms, p95/p99 3395.5ms;
  no WebSocket/HTTP errors. All 16 connections were accepted and all 16 call-credential
  verifications succeeded; `GET .../runtime-context` returned `200` 16 times; `POST .../calls`
  returned `201` 16 times -- a 1:1 finalization with no duplicate or missing calls.
- **Scenario B -- internal API** (`arrivalCount: 10` baseline): 10 VUs, 10 HTTP `200` responses,
  40 `expect`-plugin assertions passed; latency min 9ms, max 78ms, mean 20ms, median 13.9ms,
  p95/p99 16.9ms. Rate-limit bucket evidence (request ids 38-47) showed `ratelimit-remaining`
  decrementing monotonically from 999 to 990, confirming correct, non-racy per-organization
  bucket consumption under this burst. Tenant isolation was not exercised by this scenario (all
  requests used one organization's credential); the existing M14 Step 2 cross-organization
  isolation audit remains the relevant evidence for that property.
- **Scenario C -- Stripe webhook, batch 1** (`arrivalCount: 5`): the originally approved
  `duration: 0.5` was corrected to `duration: "500ms"` after Artillery 2.0.34 rejected the bare
  numeric value as an invalid phase duration before dispatching any request (a configuration
  defect, not an application-behavior finding). With the corrected duration, batch 1 ran: 4
  requests returned HTTP `200` and 1 returned HTTP `500`; latency min 17ms, max 190ms, mean 67ms,
  median 19.1ms, p95/p99 90.9ms (the `5xx` request was ~91ms). Exactly 4 `stripe_webhook_events`
  rows persisted -- the failed request's event was entirely absent, rolled back together with its
  transaction. **This run reproduced the documented SECURITY.md §14 first-row race**: the `500`
  was a real `duplicate key value violates unique constraint
  "organization_subscriptions_stripe_customer_id_unique"` error. The failure path rolled back
  cleanly and did not create a duplicate `organization_subscriptions` row. Duplicate-event
  idempotency was **not** tested by this batch (all five event ids were intentionally unique).
  Batches 2-5 of the originally planned five independent batches were intentionally not run after
  the race was reproduced, since remediation was prioritized over gathering further repetitions of
  the same already-confirmed finding.

**Step 4 implementation notes (real-PostgreSQL concurrency verification):**
- A remediation for the race reproduced above -- an organization-scoped PostgreSQL transaction
  advisory lock, `pg_advisory_xact_lock(hashtextextended(organizationId, 0))`, shared by both
  production first-row write paths (the Stripe webhook sync and `ensureStripeCustomer()`) -- was
  implemented in `apps/api/src/services/organization-lock.ts` and wired into
  `stripe-subscription-sync.service.ts`/`organization-subscription.service.ts`.
- Because every existing `stripe-subscription-sync.service.test.ts`/
  `organization-subscription.service.test.ts` suite runs against in-memory repositories with a
  no-real-transaction runner (by design -- see those files' own doc comments), none of them can
  prove real PostgreSQL transaction/advisory-lock behavior -- distinct from, and not a substitute
  for, the Artillery load-test results documented above. A dedicated real-PostgreSQL
  integration-test suite was added specifically to close that gap, kept deliberately separate
  from the fast unit-test suite:
  - New file `apps/api/tests/integration/organization-subscription-lock.integration.spec.ts`,
    run via a new, separate `apps/api/vitest.integration.config.ts` and a new `test:integration`
    npm script (root and `apps/api`) -- never part of the default `npm test`.
  - CI (`.github/workflows/ci.yml`) gained a disposable `postgres:17.11-alpine` service
    (matching the project's existing pinned dev-database version) in the `node` job only, with a
    `pg_isready`-based health check, a job-scoped `DATABASE_URL` pointing at a dedicated
    `ai_receptionist_ci_test` database, a step applying the existing Drizzle migrations
    (`npm run db:migrate -w apps/api`, no new migration created), and a step running
    `npm run test:integration` -- placed after the existing `npm run test` step and before
    `npm run build`, with the `voice-agent` and `secrets` jobs left untouched.
  - The suite uses the production lock function itself (`acquireOrganizationLock()`, unmodified)
    as its own deterministic concurrency barrier -- one test transaction manually holds the
    organization lock open while two real concurrent production calls are launched, confirms
    both are genuinely still blocked (proving the lock is real, not a no-op), then releases the
    hold and asserts the final database state. No sleep/timing-based race attempt is used.
  - Locally verified against the existing isolated M14 scratch PostgreSQL database
    (`m14-scratch-postgres`, port 5434, already migrated): `npm run db:migrate -w apps/api`
    completed successfully (schema already current, no-op); `npm run test:integration` passed
    4/4: (1) webhook vs. webhook -- two concurrent first-ever deliveries for the same
    organization produced exactly one `organization_subscriptions` row; (2) checkout/customer
    vs. checkout/customer -- two concurrent `ensureStripeCustomer()` calls produced exactly one
    row and the same Stripe customer id; (3) webhook vs. checkout/customer -- cross-path
    concurrency produced one consistent row with no cross-tenant leakage; (4) a direct sanity
    check confirming a second concurrent lock acquirer is genuinely blocked until the first
    releases.
  - These four tests prove the fix closes the specific race reproduced above, under the exact
    concurrency pattern each test constructs -- they are not a claim that every possible
    concurrency interleaving or load level has been verified.
  - No production locking code was changed by this verification work. No files were modified by
    running the migration/test commands themselves. Nothing has been staged, committed, or
    pushed.

**Step 5: Final verification**
- [ ] CI green with the new dependency-scanning and secret-scanning steps included -- the only
      remote evidence on record (GitHub Actions run `36578099571`) confirmed the three scanning
      mechanisms themselves but reported the overall workflow red for an unrelated, then-uncommitted
      typecheck issue; nothing has been pushed since the M14 Step 3/4 implementation changes, so
      there is no current end-to-end remote CI-green result to point to. Local evidence (822/822
      tests, 0 typecheck errors) is not a substitute for this item.
- [x] Cross-milestone tenant-isolation audit (Step 2) complete and documented, with any found gaps
      closed.
- [x] Rate limiting in place on the endpoints identified in Step 3, with passing tests.
- [x] Load test executed and results documented.
- [x] Documentation pass: `TASKS.md` completion status, `ARCHITECTURE.md`/`SECURITY.md` updates
      reflecting whichever approach was actually chosen and implemented for Steps 1, 3, and 4 --
      `SECURITY.md` §14's stale "advisory lock deferred" language was corrected to describe the
      implemented fix, §7's three resolved rate-limiting/CI-scanning gaps were struck through per
      the file's existing convention, and a new §16 documents the implemented rate limits and CI
      scanning mechanisms; `ARCHITECTURE.md` gained a new §18 documenting the rate-limiter,
      Stripe ordering, advisory-lock mechanism, and Artillery load-test setup.

## Future milestones

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for M15.
