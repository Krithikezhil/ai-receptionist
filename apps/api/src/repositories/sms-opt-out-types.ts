/**
 * M11 Step 4: tenant-scoped SMS opt-out persistence. Row presence means
 * opted-out; row absence means not opted out -- no separate boolean/status
 * field (see db/schema.ts's smsOptOuts table comment for the full
 * reasoning on why this is a dedicated table rather than a lead/
 * appointment-level field).
 *
 * Inbound STOP/START/HELP keyword parsing is deliberately out of scope
 * for this repository -- it exists purely to persist/query the resulting
 * state, independent of how that state gets decided.
 */
export interface SmsOptOut {
  id: string;
  organizationId: string;
  phoneNumber: string;
  optedOutAt: Date;
}

export interface SmsOptOutRepository {
  /**
   * Returns true iff `phoneNumber` (E.164) is currently opted out of SMS
   * for `organizationId`. Always queries by BOTH fields together -- never
   * by phone number alone -- since the same phone number can be opted out
   * for one organization and not another.
   */
  isOptedOut(organizationId: string, phoneNumber: string): Promise<boolean>;

  /**
   * Idempotently records an opt-out for (organizationId, phoneNumber) --
   * a repeat call for an already-opted-out pair is a safe no-op (returns
   * the existing row), never a duplicate row or a thrown error.
   */
  optOut(organizationId: string, phoneNumber: string): Promise<SmsOptOut>;

  /**
   * Idempotently removes an opt-out for (organizationId, phoneNumber) --
   * removing a pair that was never opted out (or already removed) is a
   * safe no-op, never a thrown error.
   */
  optIn(organizationId: string, phoneNumber: string): Promise<void>;
}
