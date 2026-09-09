import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { DatabaseError } from "pg";
import type { Database } from "../../db/client.js";
import { smsNotifications } from "../../db/schema.js";
import {
  DuplicateSmsNotificationError,
  SmsNotificationEntityReferenceError,
  type NewSmsNotification,
  type SmsNotification,
  type SmsNotificationRepository,
  type SmsNotificationStatusUpdate,
} from "../sms-notification-types.js";

// The relevant partial-unique-index violation (duplicate
// (notification_type, appointment_id) or (notification_type, lead_id)
// pair -- see sms_notifications_type_appointment_id_idx /
// sms_notifications_type_lead_id_idx in db/schema.ts). Both indexes raise
// this same SQLSTATE; the distinction between them does not matter to a
// caller, so both translate to the same DuplicateSmsNotificationError.
const UNIQUE_VIOLATION_CODE = "23505";

// The sms_notifications_exactly_one_entity CHECK violation (see
// db/schema.ts). Deliberately a separate constant/branch from
// UNIQUE_VIOLATION_CODE -- these two error classes must never be
// conflated (see sms-notification-types.ts).
const CHECK_VIOLATION_CODE = "23514";

function toDomain(row: typeof smsNotifications.$inferSelect): SmsNotification {
  return {
    id: row.id,
    organizationId: row.organizationId,
    notificationType: row.notificationType,
    appointmentId: row.appointmentId,
    leadId: row.leadId,
    destinationPhone: row.destinationPhone,
    status: row.status,
    providerMessageSid: row.providerMessageSid,
    attemptCount: row.attemptCount,
    claimedAt: row.claimedAt,
    lastAttemptedAt: row.lastAttemptedAt,
    nextAttemptAt: row.nextAttemptAt,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleSmsNotificationRepository(db: Database): SmsNotificationRepository {
  return {
    async findByIdAndOrganizationId(id, organizationId) {
      const [row] = await db
        .select()
        .from(smsNotifications)
        .where(
          and(eq(smsNotifications.id, id), eq(smsNotifications.organizationId, organizationId)),
        )
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async create(notification: NewSmsNotification) {
      try {
        const [row] = await db.insert(smsNotifications).values(notification).returning();
        if (!row) throw new Error("Failed to create SMS notification");
        return toDomain(row);
      } catch (err) {
        if (err instanceof DatabaseError && err.code === UNIQUE_VIOLATION_CODE) {
          throw new DuplicateSmsNotificationError(
            "A notification of this type already exists for this appointment or lead.",
          );
        }
        if (err instanceof DatabaseError && err.code === CHECK_VIOLATION_CODE) {
          throw new SmsNotificationEntityReferenceError(
            "A notification must reference exactly one appointment or lead, not both or neither.",
          );
        }
        throw err;
      }
    },

    /**
     * Atomic claim, wrapped in one explicit db.transaction():
     *
     * 1. SELECT the id column only, of up to `limit` rows where
     *    status = 'pending' AND nextAttemptAt <= now, ordered so the
     *    most-overdue rows are claimed first, with
     *    `.for("update", { skipLocked: true })` -- this compiles to
     *    `... FOR UPDATE SKIP LOCKED`, which both row-locks every
     *    selected row for the remainder of this transaction AND skips
     *    (rather than blocks on) any row a concurrent transaction has
     *    already locked. If a second claimDue() call is running at the
     *    same time, its own SELECT ... FOR UPDATE SKIP LOCKED simply
     *    excludes whatever this transaction has already locked and picks
     *    different due rows instead (or returns fewer than `limit` if
     *    none remain) -- so two concurrent callers can never end up with
     *    overlapping row sets. This is the standard PostgreSQL job-queue
     *    claim idiom, not a hand-rolled approximation of it.
     * 2. UPDATE exactly those selected ids -- transitioning status to
     *    'processing', setting claimedAt/lastAttemptedAt to the same
     *    `now`, and incrementing attemptCount by 1 -- and RETURNING the
     *    updated rows.
     *
     * Both queries run against the same `tx` (the transaction handle),
     * so the UPDATE only ever touches rows this same transaction already
     * holds an exclusive row lock on -- no other transaction can modify
     * or re-claim them in between steps 1 and 2. The transaction begins
     * when `db.transaction(...)` is invoked (BEGIN) and ends when the
     * callback resolves (COMMIT, releasing the row locks) or throws
     * (ROLLBACK).
     */
    async claimDue(limit) {
      return db.transaction(async (tx) => {
        const now = new Date();

        const dueRows = await tx
          .select({ id: smsNotifications.id })
          .from(smsNotifications)
          .where(
            and(
              eq(smsNotifications.status, "pending"),
              lte(smsNotifications.nextAttemptAt, now),
            ),
          )
          .orderBy(smsNotifications.nextAttemptAt)
          .limit(limit)
          .for("update", { skipLocked: true });

        if (dueRows.length === 0) return [];

        const ids = dueRows.map((row) => row.id);

        const claimed = await tx
          .update(smsNotifications)
          .set({
            status: "processing",
            claimedAt: now,
            lastAttemptedAt: now,
            attemptCount: sql`${smsNotifications.attemptCount} + 1`,
            updatedAt: now,
          })
          .where(inArray(smsNotifications.id, ids))
          .returning();

        return claimed.map(toDomain);
      });
    },

    async updateStatus(id, organizationId, update: SmsNotificationStatusUpdate) {
      const [row] = await db
        .update(smsNotifications)
        .set({ ...update, updatedAt: new Date() })
        .where(
          and(eq(smsNotifications.id, id), eq(smsNotifications.organizationId, organizationId)),
        )
        .returning();
      return row ? toDomain(row) : undefined;
    },
  };
}
