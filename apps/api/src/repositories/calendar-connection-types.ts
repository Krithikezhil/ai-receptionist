export type CalendarConnectionStatus = "connected" | "needs_reauthorization";

/**
 * At most one Google Calendar connection per organization (organizationId
 * itself is the primary key -- same "one row per org, no synthetic id"
 * shape as OrganizationServiceCredential, since this table holds a
 * credential too -- see db/schema.ts's organizationCalendarConnections
 * comment).
 *
 * refreshTokenCiphertext is opaque to this repository layer: it is always
 * base64(IV || authTag || ciphertext), AES-256-GCM. This repository never
 * encrypts, decrypts, validates, or interprets it in any way -- it is
 * stored and returned exactly as given. Only
 * services/calendar-connection.service.ts (M10 Step 4) is permitted to
 * touch plaintext token material, per the approved M10 plan's token-
 * encryption boundary. No plaintext token, ciphertext, IV, or auth tag is
 * ever logged by anything in this file.
 */
export interface OrganizationCalendarConnection {
  organizationId: string;
  googleAccountEmail: string;
  refreshTokenCiphertext: string;
  status: CalendarConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOrganizationCalendarConnection {
  organizationId: string;
  googleAccountEmail: string;
  refreshTokenCiphertext: string;
  status?: CalendarConnectionStatus;
}

export interface OrganizationCalendarConnectionStatusUpdate {
  status: CalendarConnectionStatus;
}

export interface OrganizationCalendarConnectionRepository {
  findByOrganizationId(
    organizationId: string,
  ): Promise<OrganizationCalendarConnection | undefined>;
  /**
   * Upserts the connection for an organization -- reconnecting (e.g. after
   * disconnect or re-authorization) replaces the previous row rather than
   * requiring a separate delete-then-create, since at most one connection
   * per organization is ever meaningful (see the approved M10 plan).
   */
  upsert(
    connection: NewOrganizationCalendarConnection,
  ): Promise<OrganizationCalendarConnection>;
  updateStatus(
    organizationId: string,
    changes: OrganizationCalendarConnectionStatusUpdate,
  ): Promise<OrganizationCalendarConnection | undefined>;
  deleteByOrganizationId(organizationId: string): Promise<boolean>;
}
