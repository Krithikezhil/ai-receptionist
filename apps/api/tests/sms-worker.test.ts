import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/config/logger.js";
import { TwilioSmsApiError } from "../src/services/twilio-sms-client-types.js";
import { createSmsNotificationService } from "../src/services/sms-notification.service.js";
import type { SmsNotification } from "../src/repositories/sms-notification-types.js";
import {
  BATCH_SIZE,
  MAX_ATTEMPTS,
  POLL_INTERVAL_MS,
  REMINDER_WINDOW_MS,
  STALE_PROCESSING_MS,
  classifyTwilioError,
  createShutdownSignal,
  describeTwilioFailure,
  materializeDueReminders,
  processOneBatch,
  resolveSenderNumber,
  runOnePollIteration,
  runWorkerLoop,
  type SmsWorkerDeps,
} from "../src/workers/sms-worker.js";
import {
  createInMemoryAppointmentRepository,
  createInMemoryBusinessProfileRepository,
  createInMemoryOrganizationPhoneNumberRepository,
  createInMemorySmsNotificationRepository,
  createInMemorySmsOptOutRepository,
} from "./support/in-memory-organization-repositories.js";
import { createFakeTwilioSmsClient } from "./support/fake-twilio-sms-client.js";

// Same stdout-capture pattern as twilio-sms-status-webhook.test.ts /
// logger-redaction.test.ts -- copied, not imported (file-local helper).
vi.hoisted(() => {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) =>
    originalWrite(...args)) as typeof process.stdout.write;
});

const STATUS_CALLBACK_URL = "https://api.example.com/twilio/sms-status";
const NETWORK_ERROR = () =>
  new TwilioSmsApiError("network", { httpStatus: null, twilioErrorCode: null, retryAfterMs: null });

function buildDeps() {
  const smsNotifications = createInMemorySmsNotificationRepository();
  const appointments = createInMemoryAppointmentRepository(smsNotifications);
  const businessProfiles = createInMemoryBusinessProfileRepository();
  const organizationPhoneNumbers = createInMemoryOrganizationPhoneNumberRepository();
  const smsOptOuts = createInMemorySmsOptOutRepository();
  const smsNotificationService = createSmsNotificationService(smsNotifications);
  const twilioSmsClient = createFakeTwilioSmsClient();

  const deps: SmsWorkerDeps = {
    smsNotifications,
    appointments,
    businessProfiles,
    organizationPhoneNumbers,
    smsOptOuts,
    smsNotificationService,
    twilioSmsClient,
    statusCallbackUrl: STATUS_CALLBACK_URL,
  };

  return {
    deps,
    smsNotifications,
    appointments,
    businessProfiles,
    organizationPhoneNumbers,
    smsOptOuts,
    twilioSmsClient,
  };
}

type Ctx = ReturnType<typeof buildDeps>;

/** Creates an organization with (by default) one sender number and a
 * business profile -- the minimum viable config for a send to succeed.
 * Pass numberCount: 0 / 2 or withBusinessProfile: false to exercise the
 * fail-closed config paths. */
async function seedOrg(
  ctx: Ctx,
  opts: { numberCount?: number; withBusinessProfile?: boolean } = {},
): Promise<string> {
  const organizationId = randomUUID();
  if (opts.withBusinessProfile ?? true) {
    await ctx.businessProfiles.create({ organizationId, businessName: "Acme Dental" });
  }
  const numberCount = opts.numberCount ?? 1;
  for (let i = 0; i < numberCount; i++) {
    await ctx.organizationPhoneNumbers.create({ organizationId, phoneNumber: `+1555123400${i}` });
  }
  return organizationId;
}

async function seedAppointment(
  ctx: Ctx,
  organizationId: string,
  overrides: { startTime: Date; status?: "scheduled" | "confirmed" | "cancelled" },
) {
  return ctx.appointments.create({
    organizationId,
    serviceId: randomUUID(),
    customerPhone: "+15559990000",
    startTime: overrides.startTime,
    endTime: new Date(overrides.startTime.getTime() + 30 * 60 * 1000),
    status: overrides.status,
  });
}

