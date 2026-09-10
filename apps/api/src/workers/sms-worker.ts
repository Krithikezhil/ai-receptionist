import { logger } from "../config/logger.js";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  type Appointment,
  type AppointmentRepository,
} from "../repositories/appointment-types.js";
import type {
  BusinessProfile,
  BusinessProfileRepository,
} from "../repositories/organization-types.js";
import type {
  OrganizationPhoneNumber,
  OrganizationPhoneNumberRepository,
} from "../repositories/organization-phone-number-types.js";
import type {
  SmsNotification,
  SmsNotificationRepository,
} from "../repositories/sms-notification-types.js";
import type { SmsOptOutRepository } from "../repositories/sms-opt-out-types.js";
import { normalizeE164 } from "../services/phone-normalization.js";
import {
  renderAppointmentConfirmationBody,
  renderAppointmentReminderBody,
  renderLeadConfirmationBody,
} from "../services/sms-message-templates.js";
import type { SmsNotificationService } from "../services/sms-notification.service.js";
import { TwilioSmsApiError, type TwilioSmsClient } from "../services/twilio-sms-client-types.js";

/**
 * M11 Step 4: the SMS-sending worker. Pure/testable -- no process,
 * environment, or timer concerns beyond what is exported here; the actual
 * standalone process entrypoint (env loading, real repository/service
 * construction, SIGTERM/SIGINT wiring) is a separate, not-yet-created file
 * (worker.ts). This module is exercised directly by tests/sms-worker.test.ts
 * against in-memory repositories and a fake Twilio client.
 */

export const POLL_INTERVAL_MS = 5000;
export const BATCH_SIZE = 10;
export const STALE_PROCESSING_MS = 300_000;
export const MAX_ATTEMPTS = 3;
export const REMINDER_WINDOW_MS = 86_400_000;

/** Base retry delays, indexed by (attemptCount - 1) -- attempt 1 waits
 * ~60s, attempt 2 waits ~300s, before landing on a terminal state at
 * MAX_ATTEMPTS. Reused, unmodified, for BOTH Twilio-retryable failures and
 * retryable config failures (see applyRetryableConfigFailure) -- a single
 * backoff policy, not two independently-maintained ones. */
const RETRY_BASE_DELAYS_MS = [60_000, 300_000];

export interface SmsWorkerDeps {
  smsNotifications: SmsNotificationRepository;
  appointments: AppointmentRepository;
  businessProfiles: BusinessProfileRepository;
  organizationPhoneNumbers: OrganizationPhoneNumberRepository;
  /** Tenant-scoped SMS opt-out state -- consulted once, immediately
   * before sending, for every notification type (see
   * processOneNotification). Inbound STOP/START/HELP keyword parsing
   * that populates this repository is a separate, not-yet-built piece;
   * this dependency only ever reads/writes the resulting state. */
  smsOptOuts: SmsOptOutRepository;
  smsNotificationService: SmsNotificationService;
  twilioSmsClient: TwilioSmsClient;
  /** Absolute, publicly-reachable URL Twilio will POST delivery-status
   * updates to -- built by the caller (worker.ts) from API_PUBLIC_BASE_URL,
   * never derived from a request header. Passed straight through to every
   * TwilioSmsClient.sendSms() call. */
  statusCallbackUrl: string;
}

// -----------------------------------------------------------------------
// Graceful shutdown
// -----------------------------------------------------------------------

export interface ShutdownSignal {
  stopped: boolean;
  /** Resolves the instant stop() is called -- used to interrupt an
   * in-progress sleep immediately, without polling. */
  waitForStop: Promise<void>;
}

export function createShutdownSignal(): { signal: ShutdownSignal; stop: () => void } {
  let resolveStop!: () => void;
  const waitForStop = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  const signal: ShutdownSignal = { stopped: false, waitForStop };
  return {
    signal,
    stop: () => {
      signal.stopped = true;
      resolveStop();
    },
  };
}

/** Races a real timer against shutdown, always cancelling the timer in
 * `finally` -- if stop() wins the race, the pending setTimeout is cleared
 * immediately rather than left to fire later or keep the event loop
 * alive. */
async function interruptibleSleep(ms: number, signal: ShutdownSignal): Promise<void> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([timeout, signal.waitForStop]);
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------
// Sender resolution -- fail-closed, never guesses
// -----------------------------------------------------------------------

export type SenderResolution =
  | { status: "ok"; phoneNumber: string }
  | { status: "no_sender_configured" }
  | { status: "ambiguous_sender"; count: number };

