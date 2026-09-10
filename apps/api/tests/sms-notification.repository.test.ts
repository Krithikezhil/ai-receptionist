import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemorySmsNotificationRepository } from "./support/in-memory-organization-repositories.js";
import type {
  NewSmsNotification,
  SmsNotificationRepository,
} from "../src/repositories/sms-notification-types.js";

/**
 * M11 Step 4A: the first dedicated repository-level test file in this
 * codebase -- every other repository is exercised only indirectly, through
 * HTTP requests against buildTestApp() (see the "no dedicated per-service
 * test file" convention elsewhere in this test suite). findByProviderMessageSid
 * and reclaimStaleProcessing have no HTTP caller yet (the worker and
 * delivery-status webhook are explicitly out of Step 4A's scope), so there
 * is no HTTP path to exercise them through -- this file calls the in-memory
 * repository directly instead, deliberately deviating from the usual
 * convention rather than leaving these two methods untested.
 *
 * Exercises the in-memory repository only, per the approved Step 4A scope
 * -- no PostgreSQL dependency. Uses vi.useFakeTimers()/vi.setSystemTime()
 * for fully deterministic claimedAt/staleness timing; no test waits on
 * real elapsed time.
 */

function newAppointmentNotification(organizationId = randomUUID()): NewSmsNotification {
  return {
    organizationId,
    notificationType: "appointment_confirmation",
    destinationPhone: "+15551234567",
    appointmentId: randomUUID(),
  };
}

function newLeadNotification(organizationId = randomUUID()): NewSmsNotification {
  return {
    organizationId,
    notificationType: "lead_confirmation",
    destinationPhone: "+15557654321",
    leadId: randomUUID(),
  };
}

