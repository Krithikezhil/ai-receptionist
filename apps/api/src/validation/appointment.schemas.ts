import { z } from "zod";

const appointmentStatus = z.enum(["scheduled", "confirmed", "cancelled", "completed", "no_show"]);

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_SHAPE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Internal-endpoint-only (services/voice-agent's book_appointment tool --
 * see the approved M10 plan). date/time are SHAPE-validated only here --
 * this schema does not confirm the date is a real calendar date, does not
 * resolve date+time against the organization's timezone, does not look up
 * the service's duration, and does not compute startTime/endTime. All of
 * that is Step 4's job (AppointmentService), which alone has access to
 * business_profiles.timezone and services.durationMinutes.
 *
 * No startTime/endTime/googleEventId/organizationId field exists here:
 * the LLM/caller must never perform timezone arithmetic or hand over a
 * resolved timestamp (per the approved M10 plan), googleEventId is always
 * server-bound, and organizationId always comes from the already-
 * authenticated route/token context, never the request body (same
 * discipline as createLeadSchema). callSid IS accepted here (M10 Step 7),
 * identical definition to createLeadSchema's own field -- but a
 * call-credential-authenticated request never trusts it blindly: the
 * internal controller cross-checks it against
 * req.verifiedCallSid (see require-organization-auth.ts) and rejects a
 * mismatch; the verified value always wins when one exists. status is
 * likewise excluded: a
 * newly created appointment is always "scheduled" (the DB column's own
 * default, see db/schema.ts), never caller-settable at creation.
 *
 * customerName/customerPhone/customerEmail/notes reuse createLeadSchema's
 * exact caller-transcribed-data convention: capped freeform strings, no
 * stricter format validation (no z.email(), no E.164 regex) -- this is
 * transcribed, caller-stated information, not a business's own curated
 * data (contrast businessProfileSchema/createPhoneNumberSchema in
 * organization.schemas.ts).
 */
export const createAppointmentSchema = z
  .object({
    serviceId: z.uuid(),
    date: z.string().regex(DATE_SHAPE, "Must be in YYYY-MM-DD format."),
    time: z.string().regex(TIME_SHAPE, "Must be in 24-hour HH:MM format."),
    customerName: z.string().trim().max(200).nullable().optional(),
    customerPhone: z.string().trim().max(50).nullable().optional(),
    customerEmail: z.string().trim().max(320).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    // Identical definition to createLeadSchema's own callSid field --
    // see the header comment above for how this is verified, not just
    // trusted, once a call credential is in play.
    callSid: z.string().trim().max(100).nullable().optional(),
  })
  .refine(
    (appointment) => Boolean(appointment.customerName) || Boolean(appointment.customerPhone),
    {
      message: "At least one of customerName or customerPhone must be provided.",
    },
  );

/**
 * Dashboard-only -- the sole field a human is allowed to change on an
 * appointment in M10's scope, mirroring updateLeadStatusSchema exactly. No
 * other field may be updated through this schema.
 */
export const updateAppointmentStatusSchema = z.object({
  status: appointmentStatus,
});

export const appointmentListQuerySchema = z.object({
  status: appointmentStatus.optional(),
});

/**
 * Internal-endpoint-only (services/voice-agent's check_availability tool --
 * M10 Step 7). serviceId/date reuse the exact shapes createAppointmentSchema
 * already validates; time is optional here -- checking a whole day's
 * availability does not require one specific requested time.
 */
export const internalCheckAvailabilityQuerySchema = z.object({
  serviceId: z.uuid(),
  date: z.string().regex(DATE_SHAPE, "Must be in YYYY-MM-DD format."),
  time: z.string().regex(TIME_SHAPE, "Must be in 24-hour HH:MM format.").optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentStatusInput = z.infer<typeof updateAppointmentStatusSchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
export type InternalCheckAvailabilityQuery = z.infer<typeof internalCheckAvailabilityQuerySchema>;
