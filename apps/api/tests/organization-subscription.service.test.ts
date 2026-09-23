import { describe, expect, it } from "vitest";
import { createOrganizationSubscriptionService } from "../src/services/organization-subscription.service.js";
import { createInMemoryOrganizationSubscriptionRepository } from "./support/in-memory-organization-repositories.js";
import { createFakeStripeClient } from "./support/fake-stripe-client.js";

/**
 * M13 Step 5: unit-level coverage for ensureStripeCustomer(), isolated
 * from HTTP/auth (see organization-subscription.test.ts for the
 * controller/route-level owner/tenant-isolation coverage). Uses the same
 * in-memory OrganizationSubscriptionRepository double the repository test
 * file exercises, plus the new FakeStripeClient double -- no real Postgres
 * or Stripe network access.
 */
describe("OrganizationSubscriptionService.ensureStripeCustomer", () => {
  it("makes zero Stripe calls and zero writes when stripeCustomerId already exists", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    await repo.upsert({ organizationId: "org-1", stripeCustomerId: "cus_existing" });
    const service = createOrganizationSubscriptionService(repo, stripe);

    await service.ensureStripeCustomer("org-1");

    expect(stripe.calls).toHaveLength(0);
    const stored = await repo.findByOrganizationId("org-1");
    expect(stored?.stripeCustomerId).toBe("cus_existing");
  });

  it("creates exactly one Stripe customer with the correct organization metadata and idempotency key when missing", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    const service = createOrganizationSubscriptionService(repo, stripe);

    await service.ensureStripeCustomer("org-2");

    expect(stripe.calls).toHaveLength(1);
    expect(stripe.calls[0]?.params).toEqual({ organizationId: "org-2" });
    expect(stripe.calls[0]?.idempotencyKey).toBe("create-customer:org-2");
  });

  it("persists the returned Stripe customer id, readable back via the repository", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    stripe.nextCustomerId = "cus_new_123";
    const service = createOrganizationSubscriptionService(repo, stripe);

    await service.ensureStripeCustomer("org-3");

    const stored = await repo.findByOrganizationId("org-3");
    expect(stored?.stripeCustomerId).toBe("cus_new_123");
  });

  it("persists via the existing row's update path without clearing already-synced fields", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    stripe.nextCustomerId = "cus_new_456";
    // A row already exists (e.g. from a prior webhook sync) but has no
    // stripeCustomerId yet -- ensureStripeCustomer must preserve plan/
    // status/stripeSubscriptionId, not null them out.
    await repo.upsert({
      organizationId: "org-4",
      plan: "price_abc",
      status: "active",
      stripeSubscriptionId: "sub_abc",
    });
    const service = createOrganizationSubscriptionService(repo, stripe);

    await service.ensureStripeCustomer("org-4");

    const stored = await repo.findByOrganizationId("org-4");
    expect(stored?.stripeCustomerId).toBe("cus_new_456");
    expect(stored?.plan).toBe("price_abc");
    expect(stored?.status).toBe("active");
    expect(stored?.stripeSubscriptionId).toBe("sub_abc");
  });

  it("does not call update() when no subscription row exists at all", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    const service = createOrganizationSubscriptionService(repo, stripe);

    await service.ensureStripeCustomer("org-5");

    // If ensureStripeCustomer had used update() unconditionally here, this
    // would still be undefined -- confirming the row was actually created.
    const stored = await repo.findByOrganizationId("org-5");
    expect(stored).toBeDefined();
    expect(stored?.stripeCustomerId).toBeDefined();
  });

  it("does not persist anything when the Stripe client throws", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    stripe.failCreateCustomer = true;
    const service = createOrganizationSubscriptionService(repo, stripe);

    await expect(service.ensureStripeCustomer("org-6")).rejects.toThrow();

    const stored = await repo.findByOrganizationId("org-6");
    expect(stored).toBeUndefined();
  });
});
