/**
 * Domain shape for one row of the durable local usage-reporting ledger --
 * see db/schema.ts's callUsageReports comment for the full design
 * rationale (why callId is unique rather than the primary key, why
 * organizationId is denormalized, why the three usage/report fields start
 * null). This repository is intentionally minimal: it records and reports
 * usage-reporting state, it does not compute billable minutes, call a
 * Stripe API, or make ordering/authorization decisions -- those belong to
 * a future service layer, mirroring how stripe-webhook-event-types.ts's
 * repository only supplies facts, never decisions.
 */
export interface CallUsageReport {
  id: string;
  callId: string;
  organizationId: string;
  billableMinutes: number | null;
  meterEventIdentifier: string | null;
  reportedAt: Date | null;
  createdAt: Date;
}

/**
 * Only callId and organizationId are ever supplied at creation time --
 * billableMinutes/meterEventIdentifier/reportedAt are deliberately absent
 * here (not optional-with-a-guessed-default): a future service computes
 * and sets them later via update(), never at row creation.
 */
export interface NewCallUsageReport {
  callId: string;
  organizationId: string;
}

export interface CallUsageReportUpdate {
  billableMinutes?: number | null;
  meterEventIdentifier?: string | null;
  reportedAt?: Date | null;
}

export interface CallUsageReportRepository {
  /**
   * Inserts a report row if this callId hasn't been recorded before
   * (dedupe via the callId unique constraint). Returns the inserted row,
   * or undefined when a report for this call already exists -- mirrors
   * StripeWebhookEventRepository.insertIfAbsent's exact contract: the
   * caller treats undefined as "already exists, do nothing further", not
   * an error.
   */
  insertIfAbsent(report: NewCallUsageReport): Promise<CallUsageReport | undefined>;

  /**
   * Tenant-scoped lookup by call -- requires organizationId, mirroring
   * this codebase's established findByIdAndOrganizationId convention
   * (see LeadRepository, AppointmentRepository, ServiceRepository), so a
   * caller can never look up another organization's usage report by
   * guessing/reusing a callId.
   */
  findByCallIdAndOrganizationId(
    callId: string,
    organizationId: string,
  ): Promise<CallUsageReport | undefined>;

  /**
   * Partial update, tenant-scoped the same way findByCallIdAndOrganizationId
   * is. Only the keys present in `changes` are written -- an omitted field
   * leaves the existing column value untouched (never silently reset to
   * null), mirroring OrganizationSubscriptionRepository.update()'s exact
   * partial-write contract.
   */
  update(
    callId: string,
    organizationId: string,
    changes: CallUsageReportUpdate,
  ): Promise<CallUsageReport | undefined>;

  /**
   * Organization-scoped, bounded query for rows not yet reported
   * (reportedAt IS NULL) -- the future reporting worker's read path. No
   * cross-organization variant is exposed, per this codebase's tenant-
   * isolation discipline; a worker that must sweep every organization
   * calls this once per organization, never once globally.
   */
  listUnreportedByOrganizationId(organizationId: string): Promise<CallUsageReport[]>;
}
