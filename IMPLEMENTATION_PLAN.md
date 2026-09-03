# Implementation Plan

Milestone sequence for AI Receptionist. Each milestone is scoped to be independently shippable
and reviewable — later milestones' scope may be refined as earlier ones land, but the sequence
and boundaries below are the current plan.

## M1 — Foundation (this milestone)

Monorepo scaffolding, framework bootstraps (Next.js, Express, FastAPI), shared TypeScript
package, environment-variable strategy, health endpoints, linting/formatting/testing tooling,
Docker Compose foundation for the data layer, and the documentation set (this file plus
README/ARCHITECTURE/SECURITY/DEPLOYMENT/TASKS). No product features. See
[TASKS.md](TASKS.md) for the detailed completion status.

## M2 — Authentication

Real user authentication for `apps/web` + `apps/api` (sign up, sign in, session/JWT handling,
password reset). Establishes the identity layer that M3's tenant-scoping depends on ("tenant
context comes from the authenticated session" per ARCHITECTURE.md §6 requires this to exist
first).

## M3 — Organizations and business configuration

Introduces the `organizations` table and every table depending on `organization_id`
(users-to-org membership, business configuration/profile). First milestone with a real database
schema and migrations. Implements the multi-tenant enforcement strategy documented in
ARCHITECTURE.md §6 (data-access layer scoping + Postgres RLS) — not just documents it.

## M4 — AI voice agent

Integrates Pipecat (current official package, current official docs — not vendored/forked) into
`services/voice-agent`. LLM integration (OpenAI), STT (Deepgram), TTS (Cartesia and/or
ElevenLabs). Voice conversations are not connected to real phone calls yet in this milestone —
that's M5.

## M5 — Twilio inbound calls

Twilio phone number provisioning and inbound call handling, wired into the M4 voice agent.
Outbound calling is out of scope here and is not currently planned as a near-term milestone.

## M6 — Knowledge base / RAG

Per-organization knowledge ingestion and retrieval so the voice agent can answer
business-specific questions. Vector database selection happens at the start of this milestone
(not decided yet).

## M7 — Lead capture

Structured lead capture from calls (contact info, intent, notes), stored per-organization.

## M8 — Appointment booking

Calendar integration (Google Calendar) and booking flow driven by the voice agent.

## M9 — SMS

SMS confirmations/reminders for bookings and leads (Twilio SMS).

## M10 — Dashboard

Customer-facing dashboard in `apps/web`: call transcripts, call summaries, leads, appointments,
business analytics, usage tracking.

## M11 — Stripe billing

Subscription plans, metered usage billing, Stripe webhook handling, billing UI.

## M12 — Security and testing

Dedicated hardening pass: CI-enforced dependency scanning (`npm audit`, `pip-audit`, secret
scanning), tenant-isolation test coverage across every org-scoped endpoint introduced since M3,
rate limiting, load testing on the voice path.

## M13 — Production deployment

Target platform selection, CI/CD pipeline, container images for `apps/api` and
`services/voice-agent`, secrets management, staging/production environment setup, observability
(logging/metrics/alerting) in production.
