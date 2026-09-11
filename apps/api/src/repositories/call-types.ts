export type CallDisposition = "completed" | "failed" | "abandoned";

/**
 * M12 Step 5: minimal, organization-scoped call/session metadata --
 * deliberately no transcript/recording/conversation content (see
 * db/schema.ts's own comment on the calls table). One row is written
 * once, at call end -- there is no separate create-then-update flow, so
 * this repository intentionally exposes only listByOrganizationId() and
 * create(), mirroring LeadRepository/AppointmentRepository's tenant-
 * isolation discipline without copying their update/delete surface,
 * which this step does not need.
 */
export interface Call {
  id: string;
  organizationId: string;
  callSid: string;
  startedAt: Date;
  endedAt: Date;
  disposition: CallDisposition;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCall {
  organizationId: string;
  callSid: string;
  startedAt: Date;
  endedAt: Date;
  disposition: CallDisposition;
}

export interface CallRepository {
  listByOrganizationId(organizationId: string): Promise<Call[]>;
  create(call: NewCall): Promise<Call>;
}
