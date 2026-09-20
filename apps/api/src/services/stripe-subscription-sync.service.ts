import { z } from "zod";
import type { Database } from "../db/client.js";
import { createDrizzleOrganizationSubscriptionRepository } from "../repositories/drizzle/organization-subscription.repository.js";
import { createDrizzleOrganizationRepository } from "../repositories/drizzle/organization.repository.js";
import { createDrizzleStripeWebhookEventRepository } from "../repositories/drizzle/stripe-webhook-event.repository.js";
import type {
  OrganizationSubscriptionRepository,
  OrganizationSubscriptionStatus,
} from "../repositories/organization-subscription-types.js";
import type { OrganizationRepository } from "../repositories/organization-types.js";
import type { StripeWebhookEventRepository } from "../repositories/stripe-webhook-event-types.js";

/**
 * A validly-signed request body did not parse as JSON, or parsed but did
 * not have the minimal shape a real Stripe event envelope always has.
 * The controller catches this specifically to return 400 -- everything
 * else thrown from processEvent() is an unexpected failure and is left
 * to propagate to the app's centralized error handler (500).
 */
export class MalformedStripeEventError extends Error {}

/**
 * The minimal shape this service reads from a Stripe event -- hand-typed
 * because no Stripe SDK/types package is installed in this repository
 * (intentional, see the approved M13 webhook design). Deliberately does
 * NOT include current_period_end: its exact field location depends on
 * which Stripe API version this integration eventually pins, which is
 * not yet decided anywhere in this repository (no Stripe package, no
 * pinned API version in any doc/config) -- see the mutation branch in
 * processEvent() below for the full rationale, including why an
 * existing-row update() must never include this field. Extending this
 * shape (and the mapping below) once that version is chosen is a small,
 * additive follow-up, not a redesign.
 */
export interface StripeWebhookEventPayload {
  id: string;
  type: string;
  created: number;
  data: {
    object: {
      id: string;
      customer: string;
      status: string;
      metadata?: Record<string, unknown> | null;
      items?: {
        data: Array<{ price?: { id?: string } }>;
      };
    };
  };
}

const SUPPORTED_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

const STRIPE_STATUS_TO_LOCAL: Record<string, OrganizationSubscriptionStatus> = {
  active: "active",
  trialing: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  paused: "paused",
};

const organizationIdSchema = z.uuid();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Minimal structural validation -- not a full schema, just enough to
 * safely read the fields this service actually uses without risking a
 * TypeError deep inside processEvent() on a shape-invalid (but
 * JSON-parseable) body. A real Stripe event always has every field
 * checked here.
 */
function isStripeWebhookEventPayload(value: unknown): value is StripeWebhookEventPayload {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.type !== "string") return false;
  if (typeof value.created !== "number") return false;

  const data = value.data;
  if (!isRecord(data)) return false;
  const object = data.object;
  if (!isRecord(object)) return false;
  if (typeof object.id !== "string") return false;
  if (typeof object.customer !== "string") return false;
  if (typeof object.status !== "string") return false;

  return true;
}

/**
 * Parses and minimally validates a raw Stripe webhook request body.
 * Throws MalformedStripeEventError for anything that isn't valid JSON or
 * doesn't have the minimal Stripe event shape -- the controller maps
 * this specifically to a 400, distinct from any other thrown error
 * (which represents a genuine internal failure, not a client-caused
 * malformed payload).
 */
export function parseStripeWebhookEventPayload(rawBody: string): StripeWebhookEventPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new MalformedStripeEventError("Stripe webhook body is not valid JSON.");
  }
  if (!isStripeWebhookEventPayload(parsed)) {
    throw new MalformedStripeEventError("Stripe webhook body is not a recognizable event.");
  }
  return parsed;
}

