import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { organizationCalendarConnections } from "../../db/schema.js";
import type {
  NewOrganizationCalendarConnection,
  OrganizationCalendarConnection,
  OrganizationCalendarConnectionRepository,
} from "../calendar-connection-types.js";

function toDomain(
  row: typeof organizationCalendarConnections.$inferSelect,
): OrganizationCalendarConnection {
  return {
    organizationId: row.organizationId,
    googleAccountEmail: row.googleAccountEmail,
    refreshTokenCiphertext: row.refreshTokenCiphertext,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleOrganizationCalendarConnectionRepository(
  db: Database,
): OrganizationCalendarConnectionRepository {
  return {
    async findByOrganizationId(organizationId) {
      const [row] = await db
        .select()
        .from(organizationCalendarConnections)
        .where(eq(organizationCalendarConnections.organizationId, organizationId))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async upsert(connection: NewOrganizationCalendarConnection) {
      const [row] = await db
        .insert(organizationCalendarConnections)
        .values(connection)
        .onConflictDoUpdate({
          target: organizationCalendarConnections.organizationId,
          set: {
            googleAccountEmail: connection.googleAccountEmail,
            refreshTokenCiphertext: connection.refreshTokenCiphertext,
            status: connection.status ?? "connected",
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!row) throw new Error("Failed to upsert organization calendar connection");
      return toDomain(row);
    },

    async updateStatus(organizationId, changes) {
      const [row] = await db
        .update(organizationCalendarConnections)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(organizationCalendarConnections.organizationId, organizationId))
        .returning();
      return row ? toDomain(row) : undefined;
    },

    async deleteByOrganizationId(organizationId) {
      const rows = await db
        .delete(organizationCalendarConnections)
        .where(eq(organizationCalendarConnections.organizationId, organizationId))
        .returning({ organizationId: organizationCalendarConnections.organizationId });
      return rows.length > 0;
    },
  };
}
