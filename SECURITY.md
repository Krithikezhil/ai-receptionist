# Security

Status: **M4 — Business knowledge and AI receptionist configuration**, building on M1–M3. This
document covers (a) the multi-tenant isolation strategy and what actually enforces it, (b) the
authentication/session security design, and (c) the security posture of what actually exists
today. Full security hardening/testing is milestone **M13** in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md); this document keeps growing with each milestone
that adds real attack surface (payment handling in M12, etc.).

## 1. Multi-tenant isolation

Full detail and rationale live in [ARCHITECTURE.md §6](ARCHITECTURE.md#6-multi-tenancy), §10, and
§11. Binding rules, and their implementation status:

* Tenant = organization. Every org-scoped table gets a non-nullable, indexed `organization_id`.
  **Implemented** for `business_profiles`, `business_hours`, `services`, `knowledge_entries`,
  `receptionist_configurations`.
* **The frontend is never the isolation boundary.** UI-level filtering is a UX convenience only;
  it must never be the only thing preventing cross-tenant access. **Implemented and tested** — see
  §3.
* The organization named in a request is never trusted merely because it's present — access is
  independently re-authorized against the database on every request
  (`requireOrgMembership` middleware). A caller cannot access, read, or write another
  organization's data by naming its id, in the URL or anywhere else. **Implemented and tested.**
* All org-scoped queries go through a data-access layer that requires an `organizationId` argument
  to compile/run, and every id-based lookup/update/delete filters by `organizationId` in the same
  query — not ad-hoc queries that individually remember to filter. **Implemented.**
* PostgreSQL Row-Level Security as defense-in-depth under the application-layer scoping —
  **not implemented yet**. The application-layer scoping above is the only enforcement currently
  in place. See §7 known gaps.
* Missing/invalid tenant context fails closed (404, not a leaked "forbidden" that confirms
  existence, and never an unscoped query returning everything). **Implemented and tested.**
* Duplicate memberships for the same `(organization, user)` pair are rejected (unique constraint
  in the migration; the in-memory test double mirrors the same behavior since Postgres itself is
  unverified — see §6). **Implemented and tested.**

## 2. Authentication and session security

Design rationale lives in [ARCHITECTURE.md §9](ARCHITECTURE.md#9-authentication). This section is
the authoritative list of what was actually built and verified.

### Backend security boundary (read this first)

**The backend is authoritative for authentication and authorization. The frontend is never the
security boundary — for auth or for tenant access.**

* `apps/api/src/middleware/require-auth.ts` independently validates the session token
  server-side on every request to a protected endpoint. It does not trust the mere presence of a
  cookie — an invalid, forged, or expired token is rejected (401) regardless of what the cookie
  claims. Proven by an automated test that sends a garbage cookie value directly to the API and
  confirms it's rejected (`apps/api/tests/auth.test.ts`).
* `apps/api/src/middleware/require-org-membership.ts` independently re-verifies, against the
  database, that the authenticated user actually belongs to the organization named in the URL —
  on every single request, for every organization-scoped endpoint. See §3.
* `apps/web`'s `/dashboard` page performs its own auth check (calling the API's `/auth/me`) and
  simply displays whatever organizations the API says the user belongs to — but this exists purely
  for UX. If all frontend checks were removed, deleted, or bypassed entirely, the API would still
  independently refuse every unauthenticated request and every request naming an organization the
  caller isn't a member of. No endpoint's real protection depends on frontend code running,
  existing, or being honest.

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
  an oversight.
* Organization-scoped endpoints return the same 404 whether an organization doesn't exist or the
  caller just isn't a member of it — a non-member can't use these endpoints to enumerate which
  organization ids exist. See §1.
* **Not implemented yet**: rate limiting / account lockout after repeated failed attempts. A
  determined attacker can currently attempt unlimited login guesses against a known email. This
  remains the most significant near-term hardening gap — see §7.

### CSRF

* `SameSite=Lax` on the session cookie is the primary mitigation: genuinely cross-site requests
  (a form or script on another domain) do not carry the cookie, so they can't act as the
  authenticated user. This now also covers every M3 mutating endpoint (organization/profile/
  hours/services writes), not just auth.
* **Not implemented**: a double-submit CSRF token for defense-in-depth beyond `SameSite`. M3 adds
  real mutating endpoints (business profile, hours, services), which raises the value of this
  hardening item — see §7.

### Input validation

* All auth and organization request bodies are validated with `zod`
  (`apps/api/src/validation/auth.schemas.ts`, `organization.schemas.ts`) before touching business
  logic. Login validation failures return 401 with the same generic message as bad credentials, so
  malformed input can't be used to distinguish anything.
* Password minimum length is 8 characters, no forced complexity rules — current NIST 800-63B
  guidance favors length over mandated character-class composition. No check against known-breach
  password lists yet (a reasonable future hardening item).
* Business hours validation requires all 7 days present exactly once, and that open days have
  `openTime < closeTime`, rejecting malformed schedules before they reach the database.

## 3. Tenant isolation testing

This is the most safety-critical part of M3/M4, so it gets its own section rather than being
folded into §1. `apps/api/tests/organizations.test.ts` (M3), `knowledge.test.ts`, and
`receptionist-config.test.ts` (M4) all exercise the **real HTTP layer** (Supertest against the
full Express app, including both `requireAuth` and `requireOrgMembership` middleware) — not the
service layer in isolation, so the tests prove what an actual attacker would experience, not just
what the code is intended to do. Verified scenarios in `organizations.test.ts`, each an automated,
passing test:

1. An unauthenticated request to an organization endpoint is rejected (401).
2. An authenticated user can access an organization they created (200).
3. A user added as a plain `"member"` (not `"owner"`) can access the organization they belong to
   (200) — membership alone is sufficient, no owner-only gate blocks ordinary members.
4. A user who does not belong to an organization cannot access it by naming its real id (404).
5. **Changing the organization id in a request cannot bypass authorization**: an outsider who has
   their own, different organization attempts to `PATCH` another organization's real id directly
   — rejected (404), and the target organization's data is confirmed unchanged afterward.
6. A user cannot read another organization's business profile (404).
7. A user cannot modify another organization's business profile (404), and the profile is
   confirmed unchanged in the repository directly (not just via the rejected response).
8. A user cannot list another organization's services (404).
9. A user cannot modify or delete another organization's service (404 on both), and the service is
   confirmed still present and unmodified afterward.
10. Duplicate memberships for the same `(organization, user)` pair are rejected.
11. Organization creation produces *exactly* one membership for the creator, with `role: "owner"`
    — checked by listing all memberships for that user and asserting there's exactly one, not just
    that an owner membership exists somewhere.
12. **A spoofed `organizationId` in a request body cannot orphan a record into another
    organization**: an outsider POSTs a new service to their *own* organization's URL while
    including a different (victim) organization's id in the request body. The created service is
    confirmed to belong to the URL's organization — the body-supplied id has no effect, and the
    victim organization's service list is confirmed not to contain it.

Additional coverage beyond the 12 required scenarios: full CRUD happy-path tests for business
profile, business hours (including rejecting a hours payload missing a day), and services
(create/update/delete), plus a check that `GET /organizations` only ever lists organizations the
caller actually belongs to.

**M4 additions** (`knowledge.test.ts`, `receptionist-config.test.ts`), the exact same isolation
requirements applied to the two new resource types, all passing:

* Unauthenticated access to either resource type is rejected (401).
* A non-member cannot list, read, modify, or delete another organization's knowledge entries
  (404 on every verb), confirmed unchanged via direct repository checks afterward.
* A non-member cannot read or modify another organization's receptionist configuration (404),
  confirmed the target config's `enabled`/`displayName` are unchanged afterward — specifically
  including an attempt to flip `enabled: true` on a victim organization's configuration, which is
  rejected exactly like any other cross-tenant write.
* Changing the organization id in the request path cannot bypass authorization for either
  resource type.
* A spoofed `organizationId` in a knowledge-creation request body cannot orphan the entry into
  another organization — verified the created entry belongs to the URL's organization and does
  not appear in the victim organization's list.
* Organization creation seeds exactly one receptionist configuration, and it is always `enabled:
  false` with the documented deterministic defaults (`displayName: "AI Receptionist"`, etc.) —
  checked via both the creation response and a direct repository read.
* The receptionist-config response body contains no vendor/provider-shaped keys (`provider`,
  `apiKey`, `model`) — a lightweight assertion that the provider-agnostic design constraint is
  actually reflected in what the API returns, not just in the schema.

## 4. Secrets and environment variables

* No `.env` file exists in this repository and none was created during setup — only
  `.env.example`, which contains placeholders (empty strings or example/default-dev values),
  never real credentials. Verified via `git status`/`git check-ignore` before every commit.
* `.gitignore` excludes `.env`, `.env.local`, and `.env.*.local`, with an explicit
  `!.env.example` re-include so the template stays trackable.
* `apps/api`'s logger (`pino`, in `src/config/logger.ts`) redacts `req.headers.authorization` and
  `req.headers.cookie` from all log output. No code path logs environment variables, request
  bodies, or passwords wholesale — pino-http's default request serializer logs method/url/headers
  only, never the body.
* `AUTH_SECRET` is the only genuinely required secret (see §2) — required at startup, no
  code-level default, generation instructions in `.env.example`.
* Placeholder variables for not-yet-built integrations (Stripe, Twilio, OpenAI, Deepgram,
  Cartesia, ElevenLabs, Google) remain in `.env.example` as empty values.

## 5. Current attack surface

Being explicit about what exists so this section stays honest rather than aspirational:

* `apps/api`: `GET /health` (no auth). Auth endpoints (`POST /auth/register|login|logout`,
  `GET /auth/me`) — see §2. Organization endpoints (`POST/GET /organizations`,
  `GET/PATCH /organizations/:organizationId`, business-profile/business-hours/services/knowledge/
  receptionist-config sub-resources) — all require authentication, and all but creation/listing
  additionally require verified membership. `helmet` applies baseline security headers; `cors`
  restricts browser callers to `WEB_ORIGIN` with `credentials: true`.
* `services/voice-agent` exposes exactly one route, `GET /health`, no auth. It does not call any
  of the M4 organization endpoints yet — the "future voice-agent contract" (ARCHITECTURE.md §11)
  is documented but not wired up to this service.
* `apps/web` serves `/`, `/login`, `/register`, and `/dashboard` (real organization creation,
  business-profile/hours/services configuration, knowledge-base management, and receptionist
  configuration UI — no mocked data, no fake product features). No payment forms, no PII
  collection beyond email/password/business contact info.
* Postgres has a real schema (`users`, `sessions`, `organizations`, `organization_memberships`,
  `business_profiles`, `business_hours`, `services`, `knowledge_entries`,
  `receptionist_configurations`) but **has not been connected to in this environment** (Docker
  unavailable) — see [DEPLOYMENT.md](DEPLOYMENT.md) and
  [ARCHITECTURE.md §7](ARCHITECTURE.md#7-data-layer).
* No third-party API keys are used by any code path yet. The receptionist configuration schema is
  deliberately provider-agnostic (no model/voice/API-key columns) — verified by an automated test
  asserting the API response contains no such keys, not just by reviewing the schema.

## 6. Dependencies

* Dependency versions were checked against the npm registry at implementation time — see
  [ARCHITECTURE.md](ARCHITECTURE.md) and [TASKS.md](TASKS.md) for specifics.
* `npm install` reported 0 vulnerabilities for the M1 dependency set.
* `drizzle-kit@0.31.10` (the current latest release) has a transitive dependency on a deprecated,
  vulnerable `@esbuild-kit/esm-loader` (`npm audit` reports 4 moderate advisories under it). This
  is a **devDependency only** — never shipped in the running API — used solely to transpile
  `drizzle.config.ts` when generating migrations locally. The underlying advisory concerns an
  exposed esbuild dev-server, which this loader does not start for one-shot config loading. No
  newer `drizzle-kit` release fixes this yet. Tracked as a known limitation, not a runtime issue.
* `argon2` (ranisalt/node-argon2) confirmed actively maintained and installs cleanly on this
  Windows dev machine via prebuilt binaries.
* No new runtime dependencies were added in M3 or M4 (knowledge/receptionist-config uses the same
  Drizzle/zod/Express stack already in place from M1/M2) — deliberately, per the "avoid
  unnecessary dependencies" instruction. No search library, no vector database client, no
  embeddings SDK.

## 7. Known gaps (expected at this stage — see TASKS.md)

* **No rate limiting or account lockout** on `/auth/login` or `/auth/register` — the most
  significant near-term hardening item, now joined by the M3 mutating endpoints as additional
  surface that would benefit from it.
* **No CSRF token** beyond `SameSite=Lax` — M3 adds real mutating endpoints, raising the value of
  this hardening item for M13.
* **No PostgreSQL Row-Level Security** — application-layer scoping (`requireOrgMembership` +
  per-query `organizationId` filtering) is the only enforcement currently in place. RLS would be a
  genuine defense-in-depth addition, not a currently-missing requirement (the application-layer
  checks are independently tested and sufficient on their own).
* **No email verification, no password reset flow, no MFA.**
* **No fine-grained RBAC** — any membership (`owner` or `member`) currently grants full read/write
  access to that organization's profile/hours/services/knowledge/receptionist-config. The `role`
  column exists for a future milestone to use; M3/M4 deliberately don't build on it yet
  (explicitly out of scope per both briefs) — unchanged from M3, not a new gap introduced by M4.
* **No service-to-service authentication for the future voice agent** — the M4 "voice-agent
  contract" (ARCHITECTURE.md §11) is a set of REST endpoints that reuse the existing
  user-authenticated `requireAuth`/`requireOrgMembership` middleware. There is currently no way
  for a non-interactive backend service (the future Python voice runtime) to call them without a
  real user session. Deliberately deferred, not an oversight — designing credential
  issuance/rotation/scope for inter-service auth is real security work for the milestone that
  actually wires up the voice runtime, not a bolt-on here.
* **Knowledge search is a simple substring match only** — no Postgres full-text search
  (`tsvector`), no embeddings, no vector database, no external search service. Sufficient at this
  scale; explicitly not a step toward RAG (see ARCHITECTURE.md §11 on how a future RAG milestone
  would extend the schema additively instead).
* **No CI-enforced security scanning** (`npm audit`, `pip-audit`, secret scanning) — planned for
  M13.
* **No dependency-update automation** (Dependabot/Renovate) configured yet.
* **Postgres integration is untested against a real database** — Docker unavailable in this
  environment (a local, unrelated Postgres instance was found listening on `localhost:5432` and
  was deliberately not used — see ARCHITECTURE.md §7); verified instead via in-memory repository
  test doubles exercising the same interfaces (see [ARCHITECTURE.md §9](ARCHITECTURE.md#9-authentication)
  / §10 / §11). Specifically unverified: the real unique constraints (`slug`,
  `(organization_id, user_id)`, `(organization_id, day_of_week)`), the real foreign-key cascade
  deletes, and real transaction rollback behavior for organization creation (the in-memory
  `UnitOfWork` does not actually roll back partial writes on failure, unlike the Postgres
  implementation's real `db.transaction()`).
* **Slug collision handling has a theoretical race condition**: concurrent creation of two
  organizations with the same name could both pass the in-application collision check before
  either commits. The database's unique constraint on `slug` is the real backstop, but a race
  would currently surface as a 500 rather than a graceful retry. Not fixed in M3 (acceptable at
  current scale); worth revisiting if organization creation becomes high-throughput.
