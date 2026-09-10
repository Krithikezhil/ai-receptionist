import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { smsOptOuts } from "../../db/schema.js";
import type { SmsOptOut, SmsOptOutRepository } from "../sms-opt-out-types.js";

function toDomain(row: typeof smsOptOuts.$inferSelect): SmsOptOut {
  return {
    id: row.id,
    organizationId: row.organizationId,
    phoneNumber: row.phoneNumber,
    optedOutAt: row.optedOutAt,
  };
}

export function createDrizzleSmsOptOutRepository(db: Database): SmsOptOutRepository {
  return {
    async isOptedOut(organizationId, phoneNumber) {
      const [row] = await db
        .select({ id: smsOptOuts.id })
        .from(smsOptOuts)
        .where(
          and(eq(smsOptOuts.organizationId, organizationId), eq(smsOptOuts.phoneNumber, phoneNumber)),
        )
        .limit(1);
      return row !== undefined;
    },

    async optOut(organizationId, phoneNumber) {
      // ON CONFLICT DO NOTHING against the (organizationId, phoneNumber)
      // unique index is the atomic idempotency guarantee -- a repeat call
      // never creates a duplicate row or throws. .returning() on a
      // no-op'd conflict returns nothing, so the existing row is
      // re-fetched explicitly in that case.
      const [inserted] = await db
        .insert(smsOptOuts)
        .values({ organizationId, phoneNumber })
        .onConflictDoNothing({
          target: [smsOptOuts.organizationId, smsOptOuts.phoneNumber],
        })
        .returning();
      if (inserted) return toDomain(inserted);

      const [existing] = await db
        .select()
        .from(smsOptOuts)
        .where(
          and(eq(smsOptOuts.organizationId, organizationId), eq(smsOptOuts.phoneNumber, phoneNumber)),
        )
        .limit(1);
      if (!existing) {
        throw new Error("Failed to opt out (insert conflicted but no existing row was found)");
      }
      return toDomain(existing);
    },

    async optIn(organizationId, phoneNumber) {
      // A DELETE matching zero rows is already a safe no-op in SQL --
      // removing a pair that was never opted out never throws.
      await db
        .delete(smsOptOuts)
        .where(
          and(eq(smsOptOuts.organizationId, organizationId), eq(smsOptOuts.phoneNumber, phoneNumber)),
        );
    },
  };
}
