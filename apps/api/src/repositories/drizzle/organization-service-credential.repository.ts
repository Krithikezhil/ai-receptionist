import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { organizationServiceCredentials } from "../../db/schema.js";
import type {
  NewOrganizationServiceCredential,
  OrganizationServiceCredential,
  OrganizationServiceCredentialRepository,
} from "../organization-service-credential-types.js";

function toDomain(
  row: typeof organizationServiceCredentials.$inferSelect,
): OrganizationServiceCredential {
  return {
    organizationId: row.organizationId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
  };
}

export function createDrizzleOrganizationServiceCredentialRepository(
  db: Database,
): OrganizationServiceCredentialRepository {
  return {
    async create(credential: NewOrganizationServiceCredential) {
      const [row] = await db.insert(organizationServiceCredentials).values(credential).returning();
      if (!row) throw new Error("Failed to create organization service credential");
      return toDomain(row);
    },

    async findByOrganizationId(organizationId) {
      const [row] = await db
        .select()
        .from(organizationServiceCredentials)
        .where(eq(organizationServiceCredentials.organizationId, organizationId))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },
  };
}
