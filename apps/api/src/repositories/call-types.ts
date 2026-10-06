export type CallDisposition = "completed" | "failed" | "abandoned";

/**
 * M12 Step 5: minimal, organization-scoped call/session metadata --
 * deliberately no transcript/recording content (see db/schema.ts's own
 * comment on the calls table). One row is written once, at call end --
 * there is no separate create-then-update flow, so this repository
 * intentionally exposes only listByOrganizationId() and create(),
 * mirroring LeadRepository/AppointmentRepository's tenant-isolation
 * discipline without copying their update/delete surface, which this
 * step does not need.
 *
 * M12 Step 6: `summary` is nullable and optional on NewCall for the same
 * reason as call.schemas.ts's recordCallSchema -- an AI-generated recap
 * that may not be available at call-end. It is never overwritten after
 * the initial write (see drizzle/call.repository.ts's first-write-wins
 * duplicate handling).
 */
export interface Call {
  id: string;
  organizationId: string;
  callSid: string;
  startedAt: Date;
  endedAt: Date;
  disposition: CallDisposition;
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCall {
  organizationId: string;
  callSid: string;
  startedAt: Date;
  endedAt: Date;
  disposition: CallDisposition;
  summary?: string | null;
}

export interface CallRepository {
  listByOrganizationId(organizationId: string): Promise<Call[]>;
  create(call: NewCall): Promise<Call>;
}
