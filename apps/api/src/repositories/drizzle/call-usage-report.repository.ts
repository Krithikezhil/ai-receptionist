import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { callUsageReports } from "../../db/schema.js";
import type {
  CallUsageReport,
  CallUsageReportRepository,
  CallUsageReportUpdate,
  NewCallUsageReport,
} from "../call-usage-report-types.js";

function toDomain(row: typeof callUsageReports.$inferSelect): CallUsageReport {
  return {
    id: row.id,
    callId: row.callId,
    organizationId: row.organizationId,
    billableMinutes: row.billableMinutes,
    meterEventIdentifier: row.meterEventIdentifier,
    reportedAt: row.reportedAt,
    createdAt: row.createdAt,
  };
}

export function createDrizzleCallUsageReportRepository(
  db: Database,
): CallUsageReportRepository {
  return {
    async insertIfAbsent(report: NewCallUsageReport) {
      const [row] = await db
        .insert(callUsageReports)
        .values(report)
        .onConflictDoNothing()
        .returning();
      return row ? toDomain(row) : undefined;
    },

    async findByCallIdAndOrganizationId(callId, organizationId) {
      const [row] = await db
        .select()
        .from(callUsageReports)
        .where(
          and(
            eq(callUsageReports.callId, callId),
            eq(callUsageReports.organizationId, organizationId),
          ),
        )
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async update(callId, organizationId, changes: CallUsageReportUpdate) {
      const [row] = await db
        .update(callUsageReports)
        .set(changes)
        .where(
          and(
            eq(callUsageReports.callId, callId),
            eq(callUsageReports.organizationId, organizationId),
          ),
        )
        .returning();
      return row ? toDomain(row) : undefined;
    },

    async listUnreportedByOrganizationId(organizationId) {
      const rows = await db
        .select()
        .from(callUsageReports)
        .where(
          and(
            eq(callUsageReports.organizationId, organizationId),
            isNull(callUsageReports.reportedAt),
          ),
        );
      return rows.map(toDomain);
    },
  };
}
