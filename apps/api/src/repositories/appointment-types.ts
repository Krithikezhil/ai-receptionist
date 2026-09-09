export type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "completed" | "no_show";

/**
 * The statuses that "occupy" a slot -- mirrors the WHERE clause on the
 * hand-authored `appointments_no_overlap` PostgreSQL EXCLUDE constraint
 * (see db/schema.ts and migrations/0007_kind_kingpin.sql) exactly, so the
 * in-memory test double's overlap check stays behaviorally equivalent to
 * the real database constraint.
 */
export const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  "scheduled",
  "confirmed",
];

export interface Appointment {
  id: string;
  organizationId: string;
  serviceId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  startTime: Date;
  endTime: Date;
  status: AppointmentStatus;
  callSid: string | null;
  googleEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewAppointment {
  organizationId: string;
  serviceId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  notes?: string | null;
  startTime: Date;
  endTime: Date;
  status?: AppointmentStatus;
  callSid?: string | null;
  googleEventId?: string | null;
}

export interface AppointmentStatusUpdate {
  status: AppointmentStatus;
}

/**
 * Thrown by AppointmentRepository.create() when the requested
 * [startTime, endTime) window overlaps an existing active
 * (scheduled/confirmed) appointment for the same organization. In the real
 * Drizzle implementation this is translated from the PostgreSQL
 * `appointments_no_overlap` EXCLUDE constraint violation (error code
 * 23P01) -- an atomic, database-level guarantee, not a check-then-insert
 * race (see the approved M10 plan's concurrency design). The in-memory
 * test double reproduces the same check-and-throw behavior so both
 * implementations are observably equivalent, mirroring this codebase's
 * existing "a real Postgres insert would throw a unique-violation here
 * too" pattern already used for organization membership duplicates (see
 * tests/support/in-memory-organization-repositories.ts).
 */
export class AppointmentOverlapError extends Error {}

export interface AppointmentRepository {
  listByOrganizationId(organizationId: string): Promise<Appointment[]>;
  /**
   * Every lookup/mutation by id is also scoped by organizationId in the
   * query itself -- identical tenant-isolation discipline to every other
   * org-scoped repository in this codebase (see LeadRepository). No
   * operation on this interface accepts a bare appointment id without an
   * organizationId.
   */
  findByIdAndOrganizationId(id: string, organizationId: string): Promise<Appointment | undefined>;
  /**
   * May throw AppointmentOverlapError -- callers (the service layer, M10
   * Step 4) must catch this specifically rather than treating it as a
   * generic failure, per the approved M10 booking-write-ordering design.
   */
  create(appointment: NewAppointment): Promise<Appointment>;
  /**
   * Attaches the Google Calendar event id once the calendar-side write has
   * succeeded -- deliberately a separate step from create() (see the
   * approved M10 plan's booking-write-ordering section): a
   * scheduled/confirmed appointment is only ever meant to be treated as a
   * caller-visible success once this has run.
   */
  updateGoogleEventId(
    id: string,
    organizationId: string,
    googleEventId: string,
  ): Promise<Appointment | undefined>;
  updateStatus(
    id: string,
    organizationId: string,
    changes: AppointmentStatusUpdate,
  ): Promise<Appointment | undefined>;
  /**
   * Used both for ordinary deletion and for the compensating rollback in
   * the approved M10 booking-write-ordering design (deleting the
   * just-inserted row when the subsequent Google Calendar write fails).
   */
  deleteByIdAndOrganizationId(id: string, organizationId: string): Promise<boolean>;
}
