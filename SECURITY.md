# Security

Status: **M1 — Foundation**. This document covers (a) the multi-tenant isolation strategy this
codebase commits to, and (b) the security posture of what actually exists in M1. Full security
hardening/testing is milestone **M12** in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md); this
document will grow with each milestone that adds real attack surface (auth in M2, tenant data in
M3, payment handling in M11, etc.).

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
* No tenant-scoped data exists yet in M1, so none of the above is implemented in code yet — it is
  a binding design commitment for M3 onward, not a claim about current code.

## 2. Secrets and environment variables

* No `.env` file exists in this repository and none was created during M1 setup — only
  `.env.example`, which contains placeholders (empty strings or example values), never real
  credentials.
* `.gitignore` excludes `.env`, `.env.local`, and `.env.*.local`, with an explicit
  `!.env.example` re-include so the template stays trackable. Verified: `git status`/`git check-ignore`
  confirm no `.env` file is tracked or stageable (see [TASKS.md](TASKS.md) for the check performed
  before the M1 commit).
* `apps/api`'s logger (`pino`, in `src/config/logger.ts`) redacts `req.headers.authorization` and
  `req.headers.cookie` from all log output. No code path in M1 logs environment variables or
  request bodies wholesale.
* Placeholder variables for not-yet-built integrations (Stripe, Twilio, OpenAI, Deepgram,
  Cartesia, ElevenLabs, Google) are present in `.env.example` as empty values — documenting the
  future config surface without implying they're used anywhere yet. Nothing in the current
  codebase reads them.

## 3. Current attack surface (M1)

Being explicit about what exists so this section stays honest rather than aspirational:

* `apps/api` exposes exactly one route, `GET /health`, which returns no sensitive data (status,
  service name, uptime) and requires no auth (there is no auth system yet — M2). `helmet` is
  applied for baseline security headers; `cors` restricts browser callers to `WEB_ORIGIN`.
* `services/voice-agent` exposes exactly one route, `GET /health`, same characteristics, no auth.
* `apps/web` serves one static status page. No forms, no data submission, no auth.
* No database is connected to by any service, so there is no query surface to attack yet.
* No third-party API keys are used by any code path yet.

## 4. Dependencies

* Dependency versions were checked against the npm registry / PyPI at implementation time (see
  [ARCHITECTURE.md](ARCHITECTURE.md) and [TASKS.md](TASKS.md) for the specific versions and
  rationale, e.g. why TypeScript stayed on 5.9.x instead of the new 7.x major, and why `apps/web`
  stayed on ESLint 9 while `apps/api`/`packages/shared` use ESLint 10).
* `npm install` reported 0 vulnerabilities at the time of the M1 commit (`npm audit` was not run
  separately beyond the install-time report — add explicit `npm audit` / `pip-audit` gating as
  part of M12).

## 5. Known gaps (expected at this stage — see TASKS.md)

* No authentication or authorization exists (M2).
* No rate limiting on any endpoint.
* No CI-enforced security scanning (`npm audit`, `pip-audit`, secret scanning) — planned for M12.
* No dependency-update automation (Dependabot/Renovate) configured yet.
