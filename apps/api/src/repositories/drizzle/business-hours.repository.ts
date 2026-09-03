import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { businessHours } from "../../db/schema.js";
import type { BusinessHoursEntry, BusinessHoursRepository } from "../organization-types.js";

function toDomain(row: typeof businessHours.$inferSelect): BusinessHoursEntry {
  return {
    id: row.id,
    organizationId: row.organizationId,
    dayOfWeek: row.dayOfWeek,
    isOpen: row.isOpen,
    openTime: row.openTime,
    closeTime: row.closeTime,
  };
}

export function createDrizzleBusinessHoursRepository(db: Database): BusinessHoursRepository {
  return {
    async listByOrganizationId(organizationId) {
      const rows = await db
        .select()
        .from(businessHours)
        .where(eq(businessHours.organizationId, organizationId));
      return rows.map(toDomain);
    },

    async replaceAll(organizationId, entries) {
      await db.delete(businessHours).where(eq(businessHours.organizationId, organizationId));
      if (entries.length === 0) return [];
      const rows = await db
        .insert(businessHours)
        .values(entries.map((e) => ({ ...e, organizationId })))
        .returning();
      return rows.map(toDomain);
    },
  };
}
