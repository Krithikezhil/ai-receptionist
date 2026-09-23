import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInMemoryCallUsageReportRepository } from "./support/in-memory-organization-repositories.js";
import type { NewCallUsageReport } from "../src/repositories/call-usage-report-types.js";

/**
 * M13: durable local usage-reporting ledger -- exercises the in-memory
 * repository only, following the stripe-webhook-event.repository.test.ts
 * precedent (no service/worker exists yet in this step, so there is no
 * higher-level path to exercise this through). Note: the repository's
 * lookup method is findByCallIdAndOrganizationId (tenant-scoped, mirroring
 * LeadRepository/AppointmentRepository's own findByIdAndOrganizationId
 * convention), not a bare findByCallId -- no such method exists.
 */

function newReport(overrides: Partial<NewCallUsageReport> = {}): NewCallUsageReport {
  return {
    callId: randomUUID(),
    organizationId: randomUUID(),
    ...overrides,
  };
}

describe("CallUsageReportRepository (in-memory)", () => {
  describe("insertIfAbsent", () => {
    it("creates a usage report successfully", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const report = newReport();

      const created = await repo.insertIfAbsent(report);

      expect(created).toBeDefined();
      // Verify the full persisted domain object shape -- every field the
      // domain type declares, not just the ones supplied at creation.
      expect(created).toMatchObject({
        callId: report.callId,
        organizationId: report.organizationId,
        billableMinutes: null,
        meterEventIdentifier: null,
        reportedAt: null,
      });
      expect(typeof created?.id).toBe("string");
      expect(created?.createdAt).toBeInstanceOf(Date);
    });

    it("does not create a second row for a duplicate callId", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const report = newReport();

      const first = await repo.insertIfAbsent(report);
      // Even a different organizationId for the same callId must be
      // rejected -- callId alone is the dedupe key, mirroring
      // stripeWebhookEvents.insertIfAbsent's "id alone is the dedupe key"
      // regression coverage.
      const second = await repo.insertIfAbsent({
        callId: report.callId,
        organizationId: randomUUID(),
      });

      expect(first).toBeDefined();
      expect(second).toBeUndefined();

      const stored = await repo.findByCallIdAndOrganizationId(report.callId, report.organizationId);
      expect(stored?.organizationId).toBe(report.organizationId);
    });
  });

  describe("findByCallIdAndOrganizationId", () => {
    it("returns the expected report for a matching call and organization", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const report = newReport();
      const created = await repo.insertIfAbsent(report);

      const found = await repo.findByCallIdAndOrganizationId(report.callId, report.organizationId);

      expect(found).toEqual(created);
    });

    it("returns undefined when no report exists for the call", async () => {
      const repo = createInMemoryCallUsageReportRepository();

      const found = await repo.findByCallIdAndOrganizationId(randomUUID(), randomUUID());

      expect(found).toBeUndefined();
    });

    it("does not return another organization's report for the same callId lookup", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const report = newReport();
      await repo.insertIfAbsent(report);

      const found = await repo.findByCallIdAndOrganizationId(report.callId, randomUUID());

      expect(found).toBeUndefined();
    });
  });

  describe("update", () => {
    it("updates billableMinutes without changing unrelated fields", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const report = newReport();
      const created = await repo.insertIfAbsent(report);

      const updated = await repo.update(report.callId, report.organizationId, {
        billableMinutes: 3,
      });

      expect(updated?.billableMinutes).toBe(3);
      expect(updated?.meterEventIdentifier).toBeNull();
      expect(updated?.reportedAt).toBeNull();
      expect(updated?.id).toBe(created?.id);
      expect(updated?.createdAt).toEqual(created?.createdAt);
    });

    it("stores meterEventIdentifier without changing unrelated fields", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const report = newReport();
      await repo.insertIfAbsent(report);
      await repo.update(report.callId, report.organizationId, { billableMinutes: 5 });

      const updated = await repo.update(report.callId, report.organizationId, {
        meterEventIdentifier: "meter-event:some-call-id",
      });

      expect(updated?.meterEventIdentifier).toBe("meter-event:some-call-id");
      // The previously set billableMinutes must survive an update that
      // does not mention it.
      expect(updated?.billableMinutes).toBe(5);
      expect(updated?.reportedAt).toBeNull();
    });

    it("stores reportedAt without changing unrelated fields", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const report = newReport();
      await repo.insertIfAbsent(report);
      await repo.update(report.callId, report.organizationId, {
        billableMinutes: 2,
        meterEventIdentifier: "meter-event:another-call-id",
      });

      const reportedAt = new Date("2030-01-01T00:00:00.000Z");
      const updated = await repo.update(report.callId, report.organizationId, { reportedAt });

      expect(updated?.reportedAt).toEqual(reportedAt);
      expect(updated?.billableMinutes).toBe(2);
      expect(updated?.meterEventIdentifier).toBe("meter-event:another-call-id");
    });

    it("returns undefined and does not update when the organizationId does not match", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const report = newReport();
      await repo.insertIfAbsent(report);

      const result = await repo.update(report.callId, randomUUID(), { billableMinutes: 9 });

      expect(result).toBeUndefined();
      const unchanged = await repo.findByCallIdAndOrganizationId(report.callId, report.organizationId);
      expect(unchanged?.billableMinutes).toBeNull();
    });

    it("returns undefined for a callId with no existing report", async () => {
      const repo = createInMemoryCallUsageReportRepository();

      const result = await repo.update(randomUUID(), randomUUID(), { billableMinutes: 1 });

      expect(result).toBeUndefined();
    });
  });

  describe("listUnreportedByOrganizationId", () => {
    it("returns only reports where reportedAt is null", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const organizationId = randomUUID();
      const unreported = newReport({ organizationId });
      const reported = newReport({ organizationId });
      await repo.insertIfAbsent(unreported);
      await repo.insertIfAbsent(reported);
      await repo.update(reported.callId, organizationId, {
        reportedAt: new Date("2030-02-01T00:00:00.000Z"),
      });

      const results = await repo.listUnreportedByOrganizationId(organizationId);

      expect(results).toHaveLength(1);
      expect(results[0]?.callId).toBe(unreported.callId);
    });

    it("excludes reported rows from the unreported query", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const organizationId = randomUUID();
      const report = newReport({ organizationId });
      await repo.insertIfAbsent(report);
      await repo.update(report.callId, organizationId, {
        reportedAt: new Date("2030-03-01T00:00:00.000Z"),
      });

      const results = await repo.listUnreportedByOrganizationId(organizationId);

      expect(results).toHaveLength(0);
    });

    it("does not leak another organization's unreported reports", async () => {
      const repo = createInMemoryCallUsageReportRepository();
      const orgA = randomUUID();
      const orgB = randomUUID();
      await repo.insertIfAbsent(newReport({ organizationId: orgA }));
      await repo.insertIfAbsent(newReport({ organizationId: orgB }));
      await repo.insertIfAbsent(newReport({ organizationId: orgB }));

      const resultsA = await repo.listUnreportedByOrganizationId(orgA);
      const resultsB = await repo.listUnreportedByOrganizationId(orgB);

      expect(resultsA).toHaveLength(1);
      expect(resultsB).toHaveLength(2);
      expect(resultsA.every((r) => r.organizationId === orgA)).toBe(true);
      expect(resultsB.every((r) => r.organizationId === orgB)).toBe(true);
    });

    it("returns an empty array for an organization with no reports at all", async () => {
      const repo = createInMemoryCallUsageReportRepository();

      const results = await repo.listUnreportedByOrganizationId(randomUUID());

      expect(results).toEqual([]);
    });
  });
});