/**
 * Maps a Stripe subscription status into this schema's narrower local
 * enum (see db/schema.ts's organizationSubscriptions comment for why the
 * set is deliberately small). An unrecognized Stripe status maps to null
 * rather than guessing -- the schema's status column is nullable
 * specifically to allow this.
 */
function mapStripeStatus(stripeStatus: string): OrganizationSubscriptionStatus | null {
  return STRIPE_STATUS_TO_LOCAL[stripeStatus] ?? null;
}

/**
 * The repository bundle a single sync transaction needs, all constructed
 * from the same transaction handle -- mirrors OrganizationCreationRepos
 * (repositories/unit-of-work.ts) in spirit, kept local to this file
 * since no other service needs this exact bundle.
 */
export interface StripeSyncRepos {
  organizationSubscriptions: OrganizationSubscriptionRepository;
  stripeWebhookEvents: StripeWebhookEventRepository;
  organizations: OrganizationRepository;
}

/**
 * The transaction boundary this service depends on -- injectable so
 * tests can run the exact same processEvent() logic against in-memory
 * repositories with no real transaction (mirroring
 * createInMemoryUnitOfWork's "single-threaded test double needs no real
 * transaction semantics" reasoning), while production uses a real
 * Postgres transaction via createDrizzleStripeSyncTransactionRunner
 * below.
 */
export interface StripeSyncTransactionRunner {
  run<T>(fn: (repos: StripeSyncRepos) => Promise<T>): Promise<T>;
}

export function createDrizzleStripeSyncTransactionRunner(
  db: Database,
): StripeSyncTransactionRunner {
  return {
    run(fn) {
      return db.transaction(async (tx) => {
        const repos: StripeSyncRepos = {
          organizationSubscriptions: createDrizzleOrganizationSubscriptionRepository(tx),
          stripeWebhookEvents: createDrizzleStripeWebhookEventRepository(tx),
          organizations: createDrizzleOrganizationRepository(tx),
        };
        return fn(repos);
      });
    },
  };
}

export interface StripeSubscriptionSyncService {
  /**
   * Processes one already signature-verified, already-parsed Stripe
   * event. Never throws for any of the documented "safe" outcomes
   * (unsupported type, duplicate, unresolved organization, multi-item,
   * stale/equal event) -- those are all normal, non-error control flow
   * that the caller (the controller) always acknowledges with 200. Only
   * a genuine unexpected failure (e.g. a thrown unique-constraint
   * violation, a transaction failure) propagates as a rejected promise,
   * which the controller deliberately does not catch, letting it reach
   * the app's centralized error handler.
   */
  processEvent(event: StripeWebhookEventPayload): Promise<void>;
}

