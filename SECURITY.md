# Security

Status: **M5 — Voice/AI runtime foundation**, building on M1–M4. This document covers (a) the
multi-tenant isolation strategy and what actually enforces it, (b) the authentication/session
security design, (c) the M5 service-to-service authentication design (§8), and (d) the security
posture of what actually exists today. Full security hardening/testing is milestone **M14** in
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md); this document keeps growing with each milestone
that adds real attack surface (payment handling in M13, etc.).

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
* **M5 addition**: `/internal/v1/...` (the service-to-service voice API) uses a two-stage
  service-to-service trust model, not membership-based: `INTERNAL_SERVICE_KEY` establishes that
  the caller is a trusted internal service at all, and a separate, per-organization
  `X-Organization-Service-Token` establishes which specific organization that request is
  authorized for — re-verified against a stored hash on every request, the same "never trust the
  id merely because it's present" pattern `requireOrgMembership` uses above, just keyed by a
  token hash instead of a membership row. A token issued for one organization is rejected (403)
  for any other. See §8.

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

**M5 additions** (`apps/api/tests/internal-api.test.ts`), all passing, covering both the global
service-auth boundary and the per-organization tenant-authorization boundary:

* Valid global service credential + that organization's own `X-Organization-Service-Token` + a
  real organization → 200 with that organization's own data.
* A token issued for organization A does **not** authorize organization B: presenting
  organization A's `X-Organization-Service-Token` against organization B's URL → 403, even with
  a valid global key — verified for both `runtime-context` and `knowledge`, and again after
  freshly creating a third organization, confirming organization A's token authorizes only its
  own id.
* Missing organization context (no `:organizationId` path segment) → 404 (no route match).
* A nonexistent organization id → 404, for both `runtime-context` and `knowledge`.
* A disabled receptionist configuration → still 200 with `enabled: false` in the payload — the API
  reports state accurately rather than gating on it; the voice-agent is expected to check `enabled`
  itself before starting a session.
* An invalid, missing, wrong-scheme, or wrong-length global service credential → 401 in every
  case, including a dedicated test that a wrong-*length* key hits the explicit length-guard path
  rather than crashing `crypto.timingSafeEqual` into the generic 500 handler.
* A missing, wrong, or wrong-length `X-Organization-Service-Token` (with a valid global key) →
  403 in every case, via the same explicit length-guard pattern.
* Cross-auth isolation: a valid service bearer token does not authorize `/organizations/...`, and a
  valid session cookie does not authorize `/internal/v1/...` — the two mechanisms are proven
  mutually exclusive, not just independently correct.
* Credential issuance/storage: the raw organization token is returned exactly once, at
  organization-creation time; only its SHA-256 hash is ever persisted; and neither the token nor
  the hash appears in any other response (`GET`/list organizations, the public
  receptionist-config endpoint, or the internal runtime-context response itself).

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
* `AUTH_SECRET` and, as of M5, `INTERNAL_SERVICE_KEY` (see §8) are the two genuinely required
  secrets — both required at startup, neither has a code-level default, both have generation
  instructions in `.env.example`.
* `INTERNAL_SERVICE_KEY` is sent as a standard `Authorization: Bearer` header specifically so it's
  covered by the existing `req.headers.authorization` pino redaction with zero logger changes —
  see §8.
* Placeholder variables for not-yet-built integrations (Stripe, Twilio, Google) remain in
  `.env.example` as empty values. OpenAI/Deepgram/Cartesia/ElevenLabs keys are also still
  placeholders — M5 built the *abstraction* for real provider wiring (§8's cross-referenced
  ARCHITECTURE.md §12.5), but no automated test or CI step ever supplies a real key or makes a live
  call to any of them.

## 5. Current attack surface

Being explicit about what exists so this section stays honest rather than aspirational:

* `apps/api`: `GET /health` (no auth). Auth endpoints (`POST /auth/register|login|logout`,
  `GET /auth/me`) — see §2. Organization endpoints (`POST/GET /organizations`,
  `GET/PATCH /organizations/:organizationId`, business-profile/business-hours/services/knowledge/
  receptionist-config sub-resources) — all require authentication, and all but creation/listing
  additionally require verified membership. `helmet` applies baseline security headers; `cors`
  restricts browser callers to `WEB_ORIGIN` with `credentials: true`.