export function resolveSenderNumber(numbers: OrganizationPhoneNumber[]): SenderResolution {
  if (numbers.length === 0) return { status: "no_sender_configured" };
  if (numbers.length > 1) return { status: "ambiguous_sender", count: numbers.length };
  return { status: "ok", phoneNumber: numbers[0]!.phoneNumber };
}

// -----------------------------------------------------------------------
// Twilio error classification and sanitized description
// -----------------------------------------------------------------------

export function classifyTwilioError(err: TwilioSmsApiError): "retryable" | "terminal" {
  if (err.httpStatus === null) return "retryable";
  if (err.httpStatus === 429) return "retryable";
  if (err.httpStatus >= 500) return "retryable";
  if (err.twilioErrorCode === 21610 || err.twilioErrorCode === 21211) return "terminal";
  return "terminal";
}

/** A small, fully controlled vocabulary -- never derived from err.message
 * or any Twilio response body text. Only ever interpolates err.httpStatus,
 * a bounded protocol-level integer, never attacker/provider-controlled
 * free text. */
export function describeTwilioFailure(err: TwilioSmsApiError): string {
  if (err.httpStatus === null) return "twilio_network_error";
  if (err.twilioErrorCode === 21610) return "twilio_recipient_unsubscribed";
  if (err.twilioErrorCode === 21211) return "twilio_invalid_recipient";
  if (err.httpStatus === 429) return "twilio_rate_limited";
  if (err.httpStatus >= 500) return `twilio_server_error_${err.httpStatus}`;
  if (err.httpStatus === 400) return "twilio_bad_request";
  if (err.httpStatus === 401) return "twilio_unauthorized";
  return `twilio_error_${err.httpStatus}`;
}

function computeRetryDelayMs(attemptCount: number, retryAfterMs: number | null): number {
  const index = Math.min(attemptCount - 1, RETRY_BASE_DELAYS_MS.length - 1);
  const base = RETRY_BASE_DELAYS_MS[index]!;
  const jittered = base * (0.8 + Math.random() * 0.4);
  return retryAfterMs !== null ? Math.max(jittered, retryAfterMs) : jittered;
}

// -----------------------------------------------------------------------
// Failure-status helpers -- controlled failureReason vocabulary only,
// never a raw Error message or provider response text.
// -----------------------------------------------------------------------

/** no_sender_configured / ambiguous_sender / business_profile_missing --
 * organization-level configuration gaps an admin could plausibly fix
 * before the attempt cap is reached, so these are retried on the SAME
 * backoff schedule as a Twilio-retryable failure (computeRetryDelayMs,
 * retryAfterMs: null -- there is no Twilio response here to carry a
 * floor), landing on "skipped" (never "failed") once exhausted --
 * "skipped" means "never had enough configuration to attempt delivery",
 * distinct from "failed" meaning "Twilio rejected it". */
async function applyRetryableConfigFailure(
  deps: SmsWorkerDeps,
  notification: SmsNotification,
  reason: "no_sender_configured" | "ambiguous_sender" | "business_profile_missing",
): Promise<void> {
  if (notification.attemptCount < MAX_ATTEMPTS) {
    await deps.smsNotifications.updateStatus(notification.id, notification.organizationId, {
      status: "pending",
      nextAttemptAt: new Date(Date.now() + computeRetryDelayMs(notification.attemptCount, null)),
      failureReason: reason,
    });
    return;
  }
  await deps.smsNotifications.updateStatus(notification.id, notification.organizationId, {
    status: "skipped",
    failureReason: reason,
  });
}

/** destination_phone_invalid / appointment_not_found /
 * appointment_no_longer_active -- per-notification facts fixed at (or
 * before) claim time that retrying the SAME row can never change, so
 * these are immediate, final skips, never retried. */
async function skipImmediately(
  deps: SmsWorkerDeps,
  notification: SmsNotification,
  reason:
    | "destination_phone_invalid"
    | "appointment_not_found"
    | "appointment_no_longer_active"
    | "recipient_opted_out",
): Promise<void> {
  await deps.smsNotifications.updateStatus(notification.id, notification.organizationId, {
    status: "skipped",
    failureReason: reason,
  });
}

async function applyTwilioFailure(
  deps: SmsWorkerDeps,
  notification: SmsNotification,
  err: TwilioSmsApiError,
): Promise<void> {
  const reason = describeTwilioFailure(err);
  if (classifyTwilioError(err) === "retryable" && notification.attemptCount < MAX_ATTEMPTS) {
    await deps.smsNotifications.updateStatus(notification.id, notification.organizationId, {
      status: "pending",
      nextAttemptAt: new Date(
        Date.now() + computeRetryDelayMs(notification.attemptCount, err.retryAfterMs),
      ),
      failureReason: reason,
    });
    return;
  }
  await deps.smsNotifications.updateStatus(notification.id, notification.organizationId, {
    status: "failed",
    failureReason: reason,
  });
}

