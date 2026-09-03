import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { businessProfiles } from "../../db/schema.js";
import type {
  BusinessProfile,
  BusinessProfileRepository,
  NewBusinessProfile,
} from "../organization-types.js";

function toDomain(row: typeof businessProfiles.$inferSelect): BusinessProfile {
  return {
    id: row.id,
    organizationId: row.organizationId,
    businessName: row.businessName,
    description: row.description,
    phone: row.phone,
    email: row.email,
    website: row.website,
    address: row.address,
    timezone: row.timezone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleBusinessProfileRepository(db: Database): BusinessProfileRepository {
  return {
    async findByOrganizationId(organizationId) {
      const [row] = await db
        .select()
        .from(businessProfiles)
        .where(eq(businessProfiles.organizationId, organizationId))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async create(profile: NewBusinessProfile) {
      const [row] = await db.insert(businessProfiles).values(profile).returning();
      if (!row) throw new Error("Failed to create business profile");
      return toDomain(row);
    },

    async update(organizationId, changes) {
      const [row] = await db
        .update(businessProfiles)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(businessProfiles.organizationId, organizationId))
        .returning();
      return row ? toDomain(row) : undefined;
    },
  };
}