* `services/voice-agent` exposes exactly one HTTP route, `GET /health`, no auth (unchanged from
  M1 — no new public routes were added by M5). It now calls `apps/api`'s `/internal/v1/...`
  endpoints (service-authenticated — see §8) via `clients/api_client.py`, and has a Pipecat
  pipeline (`pipeline.py`) that is constructed per-session, not exposed as an HTTP endpoint of its
  own. The only way to actually run a session in M5 is the manual, non-CI `bot.py` entry point
  (real STT/LLM/TTS provider keys required to be meaningful; the default "fake" providers make it
  inert) — there is still no way to reach the voice-agent from outside the local machine.
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
* **M5** adds `pipecat-ai` (pinned `>=1.8.1,<1.9.0` — its frame/context APIs have already had
  breaking changes across versions, e.g. the `LLMContext`/`FunctionCallParams` model replacing an
  older OpenAI-specific context class, so an open version range would be unsafe) with only the
  `cartesia`/`deepgram`/`openai` extras actually referenced by the provider factory, plus `httpx`
  (promoted from dev to a runtime dependency for the internal-API client). Dev-only additions:
  `pytest-asyncio`, `respx` (HTTP mocking for tests), `pipecat-ai-small-webrtc-prebuilt` (browser
  client for the manual, non-CI smoke test only). No dependency was added to `apps/api` for M5 —
  the internal router reuses existing Express/zod/crypto (Node built-in) machinery.

## 7. Known gaps (expected at this stage — see TASKS.md)

* **No rate limiting or account lockout** on `/auth/login` or `/auth/register` — the most
  significant near-term hardening item, now joined by the M3 mutating endpoints as additional
  surface that would benefit from it.
* **No CSRF token** beyond `SameSite=Lax` — M3 adds real mutating endpoints, raising the value of
  this hardening item for M14.
* **No PostgreSQL Row-Level Security** — application-layer scoping (`requireOrgMembership` +
  per-query `organizationId` filtering) is the only enforcement currently in place. RLS would be a
  genuine defense-in-depth addition, not a currently-missing requirement (the application-layer
  checks are independently tested and sufficient on their own).
* **No email verification, no password reset flow, no MFA.**
* **No fine-grained RBAC** — any membership (`owner` or `member`) currently grants full read/write
  access to that organization's profile/hours/services/knowledge/receptionist-config. The `role`
  column exists for a future milestone to use; M3/M4 deliberately don't build on it yet
  (explicitly out of scope per both briefs) — unchanged from M3, not a new gap introduced by M4.
* ~~No service-to-service authentication for the future voice agent~~ — **resolved in M5**, see
  §8. What remains open, carried forward as new/updated gaps below:
* **Neither M5 service credential (`INTERNAL_SERVICE_KEY` nor a per-organization
  `X-Organization-Service-Token`) has automated rotation.** Rotating the global key requires a
  manual, coordinated restart of both services. A leaked organization token is worse: M5 has no
  reissue/rotation endpoint for it at all, so recovering from a leaked one currently requires a
  direct database update. Deliberately accepted for this foundation milestone (§8); a self-service
  rotation/reissue endpoint is deferred until a real rotation requirement exists.
* **No rate limiting on `/internal/v1/...`** either — same pre-existing, already-documented gap as
  `/auth/*`, not newly introduced by M5.
* **Pipecat/provider dependency surface: construction paths are tested, live calls are not** — M6
  added unit tests that construct each real provider class (`DeepgramSTTService`/
  `OpenAILLMService`/`CartesiaTTSService`) with dummy credentials to verify correct wiring
  (model/voice selection, fail-closed configuration), still with zero real API calls anywhere in
  CI (ARCHITECTURE.md §13.1/§13.5); an actual live conversation is the outstanding real-provider
  manual verification gate — see TASKS.md.
* **Knowledge search is a simple substring match only** — no Postgres full-text search
  (`tsvector`), no embeddings, no vector database, no external search service. Sufficient at this
  scale; explicitly not a step toward RAG (see ARCHITECTURE.md §11 on how a future RAG milestone
  would extend the schema additively instead).
* **No CI-enforced security scanning** (`npm audit`, `pip-audit`, secret scanning) — planned for
  M14.
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

## 8. Service-to-service authentication (M5)

