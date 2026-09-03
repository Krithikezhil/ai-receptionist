import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { services } from "../../db/schema.js";
import type { NewServiceItem, ServiceItem, ServiceRepository } from "../organization-types.js";

function toDomain(row: typeof services.$inferSelect): ServiceItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    durationMinutes: row.durationMinutes,
    price: row.price,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleServiceRepository(db: Database): ServiceRepository {
  return {
    async listByOrganizationId(organizationId) {
      const rows = await db
        .select()
        .from(services)
        .where(eq(services.organizationId, organizationId));
      return rows.map(toDomain);
    },

    async findByIdAndOrganizationId(id, organizationId) {
      const [row] = await db
        .select()
        .from(services)
        .where(and(eq(services.id, id), eq(services.organizationId, organizationId)))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async create(service: NewServiceItem) {
      const [row] = await db.insert(services).values(service).returning();
      if (!row) throw new Error("Failed to create service");
      return toDomain(row);
    },

    async update(id, organizationId, changes) {
      const [row] = await db
        .update(services)
        .set({ ...changes, updatedAt: new Date() })
        .where(and(eq(services.id, id), eq(services.organizationId, organizationId)))
        .returning();
      return row ? toDomain(row) : undefined;
    },

    async deleteByIdAndOrganizationId(id, organizationId) {
      const rows = await db
        .delete(services)
        .where(and(eq(services.id, id), eq(services.organizationId, organizationId)))
        .returning({ id: services.id });
      return rows.length > 0;
    },
  };
}
