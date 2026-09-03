import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { organizationMemberships, organizations } from "../../db/schema.js";
import type {
  NewOrganization,
  Organization,
  OrganizationRepository,
} from "../organization-types.js";

function toDomain(row: typeof organizations.$inferSelect): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleOrganizationRepository(db: Database): OrganizationRepository {
  return {
    async create(org: NewOrganization) {
      const [row] = await db.insert(organizations).values(org).returning();
      if (!row) throw new Error("Failed to create organization");
      return toDomain(row);
    },

    async findById(id) {
      const [row] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
      return row ? toDomain(row) : undefined;
    },

    async findBySlug(slug) {
      const [row] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async listForUser(userId) {
      const rows = await db
        .select({ organization: organizations })
        .from(organizations)
        .innerJoin(
          organizationMemberships,
          eq(organizations.id, organizationMemberships.organizationId),
        )
        .where(eq(organizationMemberships.userId, userId));
      return rows.map((r) => toDomain(r.organization));
    },

    async update(id, changes) {
      const [row] = await db
        .update(organizations)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(organizations.id, id))
        .returning();
      return row ? toDomain(row) : undefined;
    },
  };
}
