import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Authentication persistence (M2). Deliberately not organization-scoped —
 * membership lives in organization_memberships below, so a user account
 * itself doesn't need to change shape as multi-org support evolves.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

/**
 * Sessions store only a SHA-256 hash of the session token, never the raw
 * token — see src/auth/session.ts. A leaked row from this table cannot be
 * used to authenticate.
 */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // hex-encoded SHA-256 hash of the session token
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;

/**
 * M3: the tenant boundary (see ARCHITECTURE.md "Multi-Tenancy"). Every
 * org-owned table below carries a non-nullable organization_id.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrganizationRow = typeof organizations.$inferSelect;
export type NewOrganizationRow = typeof organizations.$inferInsert;

/**
 * Minimal explicit role model (owner/member) — no fine-grained RBAC yet
 * (see ARCHITECTURE.md/SECURITY.md M3 sections). The unique constraint is
 * what prevents duplicate membership for the same (organization, user).
 */
export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("organization_memberships_org_user_unique").on(t.organizationId, t.userId)],
);

export type OrganizationMembershipRow = typeof organizationMemberships.$inferSelect;
export type NewOrganizationMembershipRow = typeof organizationMemberships.$inferInsert;

/**
 * One profile per organization (organizationId is unique, not just indexed)
 * — an org has exactly one business profile in M3, no multi-location support.
 */
export const businessProfiles = pgTable("business_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  description: text("description"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  address: text("address"),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BusinessProfileRow = typeof businessProfiles.$inferSelect;
export type NewBusinessProfileRow = typeof businessProfiles.$inferInsert;

/**
 * One row per (organization, day-of-week) — dayOfWeek follows JS's
 * Date#getDay() convention (0 = Sunday .. 6 = Saturday) for easy frontend
 * interop. openTime/closeTime are "HH:MM" 24h strings, null when closed.
 * No holiday/special-hours calendar yet (out of M3 scope).
 */
export const businessHours = pgTable(
  "business_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    isOpen: boolean("is_open").notNull().default(false),
    openTime: text("open_time"),
    closeTime: text("close_time"),
  },
  (t) => [unique("business_hours_org_day_unique").on(t.organizationId, t.dayOfWeek)],
);

export type BusinessHoursRow = typeof businessHours.$inferSelect;
export type NewBusinessHoursRow = typeof businessHours.$inferInsert;

/**
 * Minimal service catalog. No booking/scheduling yet — this only describes
 * what a business offers (name/duration/price), not availability.
 */
export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceRow = typeof services.$inferSelect;
export type NewServiceRow = typeof services.$inferInsert;

/**
 * M4: business knowledge the future AI receptionist will draw on. A single
 * flat table — no document/chunk split, no embeddings, no vector column.
 * `id` (stable UUID) and `content` (full text) are deliberately the only
 * things a future RAG milestone would need: chunking/embeddings belong in a
 * new, additive table referencing this one (e.g.
 * `knowledge_chunks.knowledge_entry_id -> knowledge_entries.id`), not a
 * redesign of it. See ARCHITECTURE.md "Knowledge".
 */