Design rationale lives in [ARCHITECTURE.md §12.2](ARCHITECTURE.md#122-service-to-service-authentication).
This section is the authoritative security summary.

M5 uses **two independent credentials, checked in sequence**; neither alone establishes tenant
authorization:

1. `INTERNAL_SERVICE_KEY` — a single, global, static credential proving the caller is a trusted
   internal service at all (`apps/api/src/middleware/require-service-auth.ts`).
2. `X-Organization-Service-Token` — a separate, per-organization credential proving the request
   is authorized for the *specific* `:organizationId` in the URL
   (`apps/api/src/middleware/require-organization-service-token.ts`).

### 8.1 Global credential (`INTERNAL_SERVICE_KEY`)

* **Format**: a single static, long (32-byte / 256-bit), random, opaque bearer token — not a
  JWT, not mTLS, not OAuth2 client-credentials. Sent as `Authorization: Bearer <token>`.
* **Generation**: a one-time manual operator step (`openssl rand -hex 32`), never generated by
  application code at runtime.
* **Storage**: the `INTERNAL_SERVICE_KEY` environment variable, identically valued on both
  `apps/api` and `services/voice-agent`. Same handling as `AUTH_SECRET` — never in Postgres,
  never committed, no code-level default.
* **Validation**: `require-service-auth.ts` extracts the bearer token, length-checks it against
  the configured key, then compares with `crypto.timingSafeEqual` (only if lengths already
  match, since `timingSafeEqual` throws on a length mismatch rather than returning `false`).
  First use of `timingSafeEqual` in this codebase; justified because this key is compared
  directly in application code on every request, unlike the session token (looked up by
  equality inside Postgres). Exported as `safeCompare()` and reused by the per-organization
  check below.
* **Scope**: proves "a trusted internal service," nothing about *which* organization — see §8.2
  for what actually authorizes a specific organization.
* **Revocation/rotation**: manual only. An operator generates a new value and updates it on both
  services, then restarts both. No dual-key/grace-period support — rotation causes a brief
  availability gap unless both restarts are coordinated. No automatic expiry/TTL.
* **Unauthorized behavior**: missing header, non-`Bearer` scheme, wrong-length key, and
  right-length-but-wrong key all produce an identical `401 { "error": "Not authenticated." }` —
  no distinction is leaked between failure modes. Verified by dedicated tests
  (`apps/api/tests/internal-api.test.ts`).

### 8.2 Per-organization credential (`X-Organization-Service-Token`)

* **Format**: a per-organization, long (32-byte / 256-bit), random, opaque token, generated once
  inside the same database transaction as organization creation
  (`src/auth/organization-service-token.ts#generateOrganizationServiceToken`,
  `crypto.randomBytes(32).toString("hex")`).
* **Storage**: only its SHA-256 hash is persisted, in
  `organization_service_credentials.token_hash` — the same hashed-credential discipline already
  used for session tokens (`sessions.id`). A leaked database row cannot be used to authenticate.
  `organization_id` is the table's PRIMARY KEY, so exactly one credential exists per
  organization, enforced at the database level, not just in application code.
* **Exposure**: the raw token is returned to the caller **exactly once**, in the response body
  of `POST /organizations` (organization creation) — never persisted in plaintext anywhere,
  never logged, and never returned by any other endpoint (`GET`/list/update organizations, the
  public receptionist-config endpoint, or the internal `runtime-context`/`knowledge` responses
  themselves). Verified by dedicated tests asserting the raw token and the word `tokenHash`
  never appear in any of those response bodies.
* **Validation**: `require-organization-service-token.ts`, mounted *after* `requireServiceAuth`
  on every `/internal/v1/organizations/:organizationId/...` route. It looks up the stored hash
  for the URL's `:organizationId`, hashes the presented `X-Organization-Service-Token`, and
  compares it with the same `safeCompare()` constant-time helper used for the global key.
* **This is what actually authorizes a specific organization** — not the global key. A token
  issued for organization A is checked only against organization A's stored hash; presenting it
  against any other organization's URL fails, because that other organization's stored hash is
  different. This is independently re-verified against the database on every request — the same
  "never trust the id merely because it's present in the URL" pattern `requireOrgMembership`
  uses for user sessions (§1), just keyed by a token hash instead of a membership row.
* **Response codes**: three-tiered, distinct from the global key's 401 — `404` if the
  organization doesn't exist at all (no credential row, non-enumeration convention); `403` if
  the organization exists but the presented token is missing, wrong-length, or simply wrong for
  that organization. Verified by tests covering same-org success, cross-org denial (organization
  A's token against organization B's and a freshly created organization C's URLs), a missing
  token, a wrong token, and a wrong-length token via the explicit length-guard path.
* **Revocation/rotation**: manual only, and more limited than the global key — M5 has no
  reissue/rotation endpoint for a compromised organization token; recovering from a leaked token
  currently requires a direct database update. Deliberately accepted as a known gap for this
  foundation milestone (see §7), not an oversight.

### 8.3 Combined model

* **Neither credential alone establishes tenant authorization.** A valid `INTERNAL_SERVICE_KEY`
  with no organization token, or with the wrong organization's token, is rejected (403) before
  reaching any organization data — see §8.2. A correct organization token without a valid global
  key never reaches the tenant check at all — `requireServiceAuth` runs first and 401s.
* **Isolation from user auth**: a valid service credential (either or both) does not authorize
  `/organizations/...` (user-only routes), and a valid session cookie does not authorize
  `/internal/v1/...` (service-only routes) — verified by an explicit cross-auth test, not
  assumed from the two middleware chains being separately correct.
* **Logging**: both credentials are covered by `config/logger.ts`'s redaction —
  `INTERNAL_SERVICE_KEY` via the standard `req.headers.authorization` entry (no logger change
  needed, since it's sent under the standard header name), and `X-Organization-Service-Token`
  via an explicit `req.headers["x-organization-service-token"]` entry added specifically for it
  (bracket notation is required because fast-redact rejects hyphens in dot-path syntax). No test
  found either raw value in any log output or HTTP response body.

## 9. Voice runtime session lifecycle and failure handling (M6)

Design rationale lives in [ARCHITECTURE.md §13](ARCHITECTURE.md#13-real-ai-voice-runtime-m6). This
is the authoritative security summary for `session.py`'s lifecycle handling.

* **Idle timeout**: `VOICE_AGENT_IDLE_TIMEOUT_SECS` (default 45s), validated at startup — a
  malformed or non-positive value raises `ConfigurationError` rather than silently falling back
  to an unvalidated value. Keyed to actual caller speech only, not general pipeline/bot activity,
  and not conflated with an overall session-duration cap (none exists). On timeout, the session
  speaks the receptionist's own configured `fallbackMessage` exactly once and ends — guaranteed
  by an idempotency guard in `session.py`: Pipecat's own idle-timeout monitor loop re-arms itself
  on a fixed interval regardless of whether the first `end()` call has finished (the framework's
  behavior, not something `session.py` controls), so without the guard a very short configured
  timeout combined with a slow-draining transport could in principle invoke the handler a second
  time before the first one finishes. The guard makes a second firing a safe no-op — logged, but
  no second fallback message and no second `end()` call — verified directly by a dedicated test
  (`test_session.py`), not just reasoned about.
* **Provider/pipeline failure**: `processor_unusable_policy=ProcessorUnusablePolicy.END` — a
  provider SDK or any other processor becoming unusable ends the session gracefully rather than
  looping or hanging. `session.py`'s own error handler never attempts to end/cancel the session or
  retry itself; it only logs safe, structural metadata and lets Pipecat's own policy drive
  termination.
* **Client disconnect**: cancels the session rather than attempting a graceful drain — there is no
  client left to receive drained audio.
* **Cleanup**: relies on `ApiClient`'s existing async-context-manager protocol (`async with
  api_client:`, unchanged since M5), not a separate cleanup helper — `close()` is guaranteed to
  run exactly once on every exit path.
* **Logging**: `logging_config.py` is the sole logging entry point for `session.py`, with a
  documented never-log list (credentials, headers, conversation content, tool arguments/results,
  raw request/response bodies, raw exception text) — a reviewed convention enforced by code review
  at one call site, not an automatic filter.
* **Tenant isolation**: `search_knowledge` remains scoped to the organization id bound once at
  session start; a spoofed `organizationId`/`organization_id` supplied in tool-call arguments has
  no effect on which organization is queried — re-verified by a dedicated test in M6.
* **What did not change**: the M5 two-credential model (§8) and the "voice-agent never touches
  Postgres directly" boundary are untouched by this milestone.
