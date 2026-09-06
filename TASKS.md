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

## Future milestones

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for M8 through M15.
