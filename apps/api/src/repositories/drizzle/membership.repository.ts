import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { organizationMemberships } from "../../db/schema.js";
import type {
  MembershipRepository,
  NewOrganizationMembership,
  OrganizationMembership,
} from "../organization-types.js";

function toDomain(row: typeof organizationMemberships.$inferSelect): OrganizationMembership {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role,
    createdAt: row.createdAt,
  };
}

export function createDrizzleMembershipRepository(db: Database): MembershipRepository {
  return {
    async create(membership: NewOrganizationMembership) {
      const [row] = await db.insert(organizationMemberships).values(membership).returning();
      if (!row) throw new Error("Failed to create membership");
      return toDomain(row);
    },

    async findByOrgAndUser(organizationId, userId) {
      const [row] = await db
        .select()
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        )
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async listByUser(userId) {
      const rows = await db
        .select()
        .from(organizationMemberships)
        .where(eq(organizationMemberships.userId, userId));
      return rows.map(toDomain);
    },
  };
}
