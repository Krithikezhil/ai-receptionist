import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryOrganizationSubscriptionRepository } from "./support/in-memory-organization-repositories.js";
import type {
  NewOrganizationSubscription,
  OrganizationSubscriptionRepository,
  OrganizationSubscriptionStatus,
} from "../src/repositories/organization-subscription-types.js";

/**
 * M13 Step 2: exercises the in-memory repository only, following the
 * sms-notification.repository.test.ts precedent (M11 Step 4A) -- this
 * repository has no HTTP caller yet (no service/route/controller exists in
 * this step), so there is no HTTP path to exercise it through. Uses
 * vi.useFakeTimers()/vi.setSystemTime() for deterministic
 * createdAt/updatedAt timing; no test waits on real elapsed time.
 */

function newSubscription(
  organizationId: string,
  overrides: Partial<NewOrganizationSubscription> = {},
): NewOrganizationSubscription {
  return { organizationId, ...overrides };
}

describe("OrganizationSubscriptionRepository (in-memory) -- M13 Step 2", () => {
  let repo: OrganizationSubscriptionRepository;

  beforeEach(() => {
    repo = createInMemoryOrganizationSubscriptionRepository();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("findByOrganizationId", () => {
    it("returns undefined when no subscription exists", async () => {
      const result = await repo.findByOrganizationId(randomUUID());
      expect(result).toBeUndefined();
    });
  });

  describe("findByStripeCustomerId", () => {
    it("returns undefined when no subscription has this Stripe customer id", async () => {
      const result = await repo.findByStripeCustomerId("cus_does_not_exist");
      expect(result).toBeUndefined();
    });

    it("finds the subscription with a matching stripeCustomerId", async () => {
      const organizationId = randomUUID();
      await repo.upsert(newSubscription(organizationId, { stripeCustomerId: "cus_abc" }));

      const found = await repo.findByStripeCustomerId("cus_abc");
      expect(found?.organizationId).toBe(organizationId);
    });

    it("keeps two organizations' Stripe customer ids isolated", async () => {
      const orgA = randomUUID();
      const orgB = randomUUID();
      await repo.upsert(newSubscription(orgA, { stripeCustomerId: "cus_a" }));
      await repo.upsert(newSubscription(orgB, { stripeCustomerId: "cus_b" }));

      const foundA = await repo.findByStripeCustomerId("cus_a");
      const foundB = await repo.findByStripeCustomerId("cus_b");
      expect(foundA?.organizationId).toBe(orgA);
      expect(foundB?.organizationId).toBe(orgB);
    });
  });

  describe("findByStripeSubscriptionId", () => {
    it("returns undefined when no subscription has this Stripe subscription id", async () => {
      const result = await repo.findByStripeSubscriptionId("sub_does_not_exist");
      expect(result).toBeUndefined();
    });

    it("finds the subscription with a matching stripeSubscriptionId", async () => {
      const organizationId = randomUUID();
      await repo.upsert(newSubscription(organizationId, { stripeSubscriptionId: "sub_abc" }));

      const found = await repo.findByStripeSubscriptionId("sub_abc");
      expect(found?.organizationId).toBe(organizationId);
    });

    it("keeps two organizations' Stripe subscription ids isolated", async () => {
      const orgA = randomUUID();
      const orgB = randomUUID();
      await repo.upsert(newSubscription(orgA, { stripeSubscriptionId: "sub_a" }));
      await repo.upsert(newSubscription(orgB, { stripeSubscriptionId: "sub_b" }));

      const foundA = await repo.findByStripeSubscriptionId("sub_a");
      const foundB = await repo.findByStripeSubscriptionId("sub_b");
      expect(foundA?.organizationId).toBe(orgA);
      expect(foundB?.organizationId).toBe(orgB);
    });
  });

  describe("upsert", () => {
    it("creates a subscription row on first call, matching the supplied fields", async () => {
      const organizationId = randomUUID();
      const created = await repo.upsert(
        newSubscription(organizationId, {
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          plan: "pro",
          status: "active",
          currentPeriodEnd: new Date("2030-02-01T00:00:00.000Z"),
        }),
      );

      expect(created).toEqual({
        organizationId,
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_123",
        plan: "pro",
        status: "active",
        currentPeriodEnd: new Date("2030-02-01T00:00:00.000Z"),
        currentPeriodStart: null,
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      });
    });

    it("establishes createdAt and updatedAt on creation", async () => {
      const organizationId = randomUUID();
      const created = await repo.upsert(newSubscription(organizationId));

      expect(created.createdAt).toEqual(new Date("2030-01-01T00:00:00.000Z"));
      expect(created.updatedAt).toEqual(new Date("2030-01-01T00:00:00.000Z"));
    });

    it("replaces subscription-state fields on a second call without creating a second row", async () => {
      const organizationId = randomUUID();
      await repo.upsert(
        newSubscription(organizationId, { plan: "starter", status: "incomplete" }),
      );

      vi.setSystemTime(new Date("2030-01-02T00:00:00.000Z"));
      const updated = await repo.upsert(
        newSubscription(organizationId, { plan: "pro", status: "active" }),
      );

      expect(updated.organizationId).toBe(organizationId);
      expect(updated.plan).toBe("pro");
      expect(updated.status).toBe("active");
    });

    it("preserves the original createdAt and refreshes updatedAt on a second call", async () => {
      const organizationId = randomUUID();
      const created = await repo.upsert(newSubscription(organizationId));

      vi.setSystemTime(new Date("2030-01-02T00:00:00.000Z"));
      const updated = await repo.upsert(newSubscription(organizationId, { plan: "pro" }));

      expect(updated.createdAt).toEqual(created.createdAt);
      expect(updated.updatedAt).not.toEqual(created.updatedAt);
      expect(updated.updatedAt).toEqual(new Date("2030-01-02T00:00:00.000Z"));
    });

    it("converts omitted optional fields to null, and round-trips explicit nullable values", async () => {
      const organizationId = randomUUID();
      const created = await repo.upsert(newSubscription(organizationId));

      expect(created.stripeCustomerId).toBeNull();
      expect(created.stripeSubscriptionId).toBeNull();
      expect(created.plan).toBeNull();
      expect(created.status).toBeNull();
      expect(created.currentPeriodEnd).toBeNull();

      const withValues = await repo.upsert(
        newSubscription(organizationId, {
          stripeCustomerId: "cus_456",
          stripeSubscriptionId: "sub_456",
          plan: "pro",
          status: "past_due",
          currentPeriodEnd: new Date("2030-03-01T00:00:00.000Z"),
        }),
      );
      expect(withValues.stripeCustomerId).toBe("cus_456");
      expect(withValues.stripeSubscriptionId).toBe("sub_456");
      expect(withValues.plan).toBe("pro");
      expect(withValues.status).toBe("past_due");
      expect(withValues.currentPeriodEnd).toEqual(new Date("2030-03-01T00:00:00.000Z"));

      const backToOmitted = await repo.upsert(newSubscription(organizationId));
      expect(backToOmitted.stripeCustomerId).toBeNull();
      expect(backToOmitted.stripeSubscriptionId).toBeNull();
      expect(backToOmitted.plan).toBeNull();
      expect(backToOmitted.status).toBeNull();
      expect(backToOmitted.currentPeriodEnd).toBeNull();
    });

    it.each<OrganizationSubscriptionStatus>(["active", "past_due", "canceled", "incomplete"])(
      "persists status %s correctly",
      async (status) => {
        const organizationId = randomUUID();
        const created = await repo.upsert(newSubscription(organizationId, { status }));
        expect(created.status).toBe(status);

        const found = await repo.findByOrganizationId(organizationId);
        expect(found?.status).toBe(status);
      },
    );

    it("keeps two organizations' subscriptions isolated", async () => {
      const orgA = randomUUID();
      const orgB = randomUUID();

      await repo.upsert(newSubscription(orgA, { plan: "starter" }));
      await repo.upsert(newSubscription(orgB, { plan: "pro" }));

      const foundA = await repo.findByOrganizationId(orgA);
      const foundB = await repo.findByOrganizationId(orgB);

      expect(foundA?.organizationId).toBe(orgA);
      expect(foundA?.plan).toBe("starter");
      expect(foundB?.organizationId).toBe(orgB);
      expect(foundB?.plan).toBe("pro");
    });
  });

  describe("update", () => {
    it("returns undefined and does not create a row for an organization with no subscription", async () => {
      const organizationId = randomUUID();
      const result = await repo.update(organizationId, { plan: "pro" });

      expect(result).toBeUndefined();
      expect(await repo.findByOrganizationId(organizationId)).toBeUndefined();
    });

    it("partially updates only the specified fields and refreshes updatedAt", async () => {
      const organizationId = randomUUID();
      const created = await repo.upsert(
        newSubscription(organizationId, {
          stripeCustomerId: "cus_123",
          plan: "starter",
          status: "incomplete",
        }),
      );

      vi.setSystemTime(new Date("2030-01-02T00:00:00.000Z"));
      const updated = await repo.update(organizationId, { status: "active" });

      expect(updated?.status).toBe("active");
      expect(updated?.plan).toBe("starter");
      expect(updated?.stripeCustomerId).toBe("cus_123");
      expect(updated?.createdAt).toEqual(created.createdAt);
      expect(updated?.updatedAt).toEqual(new Date("2030-01-02T00:00:00.000Z"));
    });

    it("updating one organization does not affect another organization's subscription", async () => {
      const orgA = randomUUID();
      const orgB = randomUUID();

      await repo.upsert(newSubscription(orgA, { plan: "starter", status: "incomplete" }));
      await repo.upsert(newSubscription(orgB, { plan: "pro", status: "active" }));

      await repo.update(orgA, { status: "canceled" });

      const foundA = await repo.findByOrganizationId(orgA);
      const foundB = await repo.findByOrganizationId(orgB);

      expect(foundA?.status).toBe("canceled");
      expect(foundB?.status).toBe("active");
      expect(foundB?.plan).toBe("pro");
    });
  });
});