export function createStripeSubscriptionSyncService(
  transactionRunner: StripeSyncTransactionRunner,
): StripeSubscriptionSyncService {
  return {
    async processEvent(event) {
      if (!SUPPORTED_EVENT_TYPES.has(event.type)) {
        // Unsupported event type: 200, no stripe_webhook_events row at
        // all -- this table is deliberately scoped only to the three
        // supported event types, not a general Stripe event log.
        return;
      }

      const subscription = event.data.object;
      const stripeCreatedAt = new Date(event.created * 1000);

      await transactionRunner.run(async (repos) => {
        // Organization resolution -- exclusively from the verified event
        // body (already signature-checked by the caller) or an existing
        // local association, never from any caller-supplied identifier.
        // See the approved M13 webhook design.
        let organizationId: string | null = null;
        // Populated whenever a subscription row already exists for the
        // resolved organization -- determines insert (upsert) vs. partial
        // update (update) at mutation time below, so an existing
        // currentPeriodEnd is never touched by this webhook-owned write.
        let existingSubscription;

        const bySubscription = await repos.organizationSubscriptions.findByStripeSubscriptionId(
          subscription.id,
        );
        if (bySubscription) {
          organizationId = bySubscription.organizationId;
          existingSubscription = bySubscription;
        } else {
          const byCustomer = await repos.organizationSubscriptions.findByStripeCustomerId(
            subscription.customer,
          );
          if (byCustomer) {
            organizationId = byCustomer.organizationId;
            existingSubscription = byCustomer;
          } else {
            const candidate = subscription.metadata?.organizationId;
            if (typeof candidate === "string" && organizationIdSchema.safeParse(candidate).success) {
              const org = await repos.organizations.findById(candidate);
              if (org) {
                organizationId = org.id;
                // Resolved via metadata, not via an existing Stripe
                // association -- the organization may still already have
                // a subscription row (e.g. a prior, different Stripe
                // subscription), so check explicitly rather than assume
                // this is a first-time write.
                existingSubscription = await repos.organizationSubscriptions.findByOrganizationId(
                  org.id,
                );
              }
            }
          }
        }

        // Dedupe insert -- attributed to the resolved organization (or
        // null) at insert time, so even a not-applied event (unresolved
        // org, multi-item, stale) is still correctly recorded.
        const inserted = await repos.stripeWebhookEvents.insertIfAbsent({
          id: event.id,
          type: event.type,
          stripeSubscriptionId: subscription.id,
          organizationId,
          stripeCreatedAt,
        });
        if (!inserted) return; // duplicate event id

        if (organizationId === null) return; // unresolved organization

        // Multi-item guard -- checked BEFORE any items.data[0] access,
        // never a silent first-item selection for a multi-item
        // subscription.
        const items = subscription.items?.data ?? [];
        if (items.length !== 1) return;

        // Locks the existing row for this subscription, if one exists.
        // Protects every write after the very first one for a given
        // subscription -- see findByStripeSubscriptionIdForUpdate's own
        // doc comment and SECURITY.md for the accepted first-row
        // residual race this does NOT close.
        await repos.organizationSubscriptions.findByStripeSubscriptionIdForUpdate(subscription.id);

        const latestApplied = await repos.stripeWebhookEvents.findLatestAppliedForSubscription(
          subscription.id,
        );
        if (latestApplied !== undefined && stripeCreatedAt <= latestApplied) {
          return; // stale or equal -- strictly newer required to mutate
        }

        const status = mapStripeStatus(subscription.status);
        const plan = items[0]?.price?.id ?? null;

        // currentPeriodEnd is deliberately never set by this webhook path
        // -- see this file's top-of-file comment on
        // StripeWebhookEventPayload -- until the Stripe API version this
        // integration targets is decided and the field's real location
        // confirmed against Stripe's own documentation.
        if (existingSubscription) {
          // Existing row: partial update() only, touching exactly the
          // fields this webhook sync owns (stripeCustomerId,
          // stripeSubscriptionId, plan, status). currentPeriodEnd is
          // intentionally absent from this object -- update()'s
          // implementation only SETs the keys actually present, so any
          // currentPeriodEnd value already on the row (however it got
          // there) is left completely untouched, never reset to null.
          // Using the full-replacement upsert() here would silently null
          // it out on every webhook event -- see SECURITY.md/this
          // service's change history for why update() is required for
          // this branch.
          await repos.organizationSubscriptions.update(organizationId, {
            stripeCustomerId: subscription.customer,
            stripeSubscriptionId: subscription.id,
            plan,
            status,
          });
        } else {
          // First-ever subscription state for this organization -- there
          // is nothing for a partial update() to modify, so upsert()
          // (insert) is used instead. currentPeriodEnd is omitted here
          // too and remains null via upsert()'s own `?? null` default --
          // this is a real absence of data (never set anywhere yet), not
          // an overwrite of an existing value.
          await repos.organizationSubscriptions.upsert({
            organizationId,
            stripeCustomerId: subscription.customer,
            stripeSubscriptionId: subscription.id,
            plan,
            status,
          });
        }

        await repos.stripeWebhookEvents.markApplied(event.id, organizationId);
      });
    },
  };
}
