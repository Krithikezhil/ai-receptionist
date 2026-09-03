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

## Future milestones

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for M3 through M13.
