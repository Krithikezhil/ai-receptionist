import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { organizationPhoneNumbers } from "../../db/schema.js";
import type {
  NewOrganizationPhoneNumber,
  OrganizationPhoneNumber,
  OrganizationPhoneNumberRepository,
} from "../organization-phone-number-types.js";

function toDomain(row: typeof organizationPhoneNumbers.$inferSelect): OrganizationPhoneNumber {
  return {
    id: row.id,
    organizationId: row.organizationId,
    phoneNumber: row.phoneNumber,
    createdAt: row.createdAt,
  };
}

export function createDrizzleOrganizationPhoneNumberRepository(
  db: Database,
): OrganizationPhoneNumberRepository {
  return {
    async listByOrganizationId(organizationId) {
      const rows = await db
        .select()
        .from(organizationPhoneNumbers)
        .where(eq(organizationPhoneNumbers.organizationId, organizationId));
      return rows.map(toDomain);
    },

    async findByPhoneNumber(phoneNumber) {
      const [row] = await db
        .select()
        .from(organizationPhoneNumbers)
        .where(eq(organizationPhoneNumbers.phoneNumber, phoneNumber))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async findByIdAndOrganizationId(id, organizationId) {
      const [row] = await db
        .select()
        .from(organizationPhoneNumbers)
        .where(
          and(
            eq(organizationPhoneNumbers.id, id),
            eq(organizationPhoneNumbers.organizationId, organizationId),
          ),
        )
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async create(phoneNumber: NewOrganizationPhoneNumber) {
      const [row] = await db.insert(organizationPhoneNumbers).values(phoneNumber).returning();
      if (!row) throw new Error("Failed to create organization phone number");
      return toDomain(row);
    },

    async deleteByIdAndOrganizationId(id, organizationId) {
      await db
        .delete(organizationPhoneNumbers)
        .where(
          and(
            eq(organizationPhoneNumbers.id, id),
            eq(organizationPhoneNumbers.organizationId, organizationId),
          ),
        );
    },
  };
}
