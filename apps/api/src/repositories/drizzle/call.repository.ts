import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { calls } from "../../db/schema.js";
import type { Call, CallRepository, NewCall } from "../call-types.js";

function toDomain(row: typeof calls.$inferSelect): Call {
  return {
    id: row.id,
    organizationId: row.organizationId,
    callSid: row.callSid,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    disposition: row.disposition,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleCallRepository(db: Database): CallRepository {
  return {
    async listByOrganizationId(organizationId) {
      const rows = await db.select().from(calls).where(eq(calls.organizationId, organizationId));
      return rows.map(toDomain);
    },

    async create(call: NewCall) {
      const [row] = await db.insert(calls).values(call).returning();
      if (!row) throw new Error("Failed to create call");
      return toDomain(row);
    },
  };
}