function renderBody(
  notification: SmsNotification,
  profile: BusinessProfile,
  appointment: Appointment | undefined,
): string {
  switch (notification.notificationType) {
    case "appointment_confirmation":
      return renderAppointmentConfirmationBody(
        profile.businessName,
        appointment!.startTime,
        profile.timezone,
      );
    case "appointment_reminder":
      return renderAppointmentReminderBody(
        profile.businessName,
        appointment!.startTime,
        profile.timezone,
      );
    case "lead_confirmation":
      return renderLeadConfirmationBody(profile.businessName);
  }
}

// -----------------------------------------------------------------------
// Single-notification processing
// -----------------------------------------------------------------------

async function processOneNotification(
  deps: SmsWorkerDeps,
  notification: SmsNotification,
): Promise<void> {
  // Single appointment lookup, reused below for both the reminder recheck
  // and rendering -- never fetched twice for the same notification.
  const appointment = notification.appointmentId
    ? await deps.appointments.findByIdAndOrganizationId(
        notification.appointmentId,
        notification.organizationId,
      )
    : undefined;

  if (notification.appointmentId && !appointment) {
    // Unreachable via the real DB (sms_notifications.appointment_id is ON
    // DELETE CASCADE -- this row would itself be gone), but the in-memory
    // test double doesn't model cascades. A missing appointment can never
    // become present again by retrying the same row -- immediate, final
    // skip, for both confirmation and reminder notification types.
    await skipImmediately(deps, notification, "appointment_not_found");
    return;
  }

  if (
    notification.notificationType === "appointment_reminder" &&
    appointment &&
    !ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status)
  ) {
    // Reminder-only freshness recheck -- a cancelled/completed appointment
    // won't reactivate by retrying. Confirmations are never rechecked here:
    // the event they confirm already happened and is final.
    await skipImmediately(deps, notification, "appointment_no_longer_active");
    return;
  }

  // Explicit, deterministic ordering: sender resolved and checked FIRST;
  // the business profile is only loaded once sender resolution has
  // already succeeded -- a sender failure must never even look up the
  // profile (see the approved "sender-resolution failure takes
  // precedence" test).
  const sender = resolveSenderNumber(
    await deps.organizationPhoneNumbers.listByOrganizationId(notification.organizationId),
  );
  if (sender.status !== "ok") {
    const reason = sender.status === "no_sender_configured" ? "no_sender_configured" : "ambiguous_sender";
    await applyRetryableConfigFailure(deps, notification, reason);
    return;
  }

  const profile = await deps.businessProfiles.findByOrganizationId(notification.organizationId);
  if (!profile) {
    await applyRetryableConfigFailure(deps, notification, "business_profile_missing");
    return;
  }

  // Nothing upstream of this worker normalizes destinationPhone --
  // sms-notification.service.ts stores appointment.customerPhone /
  // lead.contactPhone verbatim. This is the only point in the pipeline
  // where E.164 normalization happens, immediately before sending.
  const to = normalizeE164(notification.destinationPhone);
  if (!to) {
    await skipImmediately(deps, notification, "destination_phone_invalid");
    return;
  }

  // Application-level opt-out enforcement -- the single choke point
  // every notification type funnels through before ever reaching
  // Twilio (see processOneBatch/processOneNotification's own doc
  // comments), so this one check automatically protects any future
  // notification type too, with nothing duplicated per type. Checked
  // against BOTH notification.organizationId and the normalized E.164
  // form together -- never phone number alone, since the same
  // customer number can be opted out for one organization and not
  // another. Non-retryable: a fixed fact about this row's destination
  // that retrying can't change (mirrors destination_phone_invalid's
  // own reasoning). Inbound STOP/START/HELP keyword parsing that
  // populates this state is a separate, not-yet-built piece -- this
  // call only ever consults whatever state already exists.
  if (await deps.smsOptOuts.isOptedOut(notification.organizationId, to)) {
    await skipImmediately(deps, notification, "recipient_opted_out");
    return;
  }

  const body = renderBody(notification, profile, appointment);

  try {
    const result = await deps.twilioSmsClient.sendSms({
      to,
      from: sender.phoneNumber,
      body,
      statusCallbackUrl: deps.statusCallbackUrl,
    });
    await deps.smsNotifications.updateStatus(notification.id, notification.organizationId, {
      status: "sent",
      providerMessageSid: result.sid,
      providerStatus: result.status,
    });
    // providerMessageSid is a safe, opaque Twilio-assigned identifier --
    // same trust tier as twilio-sms-status.controller.ts's own
    // {event, messageSid, providerStatus} logging precedent. Never the
    // destination phone, message body, customer info, or business name.
    logger.info(
      {
        notificationId: notification.id,
        organizationId: notification.organizationId,
        providerMessageSid: result.sid,
      },
      "sms sent",
    );
  } catch (err) {
    if (!(err instanceof TwilioSmsApiError)) throw err;
    await applyTwilioFailure(deps, notification, err);
  }
}

