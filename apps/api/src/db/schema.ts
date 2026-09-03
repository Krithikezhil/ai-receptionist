import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * M2 scope: authentication persistence only. No organization/tenant tables
 * yet — see ARCHITECTURE.md "Multi-Tenancy" for how `users` is expected to
 * gain an organization relationship in M3 without this table being replaced.
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