async function captureLogLines(run: () => Promise<unknown>): Promise<unknown[]> {
  const originalLevel = logger.level;
  logger.level = "info";
  const chunks: string[] = [];
  const writeSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown): boolean => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);
  try {
    await run();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    writeSpy.mockRestore();
    logger.level = originalLevel;
  }
  return chunks
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((line): line is unknown => line !== null);
}

describe("sms-worker", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildDeps();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("worker mechanics", () => {
    it("has the approved constants", () => {
      expect(BATCH_SIZE).toBe(10);
      expect(STALE_PROCESSING_MS).toBe(300_000);
      expect(POLL_INTERVAL_MS).toBe(5000);
      expect(MAX_ATTEMPTS).toBe(3);
      expect(REMINDER_WINDOW_MS).toBe(86_400_000);
    });

    it("runOnePollIteration reclaims stale rows with STALE_PROCESSING_MS/BATCH_SIZE, then processOneBatch claims up to BATCH_SIZE", async () => {
      const reclaimSpy = vi.spyOn(ctx.smsNotifications, "reclaimStaleProcessing");
      const claimSpy = vi.spyOn(ctx.smsNotifications, "claimDue");

      await runOnePollIteration(ctx.deps);

      expect(reclaimSpy).toHaveBeenCalledWith(STALE_PROCESSING_MS, BATCH_SIZE);
      expect(claimSpy).toHaveBeenCalledWith(BATCH_SIZE);
    });

    it("a notification stuck in processing past STALE_PROCESSING_MS is reclaimed and reprocessed within the next poll iteration", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });

      // Simulates a worker that claimed the row directly and then crashed
      // before ever calling processOneBatch -- the row is left "processing".
      const claimed = await ctx.smsNotifications.claimDue(BATCH_SIZE);
      expect(claimed.map((r) => r.id)).toContain(created.id);

      vi.setSystemTime(new Date(Date.now() + STALE_PROCESSING_MS + 1000));
      ctx.twilioSmsClient.nextResult = { sid: "reclaimed-sid", status: "queued" };

      await runOnePollIteration(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(1);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("sent");
      expect(row?.providerMessageSid).toBe("reclaimed-sid");
    });

    it("does not start a second poll iteration until the previous one (including its sleep) has finished", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const claimSpy = vi.spyOn(ctx.smsNotifications, "claimDue");
      const { signal, stop } = createShutdownSignal();

      const loopPromise = runWorkerLoop(ctx.deps, signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(claimSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
      expect(claimSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(claimSpy).toHaveBeenCalledTimes(2);

      stop();
      await vi.advanceTimersByTimeAsync(0);
      await loopPromise;
    });
  });

  describe("sender resolution (pure function)", () => {
    it("zero numbers -> no_sender_configured", () => {
      expect(resolveSenderNumber([])).toEqual({ status: "no_sender_configured" });
    });

    it("one number -> ok", () => {
      const result = resolveSenderNumber([
        { id: "p1", organizationId: "o1", phoneNumber: "+15551230000", createdAt: new Date() },
      ]);
      expect(result).toEqual({ status: "ok", phoneNumber: "+15551230000" });
    });

    it("multiple numbers -> ambiguous_sender", () => {
      const numbers = [
        { id: "p1", organizationId: "o1", phoneNumber: "+15551230000", createdAt: new Date() },
        { id: "p2", organizationId: "o1", phoneNumber: "+15551230001", createdAt: new Date() },
      ];
      expect(resolveSenderNumber(numbers)).toEqual({ status: "ambiguous_sender", count: 2 });
    });
  });

  describe("successful send", () => {
    it("normalizes the destination, uses the resolved sender, renders the body, and persists sid/providerStatus", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+1 (555) 999-0000", // deliberately non-normalized
        appointmentId: appointment.id,
      });

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(1);
      const call = ctx.twilioSmsClient.calls[0]!;
      expect(call.to).toBe("+15559990000");
      expect(call.from).toBe("+15551234000");
      expect(call.body).toContain("Acme Dental");
      expect(call.statusCallbackUrl).toBe(STATUS_CALLBACK_URL);

      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("sent");
      expect(row?.providerMessageSid).toMatch(/^fake-sid-/);
      expect(row?.providerStatus).toBe("queued");
    });
  });

  describe("single appointment lookup", () => {
    it("performs at most one appointment repository lookup per notification, reused for both the reminder recheck and rendering", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
        status: "scheduled",
      });
      await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_reminder",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });

      const lookupSpy = vi.spyOn(ctx.appointments, "findByIdAndOrganizationId");

      await processOneBatch(ctx.deps);

      expect(lookupSpy).toHaveBeenCalledTimes(1);
      expect(ctx.twilioSmsClient.calls).toHaveLength(1);
    });
  });

  describe("fail-closed sender/config resolution (retryable, capped then skipped)", () => {
    it("no sender configured -> pending with a sanitized reason on the first attempt, never reaching Twilio", async () => {
      const organizationId = await seedOrg(ctx, { numberCount: 0 });
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("pending");
      expect(row?.failureReason).toBe("no_sender_configured");
    });

    it("ambiguous sender (multiple numbers) -> pending with a sanitized reason, fail-closed rather than guessing", async () => {
      const organizationId = await seedOrg(ctx, { numberCount: 2 });
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("pending");
      expect(row?.failureReason).toBe("ambiguous_sender");
    });

    it("missing business profile -> pending with a sanitized reason, never reaching Twilio", async () => {
      const organizationId = await seedOrg(ctx, { withBusinessProfile: false });
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("pending");
      expect(row?.failureReason).toBe("business_profile_missing");
    });

    it("sender-resolution failure takes precedence over a missing business profile -- profile is never even looked up", async () => {
      const organizationId = await seedOrg(ctx, { numberCount: 0, withBusinessProfile: false });
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });

      const profileSpy = vi.spyOn(ctx.businessProfiles, "findByOrganizationId");

      await processOneBatch(ctx.deps);

      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("pending");
      expect(row?.failureReason).toBe("no_sender_configured");
      expect(profileSpy).not.toHaveBeenCalled();
    });

    it("a config failure exhausted to MAX_ATTEMPTS lands on skipped, not failed, and never once reaches Twilio", async () => {
      const organizationId = await seedOrg(ctx, { numberCount: 0 });
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });

      let last: SmsNotification | undefined;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await processOneBatch(ctx.deps);
        last = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
        if (attempt < MAX_ATTEMPTS) {
          expect(last?.status).toBe("pending");
          await ctx.smsNotifications.updateStatus(created.id, organizationId, {
            status: "pending",
            nextAttemptAt: new Date(0),
          });
        }
      }

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      expect(last?.status).toBe("skipped");
      expect(last?.failureReason).toBe("no_sender_configured");
    });
  });

  describe("immediate-skip failures (non-retryable)", () => {
    it("an unnormalizable destination phone is an immediate skip, never retried", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "not-a-real-phone-number",
        appointmentId: appointment.id,
      });

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("skipped");
      expect(row?.failureReason).toBe("destination_phone_invalid");
    });

    it("a confirmation whose appointment row is gone is an immediate skip, never rendered, never sent to Twilio", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });
      await ctx.appointments.deleteByIdAndOrganizationId(appointment.id, organizationId);

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("skipped");
      expect(row?.failureReason).toBe("appointment_not_found");
    });
  });

  describe("opt-out enforcement", () => {
    it("an opted-out recipient is skipped immediately, without calling Twilio", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });
      await ctx.smsOptOuts.optOut(organizationId, "+15559990000");

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("skipped");
      expect(row?.failureReason).toBe("recipient_opted_out");
    });

    it("checks the opt-out state using the normalized E.164 destination", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+1 (555) 999-0000", // deliberately non-normalized
        appointmentId: appointment.id,
      });
      // Opted out under the NORMALIZED form -- proves the check
      // normalizes before looking up, not before or independently of it.
      await ctx.smsOptOuts.optOut(organizationId, "+15559990000");

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("skipped");
      expect(row?.failureReason).toBe("recipient_opted_out");
    });

    it("an opt-out for a different organization does not suppress the same phone number here", async () => {
      const organizationId = await seedOrg(ctx);
      const otherOrganizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });
      await ctx.smsOptOuts.optOut(otherOrganizationId, "+15559990000");

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(1);
    });

    it("a non-opted-out recipient is unaffected (regression)", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(1);
    });

    it("suppresses an appointment_reminder notification the same way as a confirmation", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
        status: "scheduled",
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_reminder",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });
      await ctx.smsOptOuts.optOut(organizationId, "+15559990000");

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("skipped");
      expect(row?.failureReason).toBe("recipient_opted_out");
    });
  });

  describe("retryable Twilio failures", () => {
    it("network failure (httpStatus null) is retryable", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });
      ctx.twilioSmsClient.nextError = NETWORK_ERROR();

      await processOneBatch(ctx.deps);

      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("pending");
      expect(row?.failureReason).toBe("twilio_network_error");
    });

    it("5xx is retryable", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });
      ctx.twilioSmsClient.nextError = new TwilioSmsApiError("5xx", {
        httpStatus: 503,
        twilioErrorCode: null,
        retryAfterMs: null,
      });

      await processOneBatch(ctx.deps);

      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("pending");
      expect(row?.failureReason).toBe("twilio_server_error_503");
    });

    it("429 with Retry-After floors the scheduled delay at retryAfterMs", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });
      ctx.twilioSmsClient.nextError = new TwilioSmsApiError("429", {
        httpStatus: 429,
        twilioErrorCode: null,
        retryAfterMs: 400_000,
      });

      const before = new Date();
      await processOneBatch(ctx.deps);

      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("pending");
      expect(row?.failureReason).toBe("twilio_rate_limited");
      expect(row!.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before.getTime() + 400_000);
    });

    it("attempt 1's base delay is ~60s (within +/-20% jitter)", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });
      ctx.twilioSmsClient.nextError = NETWORK_ERROR();

      const before = new Date();
      await processOneBatch(ctx.deps);

      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      const delta = row!.nextAttemptAt.getTime() - before.getTime();
      expect(delta).toBeGreaterThanOrEqual(60_000 * 0.8 - 1000);
      expect(delta).toBeLessThanOrEqual(60_000 * 1.2 + 1000);
    });

    it("attempt 2's base delay is ~300s (within +/-20% jitter)", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });

      ctx.twilioSmsClient.nextError = NETWORK_ERROR();
      await processOneBatch(ctx.deps); // attempt 1
      const afterAttempt1 = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(afterAttempt1?.status).toBe("pending");

      await ctx.smsNotifications.updateStatus(created.id, organizationId, {
        status: "pending",
        nextAttemptAt: new Date(0),
      });

      ctx.twilioSmsClient.nextError = NETWORK_ERROR();
      const before = new Date();
      await processOneBatch(ctx.deps); // attempt 2
      const afterAttempt2 = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);

      const delta = afterAttempt2!.nextAttemptAt.getTime() - before.getTime();
      expect(delta).toBeGreaterThanOrEqual(300_000 * 0.8 - 1000);
      expect(delta).toBeLessThanOrEqual(300_000 * 1.2 + 1000);
    });

    it("never schedules a 4th attempt -- lands on failed at MAX_ATTEMPTS", async () => {
      const organizationId = await seedOrg(ctx);
      const appointment = await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 3_600_000),
      });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appointment.id,
      });

      let last: SmsNotification | undefined;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        ctx.twilioSmsClient.nextError = NETWORK_ERROR();
        await processOneBatch(ctx.deps);
        last = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
        if (attempt < MAX_ATTEMPTS) {
          expect(last?.status).toBe("pending");
          await ctx.smsNotifications.updateStatus(created.id, organizationId, {
            status: "pending",
            nextAttemptAt: new Date(0),
          });
        }
      }
      expect(last?.status).toBe("failed");
      expect(last?.failureReason).toBe("twilio_network_error");
    });
  });

  describe("terminal Twilio failures", () => {
    it.each([
      ["400", { httpStatus: 400, twilioErrorCode: null, retryAfterMs: null }, "twilio_bad_request"],
      ["401", { httpStatus: 401, twilioErrorCode: null, retryAfterMs: null }, "twilio_unauthorized"],
      [
        "21610 (unsubscribed)",
        { httpStatus: 400, twilioErrorCode: 21610, retryAfterMs: null },
        "twilio_recipient_unsubscribed",
      ],
      [
        "21211 (invalid To)",
        { httpStatus: 400, twilioErrorCode: 21211, retryAfterMs: null },
        "twilio_invalid_recipient",
      ],
    ] as const)(
      "%s is terminal on the first attempt, with a sanitized failureReason",
      async (_label, details, expectedReason) => {
        const organizationId = await seedOrg(ctx);
        const appointment = await seedAppointment(ctx, organizationId, {
          startTime: new Date(Date.now() + 3_600_000),
        });
        const created = await ctx.smsNotifications.create({
          organizationId,
          notificationType: "appointment_confirmation",
          destinationPhone: "+15559990000",
          appointmentId: appointment.id,
        });
        ctx.twilioSmsClient.nextError = new TwilioSmsApiError("terminal", details);

        await processOneBatch(ctx.deps);

        const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
        expect(row?.status).toBe("failed");
        expect(row?.failureReason).toBe(expectedReason);
      },
    );
  });

  describe("classifyTwilioError / describeTwilioFailure (pure functions)", () => {
    it("classifies and describes each named scenario consistently", () => {
      const cases: Array<
        [ConstructorParameters<typeof TwilioSmsApiError>[1], "retryable" | "terminal", string]
      > = [
        [{ httpStatus: null, twilioErrorCode: null, retryAfterMs: null }, "retryable", "twilio_network_error"],
        [{ httpStatus: 429, twilioErrorCode: null, retryAfterMs: null }, "retryable", "twilio_rate_limited"],
        [{ httpStatus: 503, twilioErrorCode: null, retryAfterMs: null }, "retryable", "twilio_server_error_503"],
        [{ httpStatus: 400, twilioErrorCode: null, retryAfterMs: null }, "terminal", "twilio_bad_request"],
        [{ httpStatus: 401, twilioErrorCode: null, retryAfterMs: null }, "terminal", "twilio_unauthorized"],
        [{ httpStatus: 400, twilioErrorCode: 21610, retryAfterMs: null }, "terminal", "twilio_recipient_unsubscribed"],
        [{ httpStatus: 400, twilioErrorCode: 21211, retryAfterMs: null }, "terminal", "twilio_invalid_recipient"],
      ];
      for (const [details, classification, reason] of cases) {
        const err = new TwilioSmsApiError("x", details);
        expect(classifyTwilioError(err)).toBe(classification);
        expect(describeTwilioFailure(err)).toBe(reason);
      }
    });
  });

  describe("unexpected error handling", () => {
    it("an unexpected (non-TwilioSmsApiError) failure for one notification does not stop the rest of the batch, is logged with a safe controlled classification only, and is recovered only via stale-reclaim", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const anchor = new Date("2026-01-01T00:00:00.000Z");
      vi.setSystemTime(anchor);

      const orgA = await seedOrg(ctx);
      const orgB = await seedOrg(ctx);
      const apptA = await seedAppointment(ctx, orgA, { startTime: new Date(anchor.getTime() + 3_600_000) });
      const apptB = await seedAppointment(ctx, orgB, { startTime: new Date(anchor.getTime() + 3_600_000) });
      const notifA = await ctx.smsNotifications.create({
        organizationId: orgA,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: apptA.id,
      });
      const notifB = await ctx.smsNotifications.create({
        organizationId: orgB,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990001",
        appointmentId: apptB.id,
      });

      const originalFindProfile = ctx.businessProfiles.findByOrganizationId.bind(ctx.businessProfiles);
      const simulatedMessage = "simulated unexpected repository failure";
      const profileSpy = vi
        .spyOn(ctx.businessProfiles, "findByOrganizationId")
        .mockImplementation(async (organizationId) => {
          if (organizationId === orgA) throw new Error(simulatedMessage);
          return originalFindProfile(organizationId);
        });

      const lines = await captureLogLines(async () => {
        await processOneBatch(ctx.deps);
      });

      expect(ctx.twilioSmsClient.calls).toHaveLength(1);
      const rowB = await ctx.smsNotifications.findByIdAndOrganizationId(notifB.id, orgB);
      expect(rowB?.status).toBe("sent");

      const rowA = await ctx.smsNotifications.findByIdAndOrganizationId(notifA.id, orgA);
      expect(rowA?.status).toBe("processing");
      expect(rowA?.failureReason).toBeNull();

      let sawErrorType = false;
      for (const line of lines) {
        const serialized = JSON.stringify(line);
        expect(serialized).not.toContain(simulatedMessage);
        if (serialized.includes('"errorType":"unexpected_error"')) sawErrorType = true;
      }
      expect(sawErrorType).toBe(true);

      profileSpy.mockRestore();

      vi.setSystemTime(new Date(anchor.getTime() + STALE_PROCESSING_MS + 1000));
      const reclaimed = await ctx.smsNotifications.reclaimStaleProcessing(STALE_PROCESSING_MS, BATCH_SIZE);
      expect(reclaimed.map((r) => r.id)).toContain(notifA.id);
    });
  });

  describe("appointment reminders", () => {
    it("materializes a scheduled appointment inside the 24h window", async () => {
      const organizationId = await seedOrg(ctx);
      await seedAppointment(ctx, organizationId, { startTime: new Date(Date.now() + 3_600_000), status: "scheduled" });
      await materializeDueReminders(ctx.deps);
      const claimed = await ctx.smsNotifications.claimDue(BATCH_SIZE);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.notificationType).toBe("appointment_reminder");
    });

    it("materializes a confirmed appointment inside the 24h window", async () => {
      const organizationId = await seedOrg(ctx);
      await seedAppointment(ctx, organizationId, { startTime: new Date(Date.now() + 3_600_000), status: "confirmed" });
      await materializeDueReminders(ctx.deps);
      const claimed = await ctx.smsNotifications.claimDue(BATCH_SIZE);
      expect(claimed).toHaveLength(1);
    });

    it("a late booking already inside the 24h window is still materialized", async () => {
      const organizationId = await seedOrg(ctx);
      await seedAppointment(ctx, organizationId, { startTime: new Date(Date.now() + 30 * 60 * 1000), status: "scheduled" });
      await materializeDueReminders(ctx.deps);
      const claimed = await ctx.smsNotifications.claimDue(BATCH_SIZE);
      expect(claimed).toHaveLength(1);
    });

    it("does not materialize an appointment outside the 24h window", async () => {
      const organizationId = await seedOrg(ctx);
      await seedAppointment(ctx, organizationId, {
        startTime: new Date(Date.now() + 2 * REMINDER_WINDOW_MS),
        status: "scheduled",
      });
      await materializeDueReminders(ctx.deps);
      const claimed = await ctx.smsNotifications.claimDue(BATCH_SIZE);
      expect(claimed).toHaveLength(0);
    });

    it("materializing reminders twice does not create a duplicate reminder for the same appointment", async () => {
      const organizationId = await seedOrg(ctx);
      await seedAppointment(ctx, organizationId, { startTime: new Date(Date.now() + 3_600_000), status: "scheduled" });

      await materializeDueReminders(ctx.deps);
      await materializeDueReminders(ctx.deps);

      const claimed = await ctx.smsNotifications.claimDue(BATCH_SIZE);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.notificationType).toBe("appointment_reminder");
    });

    it("a cancelled appointment's already-materialized reminder is skipped immediately, never reaching Twilio", async () => {
      const organizationId = await seedOrg(ctx);
      const appt = await seedAppointment(ctx, organizationId, { startTime: new Date(Date.now() + 3_600_000), status: "scheduled" });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_reminder",
        destinationPhone: "+15559990000",
        appointmentId: appt.id,
      });
      await ctx.appointments.updateStatus(appt.id, organizationId, { status: "cancelled" });

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("skipped");
      expect(row?.failureReason).toBe("appointment_no_longer_active");
    });

    it("a reminder whose appointment no longer exists is skipped immediately as appointment_not_found", async () => {
      const organizationId = await seedOrg(ctx);
      const appt = await seedAppointment(ctx, organizationId, { startTime: new Date(Date.now() + 3_600_000), status: "scheduled" });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_reminder",
        destinationPhone: "+15559990000",
        appointmentId: appt.id,
      });
      await ctx.appointments.deleteByIdAndOrganizationId(appt.id, organizationId);

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(0);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("skipped");
      expect(row?.failureReason).toBe("appointment_not_found");
    });

    it("an appointment_confirmation notification does NOT get the reminder-specific recheck -- it sends even if the appointment is later cancelled", async () => {
      const organizationId = await seedOrg(ctx);
      const appt = await seedAppointment(ctx, organizationId, { startTime: new Date(Date.now() + 3_600_000), status: "scheduled" });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appt.id,
      });
      await ctx.appointments.updateStatus(appt.id, organizationId, { status: "cancelled" });

      await processOneBatch(ctx.deps);

      expect(ctx.twilioSmsClient.calls).toHaveLength(1);
      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("sent");
    });
  });

  describe("safety", () => {
    it("the final emitted logs never contain the phone number or business name; the provider SID may appear", async () => {
      const organizationId = await seedOrg(ctx);
      const appt = await seedAppointment(ctx, organizationId, { startTime: new Date(Date.now() + 3_600_000) });
      await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appt.id,
      });

      const lines = await captureLogLines(async () => {
        await processOneBatch(ctx.deps);
      });

      expect(lines.length).toBeGreaterThan(0);
      const forbidden = ["+15559990000", "Acme Dental"];
      let sawSid = false;
      for (const line of lines) {
        const serialized = JSON.stringify(line);
        for (const secret of forbidden) expect(serialized).not.toContain(secret);
        if (/fake-sid-/.test(serialized)) sawSid = true;
      }
      expect(sawSid).toBe(true);
    });
  });

  describe("shutdown", () => {
    it("stop() interrupts an in-progress sleep promptly, cancels the pending timer, and never waits out the full poll interval", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const { signal, stop } = createShutdownSignal();

      const loopPromise = runWorkerLoop(ctx.deps, signal);
      await vi.advanceTimersByTimeAsync(0); // first iteration completes, loop enters sleep

      stop();
      await vi.advanceTimersByTimeAsync(0);
      await expect(loopPromise).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0); // clearTimeout actually ran -- no leftover timer
    });

    it("an in-flight batch finishes even if stop() is called mid-batch", async () => {
      const organizationId = await seedOrg(ctx);
      const appt = await seedAppointment(ctx, organizationId, { startTime: new Date(Date.now() + 3_600_000) });
      const created = await ctx.smsNotifications.create({
        organizationId,
        notificationType: "appointment_confirmation",
        destinationPhone: "+15559990000",
        appointmentId: appt.id,
      });

      let releaseSend!: () => void;
      const sendGate = new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
      const originalSendSms = ctx.twilioSmsClient.sendSms.bind(ctx.twilioSmsClient);
      ctx.twilioSmsClient.sendSms = async (input) => {
        await sendGate;
        return originalSendSms(input);
      };

      const { signal, stop } = createShutdownSignal();
      const batchPromise = processOneBatch(ctx.deps);
      stop();
      expect(signal.stopped).toBe(true);
      releaseSend();
      await batchPromise;

      const row = await ctx.smsNotifications.findByIdAndOrganizationId(created.id, organizationId);
      expect(row?.status).toBe("sent");
    });
  });
});