// -----------------------------------------------------------------------
// Batch processing, reminder materialization, poll iteration, main loop
// -----------------------------------------------------------------------

/** Self-claims via smsNotifications.claimDue(BATCH_SIZE) -- callers never
 * pass a pre-claimed batch in, matching claimDue()'s own atomic-claim
 * contract. */
export async function processOneBatch(deps: SmsWorkerDeps): Promise<void> {
  const batch = await deps.smsNotifications.claimDue(BATCH_SIZE);
  for (const notification of batch) {
    try {
      await processOneNotification(deps, notification);
    } catch (err) {
      // Not a TwilioSmsApiError (processOneNotification never rethrows
      // that one) -- an unexpected DB/repository/rendering failure. Left
      // exactly as-is (still "processing"): reclaimStaleProcessing()
      // already exists to recover rows in this state after
      // STALE_PROCESSING_MS, so nothing is silently lost, only delayed --
      // the same outcome a mid-flight crash already produces today. This
      // must never abort the loop: every other notification in this batch
      // still gets its own independent attempt. errorType is a small,
      // fully controlled classification -- never err.message, err.name,
      // String(err), or any other arbitrary exception text, since an
      // unexpected error's message could itself contain sensitive data.
      logger.error(
        {
          notificationId: notification.id,
          organizationId: notification.organizationId,
          errorType: err instanceof Error ? "unexpected_error" : "unknown_throwable",
        },
        "unexpected error processing sms notification; left for stale-reclaim",
      );
    }
  }
}

/** Materializes appointment_reminder notifications for every active
 * appointment starting within REMINDER_WINDOW_MS that doesn't already
 * have one -- delegates entirely to
 * AppointmentRepository.listDueForReminder (the NOT-EXISTS-equivalent
 * exclusion) and SmsNotificationService.scheduleAppointmentReminder (the
 * atomic duplicate-prevention guarantee); no notification-persistence
 * logic is duplicated here. */
export async function materializeDueReminders(deps: SmsWorkerDeps): Promise<void> {
  const before = new Date(Date.now() + REMINDER_WINDOW_MS);
  const dueAppointments = await deps.appointments.listDueForReminder(before);
  for (const appointment of dueAppointments) {
    await deps.smsNotificationService.scheduleAppointmentReminder(appointment);
  }
}

/**
 * Approved ordering: reclaimStaleProcessing -> processOneBatch ->
 * materializeDueReminders. A poll iteration processes only work that was
 * ALREADY due when the iteration began; anything newly materialized by
 * this same iteration is deliberately left for the NEXT iteration to
 * claim, rather than claimed and sent in the same pass. This keeps "work
 * consumed this cycle" and "work provisioned this cycle" conceptually
 * separate -- the added latency is bounded by POLL_INTERVAL_MS, negligible
 * against a reminder window measured in hours. processOneBatch is called
 * exactly once per iteration, never again after materializeDueReminders.
 */
export async function runOnePollIteration(deps: SmsWorkerDeps): Promise<void> {
  await deps.smsNotifications.reclaimStaleProcessing(STALE_PROCESSING_MS, BATCH_SIZE);
  await processOneBatch(deps);
  await materializeDueReminders(deps);
}

/** No setInterval anywhere -- each iteration (including its own sleep) is
 * fully awaited before the next begins, so iterations can never overlap
 * even if one runs long. In-flight work always runs to completion:
 * signal.stopped is only ever checked between iterations/before sleeping,
 * never used to abandon work already in progress. */
export async function runWorkerLoop(deps: SmsWorkerDeps, signal: ShutdownSignal): Promise<void> {
  while (!signal.stopped) {
    await runOnePollIteration(deps);
    if (signal.stopped) break;
    await interruptibleSleep(POLL_INTERVAL_MS, signal);
  }
}
