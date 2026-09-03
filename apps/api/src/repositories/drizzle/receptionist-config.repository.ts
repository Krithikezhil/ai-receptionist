import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { receptionistConfigurations } from "../../db/schema.js";
import type {
  NewReceptionistConfiguration,
  ReceptionistConfigRepository,
  ReceptionistConfiguration,
} from "../receptionist-config-types.js";

function toDomain(row: typeof receptionistConfigurations.$inferSelect): ReceptionistConfiguration {
  return {
    id: row.id,
    organizationId: row.organizationId,
    enabled: row.enabled,
    displayName: row.displayName,
    greeting: row.greeting,
    tone: row.tone,
    instructions: row.instructions,
    fallbackMessage: row.fallbackMessage,
    afterHoursMessage: row.afterHoursMessage,
    callTransferEnabled: row.callTransferEnabled,
    callTransferPhone: row.callTransferPhone,
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleReceptionistConfigRepository(
  db: Database,
): ReceptionistConfigRepository {
  return {
    async findByOrganizationId(organizationId) {
      const [row] = await db
        .select()
        .from(receptionistConfigurations)
        .where(eq(receptionistConfigurations.organizationId, organizationId))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async create(config: NewReceptionistConfiguration) {
      // enabled is never taken from the caller — organization creation
      // (the only place this is called from) must never activate the
      // receptionist. The DB column also defaults to false independently.
      const [row] = await db
        .insert(receptionistConfigurations)
        .values({ ...config, enabled: false })
        .returning();
      if (!row) throw new Error("Failed to create receptionist configuration");
      return toDomain(row);
    },

    async update(organizationId, changes) {
      const [row] = await db
        .update(receptionistConfigurations)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(receptionistConfigurations.organizationId, organizationId))
        .returning();
      return row ? toDomain(row) : undefined;
    },
  };
}