export const knowledgeEntries = pgTable("knowledge_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category", { enum: ["faq", "policy", "service_info", "custom"] })
    .notNull()
    .default("custom"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KnowledgeEntryRow = typeof knowledgeEntries.$inferSelect;
export type NewKnowledgeEntryRow = typeof knowledgeEntries.$inferInsert;

/**
 * M4: one provider-agnostic receptionist configuration per organization
 * (organizationId itself unique, same pattern as business_profiles). No
 * vendor-specific fields (no model name, no voice id, no API key column).
 * Every field with a sensible deterministic default is NOT NULL with that
 * default, rather than nullable — the exception is callTransferPhone, which
 * has no reasonable default. `enabled` defaults false: organization
 * creation must never activate the receptionist (see
 * services/organization.service.ts).
 */
export const receptionistConfigurations = pgTable("receptionist_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  displayName: text("display_name").notNull().default("AI Receptionist"),
  greeting: text("greeting").notNull().default("Thank you for calling. How can I help you today?"),
  tone: text("tone").notNull().default("friendly and professional"),
  instructions: text("instructions").notNull().default(""),
  fallbackMessage: text("fallback_message")
    .notNull()
    .default(
      "I'm sorry, I don't have that information right now. Let me have someone follow up with you.",
    ),
  afterHoursMessage: text("after_hours_message")
    .notNull()
    .default(
      "Thanks for calling. We're currently closed — please leave a message and we'll get back to you.",
    ),
  callTransferEnabled: boolean("call_transfer_enabled").notNull().default(false),
  callTransferPhone: text("call_transfer_phone"), // no sensible default — nullable is correct
  language: text("language").notNull().default("en"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReceptionistConfigurationRow = typeof receptionistConfigurations.$inferSelect;
export type NewReceptionistConfigurationRow = typeof receptionistConfigurations.$inferInsert;

/**
 * M5: the fact that authorizes /internal/v1/organizations/:id/* for one
 * specific organization. Only a SHA-256 hash of the token is ever stored
 * (same discipline as `sessions.id` — see src/auth/session.ts) — a leaked
 * row cannot be used to authenticate. One per organization, generated
 * exactly once inside the organization-creation transaction; the raw token
 * is returned to the caller only in that one response and never persisted
 * or logged. See src/middleware/require-organization-service-token.ts and
 * ARCHITECTURE.md "Internal voice API".
 */
export const organizationServiceCredentials = pgTable("organization_service_credentials", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrganizationServiceCredentialRow = typeof organizationServiceCredentials.$inferSelect;
export type NewOrganizationServiceCredentialRow =
  typeof organizationServiceCredentials.$inferInsert;

/**
 * M7: maps a Twilio phone number to the organization it rings. `id` is the
 * primary key (not organizationId) so one organization can own several
 * numbers -- only `phoneNumber` itself is unique, preventing the same number
 * from being claimed by two organizations. See
 * src/repositories/organization-phone-number-types.ts and
 * src/controllers/phone-number.controller.ts (owner-gated provisioning).
 */
export const organizationPhoneNumbers = pgTable("organization_phone_numbers", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull().unique(), // E.164, e.g. "+15551234567"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrganizationPhoneNumberRow = typeof organizationPhoneNumbers.$inferSelect;
export type NewOrganizationPhoneNumberRow = typeof organizationPhoneNumbers.$inferInsert;

/**
 * M8: chunked, embeddable pieces of one knowledge_entries row -- new,
 * additive table, exactly the extension point ARCHITECTURE.md §11
 * reserved at M4 design time ("a future RAG milestone adds
 * chunking/embeddings as a new, additive table referencing this one's
 * stable id... not a redesign of it"). knowledge_entries itself is
 * unchanged by this migration. organization_id is denormalized here
 * (not derived via a join through knowledge_entries) so every query can
 * be tenant-scoped in one predicate, matching every other org-owned
 * table's convention -- and is the first column in this schema to get an
 * explicit secondary index, since a foreign key alone does not index
 * itself in Postgres. embedding is nullable: a chunk exists as soon as
 * it's created by chunking, before embedding generation has necessarily
 * completed -- see the M8 plan's graceful-degradation design.
 */
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    knowledgeEntryId: uuid("knowledge_entry_id")
      .notNull()
      .references(() => knowledgeEntries.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: real("embedding").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_chunks_organization_id_idx").on(t.organizationId)],
);

export type KnowledgeChunkRow = typeof knowledgeChunks.$inferSelect;
export type NewKnowledgeChunkRow = typeof knowledgeChunks.$inferInsert;

/**
 * M9: structured lead capture from calls -- a caller's contact info,
 * stated intent, and freeform notes, captured by the voice agent's
 * capture_lead tool (write-capable, unlike every read-only M5-M8 tool) and
 * viewed/triaged from the dashboard. Every contact field is nullable: a
 * caller may give only a phone number, or only a name -- the point is to
 * record whatever was actually said, not to force completeness (enforced
 * as "at least one field present" at the validation layer, not here).
 * callSid is informational only, not a foreign key -- no calls/sessions
 * table exists in this schema (Twilio call ids are otherwise ephemeral,
 * see auth/call-credential.ts), so nothing exists yet for it to reference.
 * status gives a minimal dashboard triage workflow, same enum-with-default
 * pattern as knowledgeEntries.category. organizationId gets an explicit
 * secondary index, same reasoning as knowledge_chunks: the first/most
 * common query is always "list this org's leads".
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    intent: text("intent"),
    notes: text("notes"),
    callSid: text("call_sid"),
    status: text("status", { enum: ["new", "contacted", "closed"] })
      .notNull()
      .default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leads_organization_id_idx").on(t.organizationId)],
);

export type LeadRow = typeof leads.$inferSelect;
export type NewLeadRow = typeof leads.$inferInsert;

/**
 * M10: appointment bookings, made only by the voice agent's book_appointment
 * tool against the existing service catalog -- serviceId is NOT NULL and
 * ON DELETE RESTRICT (a service with appointment history cannot be deleted;
 * deactivate it via services.active instead, which already exists). endTime
 * is always server-computed from service.durationMinutes, never client-
 * supplied. status mirrors leads.status's enum-with-default pattern.
 * callSid is informational only, identical reasoning to leads.callSid.
 * googleEventId is null only transiently within one booking request (see
 * services/appointment.service.ts's booking-ordering design, M10 Step 4) --
 * a scheduled/confirmed row always has one once a request completes
 * successfully; there is deliberately no separate sync-status column (see
 * the approved M10 plan's "no sync-status field unless genuinely required"
 * decision).
 *
 * organizationId gets both a plain secondary index (every other org-owned
 * table's convention) and a composite (organizationId, startTime) index for
 * availability-window queries.
 *
 * Concurrency: overlapping active appointments for the same organization are
 * additionally prevented by a PostgreSQL EXCLUDE constraint
 * (appointments_no_overlap) added BY HAND in this table's migration file --
 * Drizzle's schema API has no representation for PostgreSQL EXCLUDE
 * constraints or extension declarations (verified directly against the
 * installed drizzle-orm 0.45.2 / drizzle-kit 0.31.10 source: no
 * exclude-constraint module exists in pg-core, and no `CREATE EXTENSION`
 * capability exists anywhere in either package). That constraint is
 * therefore NOT expressible here and will NOT be regenerated or
 * drift-detected by any future `drizzle-kit generate` run -- it is tracked
 * only in the migration SQL file itself and this comment. See the migration
 * file's own header comment for the full disclosure.
 */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    notes: text("notes"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    status: text("status", {
      enum: ["scheduled", "confirmed", "cancelled", "completed", "no_show"],
    })
      .notNull()
      .default("scheduled"),
    callSid: text("call_sid"),
    googleEventId: text("google_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("appointments_organization_id_idx").on(t.organizationId),
    index("appointments_organization_id_start_time_idx").on(t.organizationId, t.startTime),
  ],
);

export type AppointmentRow = typeof appointments.$inferSelect;
export type NewAppointmentRow = typeof appointments.$inferInsert;

/**
 * M10: at most one Google Calendar connection per organization
 * (organizationId itself is the primary key -- same "one row per org, no
 * synthetic id" pattern as organization_service_credentials, since this
 * table holds a credential too). Only the refresh token is persisted
 * (access tokens are short-lived and re-minted on demand at call time), and
 * only in encrypted form: refreshTokenCiphertext holds
 * base64(IV || authTag || ciphertext), AES-256-GCM, encrypted/decrypted
 * exclusively by services/calendar-connection.service.ts (M10 Step 4) --
 * no controller or repository ever handles plaintext. status distinguishes
 * a working connection from one Google has revoked (invalid_grant), so a
 * booking failure can be attributed correctly without ever storing or
 * logging the token itself. No calendarId column -- v1 always uses the
 * connected account's primary calendar (see the approved M10 plan).
 */
export const organizationCalendarConnections = pgTable("organization_calendar_connections", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  googleAccountEmail: text("google_account_email").notNull(),
  refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
  status: text("status", { enum: ["connected", "needs_reauthorization"] })
    .notNull()
    .default("connected"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrganizationCalendarConnectionRow =
  typeof organizationCalendarConnections.$inferSelect;
export type NewOrganizationCalendarConnectionRow =
  typeof organizationCalendarConnections.$inferInsert;

/**
 * M11 Step 1: durable, at-most-once SMS notification queue. Exactly one of
 * appointmentId/leadId is set per row -- enforced at the database level via
 * the exactly-one-entity CHECK constraint below, not by application code,
 * matching this schema's existing precedent of treating cross-row/cross-
 * column invariants (see appointments_no_overlap) as DB-level guarantees.
 *
 * next_attempt_at defaults to now(): under the approved M11 architecture,
 * every row is only ever inserted at the moment it is already due --
 * confirmations/lead-confirmations immediately after their triggering
 * event, and reminders lazily materialized by the worker only once their
 * own due window has arrived. No insertion path in this design ever needs
 * a genuinely future initial due time; retries set a future value via a
 * later UPDATE, which is unaffected by this INSERT-time default.
 *
 * The two partial unique indexes are this table's actual idempotency
 * guarantee -- a second attempt to enqueue the same (type, entity) pair
 * collides at the database level rather than relying on an application-
 * level check-then-insert race.
 *
 * Repository/service/worker code is deliberately NOT part of this step --
 * see M11 Step 2 onward.
 */
export const smsNotifications = pgTable(
  "sms_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    notificationType: text("notification_type", {
      enum: ["appointment_confirmation", "appointment_reminder", "lead_confirmation"],
    }).notNull(),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "cascade",
    }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    destinationPhone: text("destination_phone").notNull(),
    status: text("status", {
      enum: ["pending", "processing", "sent", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    providerMessageSid: text("provider_message_sid"),
    providerStatus: text("provider_status"),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sms_notifications_organization_id_idx").on(t.organizationId),
    index("sms_notifications_status_next_attempt_at_idx").on(t.status, t.nextAttemptAt),
    uniqueIndex("sms_notifications_type_appointment_id_idx")
      .on(t.notificationType, t.appointmentId)
      .where(sql`${t.appointmentId} IS NOT NULL`),
    uniqueIndex("sms_notifications_type_lead_id_idx")
      .on(t.notificationType, t.leadId)
      .where(sql`${t.leadId} IS NOT NULL`),
    uniqueIndex("sms_notifications_provider_message_sid_idx").on(t.providerMessageSid),
    check(
      "sms_notifications_exactly_one_entity",
      sql`(${t.appointmentId} IS NOT NULL) <> (${t.leadId} IS NOT NULL)`,
    ),
  ],
);

export type SmsNotificationRow = typeof smsNotifications.$inferSelect;
export type NewSmsNotificationRow = typeof smsNotifications.$inferInsert;

/**
 * M11 Step 4: tenant-scoped SMS opt-out state. Keyed by (organization_id,
 * phone_number) -- NOT by phone_number alone, since the same customer
 * phone number can appear across multiple organizations' leads/
 * appointments, and opting out of one organization's texts must never
 * silently opt them out of another's. Deliberately NOT a field on leads
 * or appointments: neither table has a stable, canonical "this phone
 * number, this organization" entity (a phone number can have many lead/
 * appointment rows over time, and a customer can text STOP before ever
 * becoming a lead or appointment) -- this table exists independently of
 * any lead/appointment/notification record's lifecycle. The unique
 * constraint below is both the tenant-isolation guarantee and the exact
 * index the worker's pre-send lookup needs -- no separate index required.
 * Row presence means opted-out; row absence means not opted out (no
 * separate boolean/status column). Inbound STOP/START/HELP keyword
 * parsing is deliberately out of scope for this table/step -- see
 * repositories/sms-opt-out-types.ts.
 */
export const smsOptOuts = pgTable(
  "sms_opt_outs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(), // E.164
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sms_opt_outs_organization_id_phone_number_idx").on(
      t.organizationId,
      t.phoneNumber,
    ),
  ],
);

export type SmsOptOutRow = typeof smsOptOuts.$inferSelect;
export type NewSmsOptOutRow = typeof smsOptOuts.$inferInsert;
