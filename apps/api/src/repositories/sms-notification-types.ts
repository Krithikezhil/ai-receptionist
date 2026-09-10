export type SmsNotificationType =
  | "appointment_confirmation"
  | "appointment_reminder"
  | "lead_confirmation";

export type SmsNotificationStatus = "pending" | "processing" | "sent" | "failed" | "skipped";

/**
 * Twilio's currently-documented Message resource status values, as a
 * widened literal union: the known literals give autocomplete/
 * exhaustiveness-checking value in a `switch`, but the `| (string & {})`
 * member means an unanticipated future Twilio value (Twilio's own docs
 * warn this set can evolve) still type-checks and round-trips correctly.
 * Deliberately NOT enforced as a database-level enum (see db/schema.ts's
 * providerStatus column) -- an enum-constrained column would force a new
 * migration every time Twilio adds a status value, defeating the point of
 * this being an open window into an external system we don't control.
 */
export type TwilioMessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | (string & {});

export interface SmsNotification {
  id: string;
  organizationId: string;
  notificationType: SmsNotificationType;
  appointmentId: string | null;
  leadId: string | null;
  destinationPhone: string;
  status: SmsNotificationStatus;
  providerMessageSid: string | null;
  providerStatus: TwilioMessageStatus | null;
  attemptCount: number;
  claimedAt: Date | null;
  lastAttemptedAt: Date | null;
  nextAttemptAt: Date;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NewSmsNotificationBase {
  organizationId: string;
  notificationType: SmsNotificationType;
  destinationPhone: string;
}

/**
 * Mirrors the database's own sms_notifications_exactly_one_entity CHECK
 * constraint (see db/schema.ts) at the type level: a caller can construct
 * exactly an appointment-only or lead-only input, never both, never
 * neither. This is a compile-time convenience, not a substitute for the
 * database constraint -- create() below must still handle SQLSTATE 23514
 * defensively, since nothing prevents a caller from bypassing this type
 * (e.g. constructing the object dynamically rather than as a literal).
 */
export type NewSmsNotification =
  | (NewSmsNotificationBase & { appointmentId: string; leadId?: undefined })
  | (NewSmsNotificationBase & { leadId: string; appointmentId?: undefined });

export interface SmsNotificationStatusUpdate {
  status: SmsNotificationStatus;
  providerMessageSid?: string | null;
  providerStatus?: TwilioMessageStatus | null;
  failureReason?: string | null;
  nextAttemptAt?: Date;
}

/**
 * Thrown by SmsNotificationRepository.create() when the requested
 * (notificationType, appointmentId) or (notificationType, leadId) pair
 * already has a notification row. In the real Drizzle implementation this
 * is translated from one of the two partial-unique-index violations
 * (sms_notifications_type_appointment_id_idx /
 * sms_notifications_type_lead_id_idx, see db/schema.ts) -- both raise
 * PostgreSQL SQLSTATE 23505, empirically confirmed during M11 Step 1's
 * real-database constraint verification. An atomic, database-level
 * guarantee, not a check-then-insert race -- mirrors
 * AppointmentOverlapError's exact reasoning (see appointment-types.ts).
 */
export class DuplicateSmsNotificationError extends Error {}

/**
 * Thrown by SmsNotificationRepository.create() if a caller somehow
 * bypasses NewSmsNotification's compile-time XOR shape and supplies both
 * or neither of appointmentId/leadId. Translated from the real
 * sms_notifications_exactly_one_entity CHECK violation (PostgreSQL
 * SQLSTATE 23514, see db/schema.ts), empirically confirmed during M11
 * Step 1's real-database constraint verification. Deliberately a
 * different error type from DuplicateSmsNotificationError -- callers must
 * not conflate the two.
 */
export class SmsNotificationEntityReferenceError extends Error {}

export interface SmsNotificationRepository {
  /**
   * Every lookup/mutation by id is also scoped by organizationId in the
   * query itself -- identical tenant-isolation discipline to every other
   * org-scoped repository in this codebase (see AppointmentRepository).
   */
  findByIdAndOrganizationId(
    id: string,
    organizationId: string,
  ): Promise<SmsNotification | undefined>;

  /**
   * Global lookup by Twilio's own message SID -- not scoped to an
   * organization, mirroring
   * OrganizationPhoneNumberRepository.findByPhoneNumber's exact
   * precedent: this is what a future delivery-status webhook uses to
   * resolve which row (and which organization) a callback belongs to,
   * before any organization id is known.
   */
  findByProviderMessageSid(
    providerMessageSid: string,
  ): Promise<SmsNotification | undefined>;

  /**
   * Single-row lookup by (appointmentId, notificationType) -- exists
   * specifically so AppointmentRepository.listDueForReminder's in-memory
   * test double can reproduce the same "does a reminder already exist for
   * this appointment" correlation the real Drizzle implementation
   * expresses as a single NOT EXISTS subquery joined directly against this
   * table (see drizzle/appointment.repository.ts). Not organization-scoped
   * -- mirrors findByProviderMessageSid's precedent of a narrow, global,
   * purpose-built lookup rather than a general-purpose query API.
   */
  findByAppointmentIdAndType(
    appointmentId: string,
    notificationType: SmsNotificationType,
  ): Promise<SmsNotification | undefined>;

  /**
   * May throw DuplicateSmsNotificationError or
   * SmsNotificationEntityReferenceError -- callers must catch these
   * specifically rather than treating them as a generic failure.
   */
  create(notification: NewSmsNotification): Promise<SmsNotification>;

  /**
   * Atomically claims up to `limit` due (status === "pending",
   * nextAttemptAt <= now) rows across ALL organizations -- deliberately
   * NOT organization-scoped, matching the approved M11 worker design: a
   * single worker processes due work for every organization in one pass;
   * each returned row still carries its own organizationId for the
   * caller's own tenant-scoped follow-up work (e.g. looking up which
   * organization's Twilio sender number to use). Claimed rows transition
   * to status === "processing" with claimedAt/lastAttemptedAt set to the
   * claim time and attemptCount incremented, as part of the SAME atomic
   * operation that claims them -- see the Drizzle implementation for
   * exactly how this achieves genuine concurrency safety (SELECT ... FOR
   * UPDATE SKIP LOCKED).
   */
  claimDue(limit: number): Promise<SmsNotification[]>;

  /**
   * Reclaims rows stuck in "processing" whose claimedAt is older than
   * olderThanMs, returning them to "pending" so a future claimDue() pass
   * can retry them -- concurrency-safe the same way claimDue() is (see
   * the Drizzle implementation). Does NOT touch attemptCount -- that was
   * already incremented at the original claim time; a reclaimed row
   * re-claimed later by claimDue() increments it again, so attemptCount
   * naturally reflects every claim attempt, crashed or not.
   * olderThanMs is caller-supplied (not a hardcoded constant) so tests
   * can simulate staleness deterministically. This is at-least-once
   * processing: a row reclaimed after the worker already successfully
   * submitted it to the provider, but crashed before recording the
   * result, WILL be resent on the next claim -- exactly-once delivery is
   * not provided or claimed by this repository.
   */
  reclaimStaleProcessing(
    olderThanMs: number,
    limit: number,
  ): Promise<SmsNotification[]>;

  /**
   * Transitions a claimed (or any existing) row to its next/final state.
   * organizationId-scoped like every other mutation on this interface.
   */
  updateStatus(
    id: string,
    organizationId: string,
    update: SmsNotificationStatusUpdate,
  ): Promise<SmsNotification | undefined>;
}
