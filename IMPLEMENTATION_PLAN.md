# Implementation Plan

Milestone sequence for AI Receptionist. Each milestone is scoped to be independently shippable
and reviewable — later milestones' scope may be refined as earlier ones land, but the sequence
and boundaries below are the current plan.

**Note on M4**: this file originally sketched M4 as "AI voice agent." When M4 was actually
scoped, business knowledge and receptionist configuration were identified as a real prerequisite
the voice agent needs (it has to read *something* to answer calls) and split out as their own
milestone first. Everything from the original M4 onward shifted down by one — this is the kind of
"later milestones' scope may be refined" adjustment this file's own header anticipates, not a
silent renumbering.

## M1 — Foundation (this milestone)

Monorepo scaffolding, framework bootstraps (Next.js, Express, FastAPI), shared TypeScript
package, environment-variable strategy, health endpoints, linting/formatting/testing tooling,
Docker Compose foundation for the data layer, and the documentation set (this file plus
README/ARCHITECTURE/SECURITY/DEPLOYMENT/TASKS). No product features. See
[TASKS.md](TASKS.md) for the detailed completion status.

## M2 — Authentication

Real user authentication for `apps/web` + `apps/api`: registration, login, logout, server-side
cookie-based sessions (see ARCHITECTURE.md §9 for why sessions over JWT). Establishes the
identity layer that M3's tenant-scoping depends on ("tenant context comes from the authenticated
session" per ARCHITECTURE.md §6 requires this to exist first). Password reset, email
verification, and MFA are deferred — see SECURITY.md known gaps.

## M3 — Organizations and business configuration

Introduces the `organizations` table and every table depending on `organization_id`
(organization memberships, business profile, business hours, service catalog). Implements the
application-layer half of the multi-tenant enforcement strategy documented in ARCHITECTURE.md §6
(membership re-verified server-side on every request, every query scoped by `organizationId`) —
not just documents it, and proves it with tenant-isolation tests. Postgres Row-Level Security
(the strategy's other, defense-in-depth half) remains unimplemented — see SECURITY.md known gaps.

## M4 — Business knowledge and AI receptionist configuration

Tenant-scoped knowledge base (manual entries: FAQ/policy/service-info/custom — no web crawling,
no chunking/embeddings yet) and a provider-agnostic receptionist configuration (greeting, tone,
instructions, enable/disable — no vendor fields, always created disabled). Defines the "future
voice-agent contract" (ARCHITECTURE.md §11): REST endpoints the eventual Pipecat runtime will read
from, reusing the existing user-authenticated tenant-isolation model rather than building
inter-service auth prematurely. No live calling, no LLM/STT/TTS/provider integration — see
SECURITY.md known gaps for what's explicitly deferred.

## M5 — AI voice agent

Integrates Pipecat (current official package, current official docs — not vendored/forked) into
`services/voice-agent`. LLM integration (OpenAI), STT (Deepgram), TTS (Cartesia and/or
ElevenLabs). Consumes the M4 contract (business profile/hours/services/knowledge/receptionist
config) — which requires designing the inter-service authentication mechanism M4 deliberately
deferred. Voice conversations are not connected to real phone calls yet in this milestone —
that's M6.

## M6 — Twilio inbound calls

Twilio phone number provisioning and inbound call handling, wired into the M5 voice agent.
Outbound calling is out of scope here and is not currently planned as a near-term milestone.

## M7 — Knowledge retrieval / RAG

Extends M4's `knowledge_entries` with chunking and embeddings (a new, additive table — see
ARCHITECTURE.md §11 for why the M4 schema was deliberately shaped to allow this without a
redesign) and vector-based retrieval so the voice agent can answer business-specific questions
from a larger knowledge base than fits in a single prompt. Vector database selection happens at
the start of this milestone (not decided yet).

## M8 — Lead capture

Structured lead capture from calls (contact info, intent, notes), stored per-organization.

## M9 — Appointment booking

Calendar integration (Google Calendar) and booking flow driven by the voice agent.

## M10 — SMS

SMS confirmations/reminders for bookings and leads (Twilio SMS).

## M11 — Dashboard

Customer-facing dashboard in `apps/web`: call transcripts, call summaries, leads, appointments,
business analytics, usage tracking.

## M12 — Stripe billing

Subscription plans, metered usage billing, Stripe webhook handling, billing UI.

## M13 — Security and testing

Dedicated hardening pass: CI-enforced dependency scanning (`npm audit`, `pip-audit`, secret
scanning), tenant-isolation test coverage across every org-scoped endpoint introduced since M3,
rate limiting, load testing on the voice path.

## M14 — Production deployment

Target platform selection, CI/CD pipeline, container images for `apps/api` and
`services/voice-agent`, secrets management, staging/production environment setup, observability
(logging/metrics/alerting) in production.
