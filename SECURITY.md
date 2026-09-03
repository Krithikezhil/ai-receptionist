# Security

Status: **M2 — Authentication**, building on M1. This document covers (a) the multi-tenant
isolation strategy this codebase commits to, (b) the authentication/session security design, and
(c) the security posture of what actually exists today. Full security hardening/testing is
milestone **M12** in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md); this document will keep
growing with each milestone that adds real attack surface (tenant data in M3, payment handling in
M11, etc.).

## 1. Multi-tenant isolation

Full detail and rationale live in [ARCHITECTURE.md §6](ARCHITECTURE.md#6-multi-tenancy). Summary
of the binding rules for every future milestone:

* Tenant = organization. Every org-scoped table gets a non-nullable, indexed `organization_id`.
* **The frontend is never the isolation boundary.** UI-level filtering is a UX convenience only;
  it must never be the only thing preventing cross-tenant access.
* Tenant context comes only from the authenticated session server-side, never from a
  client-supplied field. A caller cannot request another organization's `organization_id` and
  have it honored.
* All org-scoped queries go through a data-access layer that requires tenant context to run —
  not ad-hoc queries that individually remember to filter.
* PostgreSQL Row-Level Security is the defense-in-depth layer under the application-layer
  scoping, once real tables exist (M3+).
* Missing/invalid tenant context fails closed (zero rows), never open (all rows).
* No tenant-scoped data exists yet (M2 added `users`, but not organization-scoped) — the above is
  a binding design commitment for M3 onward, not a claim about current code.

## 2. Authentication and session security

Design rationale lives in [ARCHITECTURE.md §9](ARCHITECTURE.md#9-authentication). This section is
the authoritative list of what was actually built and verified.

### Backend security boundary (read this first)

**The backend is authoritative for authentication. The frontend is never the security boundary.**

* `apps/api/src/middleware/require-auth.ts` independently validates the session token
  server-side on every request to a protected endpoint (currently `GET /auth/me`). It does not
  trust the mere presence of a cookie — an invalid, forged, or expired token is rejected (401)
  regardless of what the cookie claims. This is proven by an automated test that sends a garbage
  cookie value directly to the API and confirms it's rejected (`apps/api/tests/auth.test.ts`).
* `apps/web`'s `/dashboard` page performs its own check by calling the API's `/auth/me` — but
  this exists purely for UX (avoiding rendering a page the user can't use). If that frontend
  check were removed, deleted, or bypassed entirely, the API would still refuse every protected
  request from an unauthenticated caller. No endpoint's real protection depends on frontend code
  running, existing, or being honest.

### Password storage

* **Argon2id** (via the `argon2` package), OWASP's current first-choice password hashing
  algorithm, using its library-default work factor (`m=65536,p=4,t=3`) — not a custom or
  weakened configuration.
* Passwords are never stored, logged, or returned in plaintext. Verified by an automated test
  that inspects the stored record directly and asserts it starts with `$argon2id$` and does not
  equal or contain the raw password.
* Passwords are additionally HMAC'd with `AUTH_SECRET` before hashing (a "pepper" — OWASP
  Password Storage Cheat Sheet's documented defense-in-depth technique, not custom cryptography).
  A database-only leak is insufficient to crack passwords offline without also having
  `AUTH_SECRET`.
* `AUTH_SECRET` has no code-level default and is required at process startup
  (`assertAuthSecret()` in `config/env.ts`, called from `server.ts` before the server accepts
  traffic) — fails closed instead of silently hashing with an insecure default.
* No API response ever includes a password hash field. Verified by automated tests that inspect
  the full JSON response body of register/login for any trace of `passwordHash`.

### Sessions

* Server-side ("database session") pattern: a high-entropy random token is generated per login;
  only its SHA-256 hash is persisted. A leaked database row cannot be used to authenticate.
* Session cookie attributes: `HttpOnly` (inaccessible to JavaScript — verified by an automated
  test inspecting the `Set-Cookie` header), `SameSite=Lax` (verified the same way), `Secure` when
  `NODE_ENV=production` (not testable as "always on" in this environment, since local dev
  correctly runs over plain HTTP — the conditional logic itself is straightforward and reviewed,
  not blindly trusted).
* Sessions expire after `SESSION_TTL_DAYS` (default 30) and are checked server-side on every use;
  an expired session is deleted and treated as unauthenticated rather than trusted.
* Logout deletes the session record server-side (not just clearing the cookie client-side) and is
  idempotent. Verified by an automated test: authenticate, confirm access, log out, confirm the
  same token no longer grants access.
* No long-lived auth secret is ever placed in `localStorage` or exposed to client-side JavaScript
  — the session token only exists in an `HttpOnly` cookie the browser manages automatically.

### Brute-force and enumeration resistance

* `POST /auth/login` returns the identical HTTP status (401) and error message
  (`"Invalid email or password."`) whether the email doesn't exist or the password is wrong.
  Verified by an automated test comparing both response bodies for equality.
* When the email doesn't exist, the login flow still runs a real Argon2 verify against a fixed
  dummy hash before failing, so response timing doesn't cheaply distinguish "no such account"
  from "wrong password."
* `POST /auth/register` **does** disclose "an account with this email already exists" (409) —
  a deliberate, standard UX trade-off (a legitimate user needs to be told to log in instead), not
  an oversight. Full registration-side enumeration resistance was judged not worth the UX cost for
  M2; login/credential-stuffing is the higher-value target this design protects.
* **Not implemented yet**: rate limiting / account lockout after repeated failed attempts. A
  determined attacker can currently attempt unlimited login guesses against a known email. This
  is the most significant near-term hardening gap — see §6.

### CSRF

* `SameSite=Lax` on the session cookie is the primary mitigation: genuinely cross-site requests
  (a form or script on another domain) do not carry the cookie, so they can't act as the
  authenticated user.
* **Not implemented**: a double-submit CSRF token for defense-in-depth beyond `SameSite`. Adequate
  for M2's scope (no state-changing, high-value actions exist yet beyond auth itself); revisit
  once M3+ adds real mutating endpoints — see §6.

### Input validation

* All auth request bodies are validated with `zod` (`apps/api/src/validation/auth.schemas.ts`)
  before touching business logic — rejected with 400 (register) before any database or hashing
  work happens. Login validation failures return 401 with the same generic message as bad
  credentials, so malformed input can't be used to distinguish anything.
* Password minimum length is 8 characters, no forced complexity rules — current NIST 800-63B
  guidance favors length over mandated character-class composition. No check against known-breach
  password lists yet (a reasonable future hardening item, not done in M2).

## 3. Secrets and environment variables

* No `.env` file exists in this repository and none was created during setup — only
  `.env.example`, which contains placeholders (empty strings or example/default-dev values),
  never real credentials. Verified via `git status`/`git check-ignore` before every commit.
* `.gitignore` excludes `.env`, `.env.local`, and `.env.*.local`, with an explicit
  `!.env.example` re-include so the template stays trackable.
* `apps/api`'s logger (`pino`, in `src/config/logger.ts`) redacts `req.headers.authorization` and
  `req.headers.cookie` from all log output. No code path logs environment variables, request
  bodies, or passwords wholesale — pino-http's default request serializer logs method/url/headers
  only, never the body, which is where a password would appear.
* `AUTH_SECRET` is the first genuinely required secret (see §2) — required at startup, no
  code-level default, generation instructions in `.env.example`.
* Placeholder variables for not-yet-built integrations (Stripe, Twilio, OpenAI, Deepgram,
  Cartesia, ElevenLabs, Google) remain in `.env.example` as empty values — documenting the future
  config surface without implying they're used anywhere yet.

## 4. Current attack surface

Being explicit about what exists so this section stays honest rather than aspirational:

* `apps/api`: `GET /health` (no auth, no sensitive data). `POST /auth/register`,
  `POST /auth/login`, `POST /auth/logout` (no auth required — that's the point). `GET /auth/me`
  (requires a valid session). `helmet` applies baseline security headers; `cors` restricts browser
  callers to `WEB_ORIGIN` with `credentials: true` (required for the session cookie to work
  across `apps/web`'s and `apps/api`'s different ports in local dev).
* `services/voice-agent` exposes exactly one route, `GET /health`, no auth.
* `apps/web` serves `/`, `/login`, `/register` (forms that call the API directly), and
  `/dashboard` (authenticated placeholder, no real data). No payment forms, no PII collection
  beyond email/password.
* Postgres has a real schema as of M2 (`users`, `sessions`) but has not been connected to in this
  environment (Docker unavailable) — see [DEPLOYMENT.md](DEPLOYMENT.md) and
  [ARCHITECTURE.md §7](ARCHITECTURE.md#7-data-layer).
* No third-party API keys are used by any code path yet.

## 5. Dependencies

* Dependency versions were checked against the npm registry at implementation time — see
  [ARCHITECTURE.md](ARCHITECTURE.md) and [TASKS.md](TASKS.md) for specifics (e.g. why TypeScript
  stayed on 5.9.x, why `apps/web` stayed on ESLint 9 while `apps/api`/`packages/shared` use
  ESLint 10, why Drizzle was chosen over Prisma, why `argon2` over `bcrypt`).
* `npm install` reported 0 vulnerabilities for the M1 dependency set.
* **New in M2**: `drizzle-kit@0.31.10` (the current latest release) has a transitive dependency on
  a deprecated, vulnerable `@esbuild-kit/esm-loader` (`npm audit` reports 4 moderate advisories
  under it). This is a **devDependency only** — never shipped in the running API — used solely to
  transpile `drizzle.config.ts` when generating migrations locally. The underlying advisory
  concerns an exposed esbuild dev-server, which this loader does not start for one-shot config
  loading. No newer `drizzle-kit` release fixes this yet; forcing a downgrade (as `npm audit fix
  --force` suggests) would move to an old, likely-incompatible version. Tracked as a known
  limitation to revisit (§6), not treated as a runtime security issue.
* `argon2` (ranisalt/node-argon2) confirmed actively maintained (published within the last two
  months at implementation time) and installs cleanly on this Windows dev machine via prebuilt
  binaries (no native build toolchain required).

## 6. Known gaps (expected at this stage — see TASKS.md)

* **No rate limiting or account lockout** on `/auth/login` or `/auth/register` — the most
  significant near-term hardening item. Recommend adding before any production traffic.
* **No CSRF token** beyond `SameSite=Lax` — acceptable for M2's limited mutating surface, should
  be revisited once M3 adds real state-changing endpoints.
* **No email verification** — an account is usable immediately after registration with an
  unverified email address.
* **No password reset flow** — a user who forgets their password currently has no recovery path.
* **No MFA.**
* **No CI-enforced security scanning** (`npm audit`, `pip-audit`, secret scanning) — planned for
  M12.
* **No dependency-update automation** (Dependabot/Renovate) configured yet.
* **Postgres/session-store integration is untested against a real database** — Docker unavailable
  in this environment; verified instead via in-memory repository test doubles exercising the same
  interfaces (see [ARCHITECTURE.md §9](ARCHITECTURE.md#9-authentication)).
