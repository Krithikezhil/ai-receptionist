import { and, eq, ilike, or } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { knowledgeEntries } from "../../db/schema.js";
import type { KnowledgeEntry, KnowledgeRepository, NewKnowledgeEntry } from "../knowledge-types.js";

function toDomain(row: typeof knowledgeEntries.$inferSelect): KnowledgeEntry {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    content: row.content,
    category: row.category,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleKnowledgeRepository(db: Database): KnowledgeRepository {
  return {
    async listByOrganizationId(organizationId, filter) {
      const conditions = [eq(knowledgeEntries.organizationId, organizationId)];
      if (filter?.category) conditions.push(eq(knowledgeEntries.category, filter.category));
      if (filter?.active !== undefined) conditions.push(eq(knowledgeEntries.active, filter.active));
      if (filter?.q) {
        const pattern = `%${filter.q}%`;
        const textMatch = or(
          ilike(knowledgeEntries.title, pattern),
          ilike(knowledgeEntries.content, pattern),
        );
        if (textMatch) conditions.push(textMatch);
      }

      const rows = await db
        .select()
        .from(knowledgeEntries)
        .where(and(...conditions));
      return rows.map(toDomain);
    },

    async findByIdAndOrganizationId(id, organizationId) {
      const [row] = await db
        .select()
        .from(knowledgeEntries)
        .where(
          and(eq(knowledgeEntries.id, id), eq(knowledgeEntries.organizationId, organizationId)),
        )
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async create(entry: NewKnowledgeEntry) {
      const [row] = await db.insert(knowledgeEntries).values(entry).returning();
      if (!row) throw new Error("Failed to create knowledge entry");
      return toDomain(row);
    },

    async update(id, organizationId, changes) {
      const [row] = await db
        .update(knowledgeEntries)
        .set({ ...changes, updatedAt: new Date() })
        .where(
          and(eq(knowledgeEntries.id, id), eq(knowledgeEntries.organizationId, organizationId)),
        )
        .returning();
      return row ? toDomain(row) : undefined;
    },

    async deleteByIdAndOrganizationId(id, organizationId) {
      const rows = await db
        .delete(knowledgeEntries)
        .where(
          and(eq(knowledgeEntries.id, id), eq(knowledgeEntries.organizationId, organizationId)),
        )
        .returning({ id: knowledgeEntries.id });
      return rows.length > 0;
    },
  };
}
