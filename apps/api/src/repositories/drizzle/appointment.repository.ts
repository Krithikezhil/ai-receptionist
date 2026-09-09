import { and, eq } from "drizzle-orm";
import { DatabaseError } from "pg";
import type { Database } from "../../db/client.js";
import { appointments } from "../../db/schema.js";
import {
  AppointmentOverlapError,
  type Appointment,
  type AppointmentRepository,
  type NewAppointment,
} from "../appointment-types.js";

// The hand-authored `appointments_no_overlap` PostgreSQL EXCLUDE constraint
// (see db/schema.ts and migrations/0007_kind_kingpin.sql) raises this error
// code on a conflicting insert -- Drizzle has no knowledge of this
// constraint (it isn't expressible in schema.ts; see that file's comment),
// so it surfaces as a plain node-postgres DatabaseError, not a
// Drizzle-specific error type.
const EXCLUSION_VIOLATION_CODE = "23P01";

function toDomain(row: typeof appointments.$inferSelect): Appointment {
  return {
    id: row.id,
    organizationId: row.organizationId,
    serviceId: row.serviceId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerEmail: row.customerEmail,
    notes: row.notes,
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    callSid: row.callSid,
    googleEventId: row.googleEventId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDrizzleAppointmentRepository(db: Database): AppointmentRepository {
  return {
    async listByOrganizationId(organizationId) {
      const rows = await db
        .select()
        .from(appointments)
        .where(eq(appointments.organizationId, organizationId));
      return rows.map(toDomain);
    },

    async findByIdAndOrganizationId(id, organizationId) {
      const [row] = await db
        .select()
        .from(appointments)
        .where(and(eq(appointments.id, id), eq(appointments.organizationId, organizationId)))
        .limit(1);
      return row ? toDomain(row) : undefined;
    },

    async create(appointment: NewAppointment) {
      try {
        const [row] = await db.insert(appointments).values(appointment).returning();
        if (!row) throw new Error("Failed to create appointment");
        return toDomain(row);
      } catch (err) {
        if (err instanceof DatabaseError && err.code === EXCLUSION_VIOLATION_CODE) {
          throw new AppointmentOverlapError(
            "Requested appointment time overlaps an existing appointment for this organization.",
          );
        }
        throw err;
      }
    },

    async updateGoogleEventId(id, organizationId, googleEventId) {
      const [row] = await db
        .update(appointments)
        .set({ googleEventId, updatedAt: new Date() })
        .where(and(eq(appointments.id, id), eq(appointments.organizationId, organizationId)))
        .returning();
      return row ? toDomain(row) : undefined;
    },

    async updateStatus(id, organizationId, changes) {
      const [row] = await db
        .update(appointments)
        .set({ ...changes, updatedAt: new Date() })
        .where(and(eq(appointments.id, id), eq(appointments.organizationId, organizationId)))
        .returning();
      return row ? toDomain(row) : undefined;
    },

    async deleteByIdAndOrganizationId(id, organizationId) {
      const rows = await db
        .delete(appointments)
        .where(and(eq(appointments.id, id), eq(appointments.organizationId, organizationId)))
        .returning({ id: appointments.id });
      return rows.length > 0;
    },
  };
}