describe("SmsNotificationRepository (in-memory) -- M11 Step 4A", () => {
  let repo: SmsNotificationRepository;

  beforeEach(() => {
    repo = createInMemorySmsNotificationRepository();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("findByProviderMessageSid", () => {
    it("returns the row when providerMessageSid matches", async () => {
      const created = await repo.create(newAppointmentNotification());
      const updated = await repo.updateStatus(created.id, created.organizationId, {
        status: "sent",
        providerMessageSid: "SM123",
      });
      expect(updated).toBeDefined();

      const found = await repo.findByProviderMessageSid("SM123");
      expect(found?.id).toBe(created.id);
    });

    it("returns undefined for an unknown SID", async () => {
      const found = await repo.findByProviderMessageSid("SM-does-not-exist");
      expect(found).toBeUndefined();
    });

    it("is not organization-scoped -- a row from any organization is findable without supplying an organization id", async () => {
      const orgA = randomUUID();
      const orgB = randomUUID();
      await repo.create(newAppointmentNotification(orgA));
      const createdB = await repo.create(newAppointmentNotification(orgB));
      await repo.updateStatus(createdB.id, orgB, {
        status: "sent",
        providerMessageSid: "SM-org-b",
      });

      const found = await repo.findByProviderMessageSid("SM-org-b");
      expect(found?.organizationId).toBe(orgB);
    });
  });

  describe("reclaimStaleProcessing", () => {
    it("reclaims a stale processing row to pending, clearing claimedAt, without touching attemptCount", async () => {
      const created = await repo.create(newAppointmentNotification());
      const [claimed] = await repo.claimDue(10);
      expect(claimed).toBeDefined();
      expect(claimed!.status).toBe("processing");
      expect(claimed!.attemptCount).toBe(1);

      vi.setSystemTime(new Date("2030-01-01T00:06:00.000Z")); // 6 minutes later

      const [reclaimed] = await repo.reclaimStaleProcessing(5 * 60_000, 10);
      expect(reclaimed).toBeDefined();
      expect(reclaimed!.id).toBe(created.id);
      expect(reclaimed!.status).toBe("pending");
      expect(reclaimed!.claimedAt).toBeNull();
      expect(reclaimed!.attemptCount).toBe(1); // unchanged from the original claim
    });

    it("does not reclaim a processing row that is not yet stale", async () => {
      await repo.create(newAppointmentNotification());
      await repo.claimDue(10);

      vi.setSystemTime(new Date("2030-01-01T00:02:00.000Z")); // only 2 minutes later

      const reclaimed = await repo.reclaimStaleProcessing(5 * 60_000, 10);
      expect(reclaimed).toHaveLength(0);
    });

    it("does not touch a pending row", async () => {
      await repo.create(newAppointmentNotification());
      // never claimed -- still pending

      vi.setSystemTime(new Date("2030-01-01T00:10:00.000Z"));
      const reclaimed = await repo.reclaimStaleProcessing(0, 10);
      expect(reclaimed).toHaveLength(0);
    });

    it("does not touch a sent row", async () => {
      const created = await repo.create(newAppointmentNotification());
      const [claimed] = await repo.claimDue(10);
      await repo.updateStatus(claimed!.id, created.organizationId, {
        status: "sent",
        providerMessageSid: "SM-sent",
      });

      vi.setSystemTime(new Date("2030-01-01T00:10:00.000Z"));
      const reclaimed = await repo.reclaimStaleProcessing(0, 10);
      expect(reclaimed).toHaveLength(0);
    });

    it("does not touch a failed row", async () => {
      const created = await repo.create(newAppointmentNotification());
      const [claimed] = await repo.claimDue(10);
      await repo.updateStatus(claimed!.id, created.organizationId, {
        status: "failed",
        failureReason: "provider rejected the request",
      });

      vi.setSystemTime(new Date("2030-01-01T00:10:00.000Z"));
      const reclaimed = await repo.reclaimStaleProcessing(0, 10);
      expect(reclaimed).toHaveLength(0);
    });

    it("does not touch a skipped row", async () => {
      const created = await repo.create(newAppointmentNotification());
      const [claimed] = await repo.claimDue(10);
      await repo.updateStatus(claimed!.id, created.organizationId, { status: "skipped" });

      vi.setSystemTime(new Date("2030-01-01T00:10:00.000Z"));
      const reclaimed = await repo.reclaimStaleProcessing(0, 10);
      expect(reclaimed).toHaveLength(0);
    });

    it("reclaims multiple stale rows oldest-claimed-first, up to the given limit", async () => {
      await repo.create(newAppointmentNotification());
      const [claimedFirst] = await repo.claimDue(1); // claimed at T0

      vi.setSystemTime(new Date("2030-01-01T00:01:00.000Z"));
      await repo.create(newAppointmentNotification());
      const [claimedSecond] = await repo.claimDue(1); // claimed at T0+1min

      vi.setSystemTime(new Date("2030-01-01T00:02:00.000Z"));
      await repo.create(newAppointmentNotification());
      const [claimedThird] = await repo.claimDue(1); // claimed at T0+2min

      vi.setSystemTime(new Date("2030-01-01T01:00:00.000Z")); // all three now stale

      const reclaimed = await repo.reclaimStaleProcessing(5 * 60_000, 2); // limit 2
      expect(reclaimed).toHaveLength(2);
      expect(reclaimed[0]!.id).toBe(claimedFirst!.id);
      expect(reclaimed[1]!.id).toBe(claimedSecond!.id);

      // the third (most-recently-claimed) row is still processing -- limit respected
      const stillProcessing = await repo.findByIdAndOrganizationId(
        claimedThird!.id,
        claimedThird!.organizationId,
      );
      expect(stillProcessing?.status).toBe("processing");
    });
  });

  describe("providerStatus", () => {
    it("is null on a newly created notification", async () => {
      const created = await repo.create(newAppointmentNotification());
      expect(created.providerStatus).toBeNull();
    });

    it("can be set via updateStatus and round-trips correctly", async () => {
      const created = await repo.create(newLeadNotification());
      const updated = await repo.updateStatus(created.id, created.organizationId, {
        status: "sent",
        providerMessageSid: "SM-round-trip",
        providerStatus: "queued",
      });
      expect(updated?.providerStatus).toBe("queued");

      const found = await repo.findByIdAndOrganizationId(created.id, created.organizationId);
      expect(found?.providerStatus).toBe("queued");
    });

    it("stays null when updateStatus omits providerStatus", async () => {
      const created = await repo.create(newAppointmentNotification());
      const updated = await repo.updateStatus(created.id, created.organizationId, {
        status: "failed",
        failureReason: "network error",
      });
      expect(updated?.providerStatus).toBeNull();
    });
  });
});
