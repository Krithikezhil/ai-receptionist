import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
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
