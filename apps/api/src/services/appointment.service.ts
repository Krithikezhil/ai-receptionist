import type {
  Appointment,
  AppointmentRepository,
  NewAppointment,
} from "../repositories/appointment-types.js";
import { ACTIVE_APPOINTMENT_STATUSES, AppointmentOverlapError } from "../repositories/appointment-types.js";
import type {
  BusinessHoursEntry,
  BusinessHoursRepository,
  BusinessProfileRepository,
  ServiceItem,
  ServiceRepository,
} from "../repositories/organization-types.js";
import type { CalendarConnectionService } from "./calendar-connection.service.js";
import {
  dayOfWeekForCalendarDate,
  fitsWithinBusinessHours,
  generateCandidateStartTimes,
  isValidIanaTimezone,
  resolveAppointmentStartTime,
  toLocalParts,
} from "./appointment-time.js";
import type { GoogleCalendarClient } from "./google-calendar-client-types.js";
import { GoogleCalendarApiError } from "./google-calendar-client-types.js";
import type { SmsNotificationService } from "./sms-notification.service.js";

const MAX_ALTERNATIVES = 3;

/** Mirrors organization.schemas.ts's HHMM regex exactly -- duplicated
 * locally rather than imported, since services in this codebase don't
 * import from the validation layer (controllers own that boundary). Used
 * only to validate a caller-supplied requestedTime string, never business
 * hours (which stay in appointment-time.ts's own BusinessHoursInterval
 * type). */
const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidClockTime(value: string): boolean {
  return CLOCK_TIME_PATTERN.test(value);
}

export interface BookAppointmentInput {
  serviceId: string;
  date: string;
  time: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  notes?: string | null;
  callSid?: string | null;
}

export type CheckAvailabilityResult =
  | {
      status: "ok";
      slots: string[];
      requestedTimeAvailable?: boolean;
      alternatives?: string[];
    }
  | { status: "service_not_found" }
  | { status: "invalid_timezone" }
  | { status: "invalid_date" }
  | { status: "invalid_time" }
  | { status: "calendar_not_connected" }
  | { status: "calendar_unavailable" };

export type BookAppointmentResult =
  | { status: "booked"; appointment: Appointment }
  | { status: "service_not_found" }
  | { status: "invalid_timezone" }
  | { status: "invalid_time" }
  | { status: "nonexistent_time" }
  | { status: "ambiguous_time" }
  | { status: "past_time" }
  | { status: "unavailable"; alternatives: string[] }
  | { status: "duplicate_booking" }
  | { status: "calendar_not_connected" }
  | { status: "calendar_unavailable" }
  | { status: "booking_failed" };

/**
 * "not_found" covers both a nonexistent id and an id belonging to a
 * different organization -- identical to every other org-scoped
 * repository's non-enumeration convention in this codebase.
 * "cannot_cancel" covers an appointment whose current status is a
 * terminal, already-resolved state (completed/no_show) -- see the
 * dedicated cancellation-transition reasoning below.
 */
export type CancelAppointmentResult =
  | { status: "cancelled"; appointment: Appointment }
  | { status: "not_found" }
  | { status: "cannot_cancel" };

/**
 * Orchestrates M10 appointment booking: business-hours + local-appointment
 * + Google-FreeBusy availability, server-side time resolution and
 * duration/endTime computation, and the approved booking-write ordering
 * with its compensating-delete paths. Never receives, decrypts, or
 * persists a Google refresh token -- it only ever holds the short-lived
 * access token returned by CalendarConnectionService.getAccessToken(),
 * for the duration of one request, passed straight into
 * GoogleCalendarClient. See google-token-crypto.ts /
 * calendar-connection.service.ts for where the refresh token actually
 * lives.
 */
export interface AppointmentService {
  listAppointments(organizationId: string): Promise<Appointment[]>;

  checkAvailability(
    organizationId: string,
    serviceId: string,
    date: string,
    requestedTime?: string,
  ): Promise<CheckAvailabilityResult>;

  bookAppointment(
    organizationId: string,
    input: BookAppointmentInput,
  ): Promise<BookAppointmentResult>;

  cancelAppointment(organizationId: string, appointmentId: string): Promise<CancelAppointmentResult>;
}

function findBusinessHoursForDayOfWeek(
  entries: BusinessHoursEntry[],
  dayOfWeek: number,
): { openTime: string; closeTime: string } | null {
  const entry = entries.find((e) => e.dayOfWeek === dayOfWeek);
  if (!entry || !entry.isOpen || !entry.openTime || !entry.closeTime) return null;
  return { openTime: entry.openTime, closeTime: entry.closeTime };
}

function appointmentsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function nearestAlternatives(slots: string[], requestedTime: string, max: number): string[] {
  const [reqHour, reqMinute] = requestedTime.split(":").map(Number);
  const requestedMinutes = (reqHour ?? 0) * 60 + (reqMinute ?? 0);
  return [...slots]
    .sort((a, b) => {
      const [aH, aM] = a.split(":").map(Number);
      const [bH, bM] = b.split(":").map(Number);
      const aDist = Math.abs((aH ?? 0) * 60 + (aM ?? 0) - requestedMinutes);
      const bDist = Math.abs((bH ?? 0) * 60 + (bM ?? 0) - requestedMinutes);
      return aDist - bDist;
    })
    .slice(0, max);
}

export function createAppointmentService(
  appointments: AppointmentRepository,
  services: ServiceRepository,
  businessProfiles: BusinessProfileRepository,
  businessHours: BusinessHoursRepository,
  calendarConnectionService: CalendarConnectionService,
  googleCalendarClient: GoogleCalendarClient,
  smsNotificationService: SmsNotificationService,
): AppointmentService {
  async function loadServiceAndProfile(
    organizationId: string,
    serviceId: string,
  ): Promise<
    | { ok: true; service: ServiceItem; timezone: string }
    | { ok: false; status: "service_not_found" | "invalid_timezone" }
  > {
    const service = await services.findByIdAndOrganizationId(serviceId, organizationId);
    if (!service || !service.active) return { ok: false, status: "service_not_found" };

    const profile = await businessProfiles.findByOrganizationId(organizationId);
    if (!profile) {
      // Every organization gets a business profile at creation time (see
      // organization.service.ts) -- absence here indicates a broken
      // invariant, not a normal operational outcome.
      throw new Error(
        `Organization ${organizationId} has no business profile; this should never happen.`,
      );
    }
    if (!isValidIanaTimezone(profile.timezone)) {
      return { ok: false, status: "invalid_timezone" };
    }
    return { ok: true, service, timezone: profile.timezone };
  }

  /**
   * Computes every valid local start time ("HH:MM") for `date`:
   * business-hours ∩ 15-minute grid ∩ service-duration-fits ∩ not
   * overlapping local active appointments ∩ not overlapping one Google
   * FreeBusy call covering the whole computed window (never per
   * candidate). Shared by checkAvailability and bookAppointment's
   * unavailable-path alternative computation -- exactly one
   * implementation of "what's available on this date."
   */
  async function computeDaySlots(
    organizationId: string,
    service: ServiceItem,
    timezone: string,
    date: string,
  ): Promise<
    | { status: "ok"; slots: string[] }
    | { status: "invalid_date" }
    | { status: "calendar_not_connected" }
    | { status: "calendar_unavailable" }
  > {
    const dayOfWeek = dayOfWeekForCalendarDate(date);
    if (dayOfWeek === null) return { status: "invalid_date" };

    const hoursEntries = await businessHours.listByOrganizationId(organizationId);
    const interval = findBusinessHoursForDayOfWeek(hoursEntries, dayOfWeek);
    if (!interval) return { status: "ok", slots: [] };

    const rawCandidates = generateCandidateStartTimes(interval, service.durationMinutes);

    const resolvedCandidates = rawCandidates
      .map((time) => ({ time, resolved: resolveAppointmentStartTime(timezone, date, time) }))
      .filter(
        (c): c is { time: string; resolved: { status: "ok"; startTime: Date } } =>
          c.resolved.status === "ok",
      )
      .map((c) => ({
        time: c.time,
        start: c.resolved.startTime,
        end: new Date(c.resolved.startTime.getTime() + service.durationMinutes * 60_000),
      }));

    if (resolvedCandidates.length === 0) return { status: "ok", slots: [] };

    const existing = await appointments.listByOrganizationId(organizationId);
    const active = existing.filter((a) => ACTIVE_APPOINTMENT_STATUSES.includes(a.status));

    const afterLocalFilter = resolvedCandidates.filter(
      (c) => !active.some((a) => appointmentsOverlap(c.start, c.end, a.startTime, a.endTime)),
    );
    if (afterLocalFilter.length === 0) return { status: "ok", slots: [] };

    const tokenResult = await calendarConnectionService.getAccessToken(organizationId);
    if (tokenResult.status === "not_connected" || tokenResult.status === "needs_reauthorization") {
      return { status: "calendar_not_connected" };
    }
    if (tokenResult.status === "error") {
      return { status: "calendar_unavailable" };
    }

    const windowStart = afterLocalFilter.reduce(
      (min, c) => (c.start < min ? c.start : min),
      afterLocalFilter[0]!.start,
    );
    const windowEnd = afterLocalFilter.reduce(
      (max, c) => (c.end > max ? c.end : max),
      afterLocalFilter[0]!.end,
    );

    let busyPeriods;
    try {
      busyPeriods = await googleCalendarClient.getFreeBusy(tokenResult.accessToken, windowStart, windowEnd);
    } catch (err) {
      if (err instanceof GoogleCalendarApiError) return { status: "calendar_unavailable" };
      throw err;
    }

    const afterGoogleFilter = afterLocalFilter.filter(
      (c) => !busyPeriods.some((b) => appointmentsOverlap(c.start, c.end, b.start, b.end)),
    );

    return { status: "ok", slots: afterGoogleFilter.map((c) => c.time) };
  }

  return {
    async listAppointments(organizationId) {
      return appointments.listByOrganizationId(organizationId);
    },

    async checkAvailability(organizationId, serviceId, date, requestedTime) {
      const loaded = await loadServiceAndProfile(organizationId, serviceId);
      if (!loaded.ok) return { status: loaded.status };

      if (requestedTime !== undefined && !isValidClockTime(requestedTime)) {
        return { status: "invalid_time" };
      }

      const daySlots = await computeDaySlots(organizationId, loaded.service, loaded.timezone, date);
      if (daySlots.status !== "ok") return { status: daySlots.status };

      if (requestedTime === undefined) {
        return { status: "ok", slots: daySlots.slots };
      }

      const requestedTimeAvailable = daySlots.slots.includes(requestedTime);
      if (requestedTimeAvailable) {
        return { status: "ok", slots: daySlots.slots, requestedTimeAvailable: true };
      }

      return {
        status: "ok",
        slots: daySlots.slots,
        requestedTimeAvailable: false,
        alternatives: nearestAlternatives(daySlots.slots, requestedTime, MAX_ALTERNATIVES),
      };
    },

    async bookAppointment(organizationId, input) {
      const loaded = await loadServiceAndProfile(organizationId, input.serviceId);
      if (!loaded.ok) return { status: loaded.status };
      const { service, timezone } = loaded;

      const resolved = resolveAppointmentStartTime(timezone, input.date, input.time);
      if (resolved.status !== "ok") return { status: resolved.status };
      const { startTime } = resolved;
      const endTime = new Date(startTime.getTime() + service.durationMinutes * 60_000);

      const localParts = toLocalParts(startTime, timezone);
      const hoursEntries = await businessHours.listByOrganizationId(organizationId);
      const interval = findBusinessHoursForDayOfWeek(hoursEntries, localParts.dayOfWeek);
      const fitsHours = interval
        ? fitsWithinBusinessHours(input.time, service.durationMinutes, interval)
        : false;

      /**
       * Computes the "unavailable" outcome with up to MAX_ALTERNATIVES
       * nearby alternatives -- but ONLY when the day-slot computation
       * itself actually succeeds. A calendar-connectivity failure
       * discovered while computing alternatives must propagate as that
       * same failure, never be silently downgraded to a bare
       * "unavailable, no alternatives" result.
       */
      async function unavailableWithAlternatives(): Promise<BookAppointmentResult> {
        const daySlots = await computeDaySlots(organizationId, service, timezone, input.date);
        if (daySlots.status === "calendar_not_connected") return { status: "calendar_not_connected" };
        if (daySlots.status === "calendar_unavailable") return { status: "calendar_unavailable" };
        if (daySlots.status === "invalid_date") {
          // Unreachable in practice: input.date was already proven a real
          // calendar date by resolveAppointmentStartTime above, and
          // computeDaySlots validates it the same way via
          // dayOfWeekForCalendarDate -- both built on the same underlying
          // parser. A mismatch here is an internal inconsistency, not a
          // normal caller-facing outcome, so it is never silently folded
          // into "unavailable".
          throw new Error(
            `Unexpected invalid_date from computeDaySlots for a date already validated: ${input.date}`,
          );
        }
        const alternatives = nearestAlternatives(daySlots.slots, input.time, MAX_ALTERNATIVES);
        return { status: "unavailable", alternatives };
      }

      if (!fitsHours) return unavailableWithAlternatives();

      if (input.callSid) {
        const existing = await appointments.listByOrganizationId(organizationId);
        const duplicate = existing.some(
          (a) =>
            a.callSid === input.callSid &&
            ACTIVE_APPOINTMENT_STATUSES.includes(a.status) &&
            a.serviceId === input.serviceId &&
            a.startTime.getTime() === startTime.getTime(),
        );
        if (duplicate) return { status: "duplicate_booking" };
      }

      const tokenResult = await calendarConnectionService.getAccessToken(organizationId);
      if (tokenResult.status === "not_connected" || tokenResult.status === "needs_reauthorization") {
        return { status: "calendar_not_connected" };
      }
      if (tokenResult.status === "error") {
        return { status: "calendar_unavailable" };
      }
      const { accessToken } = tokenResult;

      let preBookingBusy;
      try {
        preBookingBusy = await googleCalendarClient.getFreeBusy(accessToken, startTime, endTime);
      } catch (err) {
        if (err instanceof GoogleCalendarApiError) return { status: "calendar_unavailable" };
        throw err;
      }
      if (preBookingBusy.some((b) => appointmentsOverlap(startTime, endTime, b.start, b.end))) {
        return unavailableWithAlternatives();
      }

      const newAppointment: NewAppointment = {
        organizationId,
        serviceId: input.serviceId,
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        customerEmail: input.customerEmail ?? null,
        notes: input.notes ?? null,
        startTime,
        endTime,
        callSid: input.callSid ?? null,
      };

      let appointment: Appointment;
      try {
        appointment = await appointments.create(newAppointment);
      } catch (err) {
        if (err instanceof AppointmentOverlapError) return unavailableWithAlternatives();
        throw err;
      }

      const summary = input.customerName ? `${service.name} — ${input.customerName}` : service.name;

      let eventId: string;
      try {
        const created = await googleCalendarClient.createEvent(accessToken, {
          startTime,
          endTime,
          summary,
        });
        eventId = created.eventId;
      } catch {
        try {
          await appointments.deleteByIdAndOrganizationId(appointment.id, organizationId);
        } catch {
          // Best-effort only -- see this file's header comment.
        }
        return { status: "booking_failed" };
      }

      let updated: Appointment | undefined;
      try {
        updated = await appointments.updateGoogleEventId(appointment.id, organizationId, eventId);
      } catch {
        updated = undefined;
      }

      if (!updated) {
        try {
          await googleCalendarClient.deleteEvent(accessToken, eventId);
        } catch {
          // Best-effort only.
        }
        try {
          await appointments.deleteByIdAndOrganizationId(appointment.id, organizationId);
        } catch {
          // Best-effort only.
        }
        return { status: "booking_failed" };
      }

      // M11 Step 3: fire-and-forget-safe -- scheduleAppointmentConfirmation
      // never throws (SmsNotificationService absorbs all failures
      // internally, including logging any unexpected one), so awaiting it
      // here cannot turn this already-successful booking into a failure.
      await smsNotificationService.scheduleAppointmentConfirmation(updated);

      return { status: "booked", appointment: updated };
    },

    async cancelAppointment(organizationId, appointmentId) {
      const existing = await appointments.findByIdAndOrganizationId(appointmentId, organizationId);
      if (!existing) return { status: "not_found" };

      // See the dedicated cancellation-transition reasoning: scheduled and
      // confirmed are the only statuses actively cancelled here; cancelled
      // is idempotent; completed/no_show are terminal and rejected.
      if (existing.status === "cancelled") {
        return { status: "cancelled", appointment: existing };
      }
      if (existing.status === "completed" || existing.status === "no_show") {
        return { status: "cannot_cancel" };
      }

      const updated = await appointments.updateStatus(appointmentId, organizationId, {
        status: "cancelled",
      });
      if (!updated) return { status: "not_found" };

      if (updated.googleEventId) {
        try {
          const tokenResult = await calendarConnectionService.getAccessToken(organizationId);
          if (tokenResult.status === "ok") {
            await googleCalendarClient.deleteEvent(tokenResult.accessToken, updated.googleEventId);
          }
        } catch {
          // Best-effort only -- calendar deletion failure must never undo
          // the local cancellation. Disclosed reconciliation gap, per the
          // approved M10 plan (deferred to M14).
        }
      }

      return { status: "cancelled", appointment: updated };
    },
  };
}
