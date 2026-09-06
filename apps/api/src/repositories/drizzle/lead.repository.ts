import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { leads } from "../../db/schema.js";
import type { Lead, LeadRepository, NewLead } from "../lead-types.js";

function toDomain(row: typeof leads.$inferSelect): Lead {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    intent: row.intent,
    notes: row.notes,
    callSid: row.callSid,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleLeadRepository(db: Database): LeadRepository {
  return {
    async listByOrganizationId(organizationId) {
      const rows = await db.select().from(leads).where(eq(leads.organizationId, organizationId));
      return rows.map(toDomain);
    },

    async findByIdAndOrganizationId(id, organizationId) {
      const [row] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), eq(leads.organizationId, organizationId)))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async create(lead: NewLead) {
      const [row] = await db.insert(leads).values(lead).returning();
      if (!row) throw new Error("Failed to create lead");
      return toDomain(row);
    },

    async updateStatus(id, organizationId, changes) {
      const [row] = await db
        .update(leads)
        .set({ ...changes, updatedAt: new Date() })
        .where(and(eq(leads.id, id), eq(leads.organizationId, organizationId)))
        .returning();
      return row ? toDomain(row) : undefined;
    },

    async deleteByIdAndOrganizationId(id, organizationId) {
      const rows = await db
        .delete(leads)
        .where(and(eq(leads.id, id), eq(leads.organizationId, organizationId)))
        .returning({ id: leads.id });
      return rows.length > 0;
    },
  };
}
