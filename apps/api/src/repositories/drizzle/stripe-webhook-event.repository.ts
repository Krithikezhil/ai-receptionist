import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { stripeWebhookEvents } from "../../db/schema.js";
import type {
  NewStripeWebhookEvent,
  StripeWebhookEvent,
  StripeWebhookEventRepository,
} from "../stripe-webhook-event-types.js";

function toDomain(row: typeof stripeWebhookEvents.$inferSelect): StripeWebhookEvent {
  return {
    id: row.id,
    type: row.type,
    stripeSubscriptionId: row.stripeSubscriptionId,
    organizationId: row.organizationId,
    stripeCreatedAt: row.stripeCreatedAt,
    applied: row.applied,
    receivedAt: row.receivedAt,
  };
}

/**
 * Construct with either the real `db` or a transaction handle from
 * `db.transaction(async (tx) => ...)` -- this factory takes a Database
 * exactly like every other Drizzle repository in this codebase, so the
 * future sync service composes it inside a transaction the same way
 * unit-of-work.ts already composes the organization-creation
 * repositories, with no separate transaction abstraction needed.
 */
export function createDrizzleStripeWebhookEventRepository(
  db: Database,
): StripeWebhookEventRepository {
  return {
    async insertIfAbsent(event: NewStripeWebhookEvent) {
      const [row] = await db
        .insert(stripeWebhookEvents)
        .values(event)
        .onConflictDoNothing()
        .returning();
      return row ? toDomain(row) : undefined;
    },

    async findLatestAppliedForSubscription(stripeSubscriptionId) {
      const [row] = await db
        .select({ stripeCreatedAt: stripeWebhookEvents.stripeCreatedAt })
        .from(stripeWebhookEvents)
        .where(
          and(
            eq(stripeWebhookEvents.stripeSubscriptionId, stripeSubscriptionId),
            eq(stripeWebhookEvents.applied, true),
          ),
        )
        .orderBy(desc(stripeWebhookEvents.stripeCreatedAt))
        .limit(1);
      return row?.stripeCreatedAt;
    },

    async markApplied(eventId, organizationId) {
      await db
        .update(stripeWebhookEvents)
        .set({ applied: true, organizationId })
        .where(eq(stripeWebhookEvents.id, eventId));
    },
  };
}
