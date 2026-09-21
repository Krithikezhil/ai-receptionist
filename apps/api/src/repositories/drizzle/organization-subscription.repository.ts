import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { organizationSubscriptions } from "../../db/schema.js";
import type {
  NewOrganizationSubscription,
  OrganizationSubscription,
  OrganizationSubscriptionRepository,
  OrganizationSubscriptionUpdate,
} from "../organization-subscription-types.js";

function toDomain(
  row: typeof organizationSubscriptions.$inferSelect,
): OrganizationSubscription {
  return {
    organizationId: row.organizationId,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    plan: row.plan,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    currentPeriodStart: row.currentPeriodStart,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleOrganizationSubscriptionRepository(
  db: Database,
): OrganizationSubscriptionRepository {
  return {
    async findByOrganizationId(organizationId) {
      const [row] = await db
        .select()
        .from(organizationSubscriptions)
        .where(eq(organizationSubscriptions.organizationId, organizationId))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async findByStripeCustomerId(stripeCustomerId) {
      const [row] = await db
        .select()
        .from(organizationSubscriptions)
        .where(eq(organizationSubscriptions.stripeCustomerId, stripeCustomerId))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async findByStripeSubscriptionId(stripeSubscriptionId) {
      const [row] = await db
        .select()
        .from(organizationSubscriptions)
        .where(eq(organizationSubscriptions.stripeSubscriptionId, stripeSubscriptionId))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async upsert(subscription: NewOrganizationSubscription) {
      const [row] = await db
        .insert(organizationSubscriptions)
        .values(subscription)
        .onConflictDoUpdate({
          target: organizationSubscriptions.organizationId,
          set: {
            stripeCustomerId: subscription.stripeCustomerId ?? null,
            stripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
            plan: subscription.plan ?? null,
            status: subscription.status ?? null,
            currentPeriodEnd: subscription.currentPeriodEnd ?? null,
            currentPeriodStart: subscription.currentPeriodStart ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) throw new Error("Failed to upsert organization subscription");
      return toDomain(row);
    },

    async update(organizationId, changes: OrganizationSubscriptionUpdate) {
      const [row] = await db
        .update(organizationSubscriptions)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(organizationSubscriptions.organizationId, organizationId))
        .returning();
      return row ? toDomain(row) : undefined;
    },
  };
}
