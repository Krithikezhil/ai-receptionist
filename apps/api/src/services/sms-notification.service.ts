import type { Appointment } from "../repositories/appointment-types.js";
import type { Lead } from "../repositories/lead-types.js";
import {
  DuplicateSmsNotificationError,
  type NewSmsNotification,
  type SmsNotificationRepository,
} from "../repositories/sms-notification-types.js";
import { logger } from "../config/logger.js";

/**
 * M11 Step 3/4B: schedules SMS notifications. Appointment/lead
 * confirmations are triggered automatically at booking/lead-creation time
 * -- see the caller-side integration in appointment.service.ts /
 * lead.service.ts, neither of which inspects this service's outcome
 * beyond awaiting it. Appointment reminders are NOT triggered at creation
 * time -- they are triggered later, once per due appointment, by the SMS
 * worker's own polling loop (see workers/sms-worker.ts's
 * materializeDueReminders), the only caller of
 * scheduleAppointmentReminder. Deliberately asynchronous-follow-up
 * semantics throughout: an already-successful appointment booking, lead
 * creation, or reminder materialization must never be made to look like
 * it failed because notification scheduling had a problem.
 */
export interface SmsNotificationService {
  scheduleAppointmentConfirmation(appointment: Appointment): Promise<void>;
  /**
   * Called by the SMS worker's materializeDueReminders (see
   * workers/sms-worker.ts) once per appointment it determines is due for
   * a reminder -- never triggered at booking-creation time. Mirrors
   * scheduleAppointmentConfirmation's exact signature and duplicate/error
   * handling; the only difference is notificationType.
   */
  scheduleAppointmentReminder(appointment: Appointment): Promise<void>;
  scheduleLeadConfirmation(lead: Lead): Promise<void>;
}

export function createSmsNotificationService(repo: SmsNotificationRepository): SmsNotificationService {
  /**
   * Takes the full NewSmsNotification union directly -- each call site
   * below constructs an object literal matching exactly one union member
   * (either the appointmentId branch or the leadId branch, never both,
   * never neither), so TypeScript verifies the discriminated-union shape
   * at the call site itself. No `as NewSmsNotification` cast anywhere.
   */
  async function createIfPossible(input: NewSmsNotification): Promise<void> {
    try {
      await repo.create(input);
    } catch (err) {
      if (err instanceof DuplicateSmsNotificationError) return;
      // Any other failure (including the defensive-only
      // SmsNotificationEntityReferenceError, and any repository/database
      // error) is logged -- never silently discarded without a trace --
      // then absorbed: the already-successful appointment/lead operation
      // this was triggered from must not be made to look like it failed.
      // Never logs the raw Error object, a phone number, or any
      // credential/provider data -- only safe structured fields plus the
      // error's own message string, matching the existing
      // knowledge.service.ts precedent for this exact kind of
      // non-fatal, service-layer failure.
      logger.warn(
        {
          organizationId: input.organizationId,
          notificationType: input.notificationType,
          appointmentId: input.appointmentId,
          leadId: input.leadId,
          err: err instanceof Error ? err.message : String(err),
        },
        "sms notification scheduling failed; primary operation was not affected",
      );
    }
  }

  return {
    async scheduleAppointmentConfirmation(appointment) {
      const destinationPhone = appointment.customerPhone;
      if (!destinationPhone) return;

      await createIfPossible({
        organizationId: appointment.organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone,
        appointmentId: appointment.id,
      });
    },

    async scheduleAppointmentReminder(appointment) {
      const destinationPhone = appointment.customerPhone;
      if (!destinationPhone) return;

      await createIfPossible({
        organizationId: appointment.organizationId,
        notificationType: "appointment_reminder",
        destinationPhone,
        appointmentId: appointment.id,
      });
    },

    async scheduleLeadConfirmation(lead) {
      const destinationPhone = lead.contactPhone;
      if (!destinationPhone) return;

      await createIfPossible({
        organizationId: lead.organizationId,
        notificationType: "lead_confirmation",
        destinationPhone,
        leadId: lead.id,
      });
    },
  };
}
