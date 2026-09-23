import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

/**
 * M13 Step 6: createCheckoutSession() unit coverage. Stripe Price-ID and
 * redirect-URL env vars are stubbed per-test, mirroring
 * stripe-webhook-route.test.ts's existing STRIPE_WEBHOOK_SECRET save/
 * restore pattern -- these are read directly via process.env at point of
 * use (see organization-subscription.service.ts's loadStripePriceIds()/
 * loadStripeCheckoutRedirectUrls()), not injected.
 */
describe("OrganizationSubscriptionService.createCheckoutSession", () => {
  const ENV_KEYS = [
    "STRIPE_SETUP_PRICE_ID",
    "STRIPE_LICENSED_PRICE_ID",
    "STRIPE_METERED_PRICE_ID",
    "STRIPE_CHECKOUT_SUCCESS_URL",
    "STRIPE_CHECKOUT_CANCEL_URL",
  ] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    process.env.STRIPE_SETUP_PRICE_ID = "price_setup";
    process.env.STRIPE_LICENSED_PRICE_ID = "price_licensed";
    process.env.STRIPE_METERED_PRICE_ID = "price_metered";
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = "https://example.com/success";
    process.env.STRIPE_CHECKOUT_CANCEL_URL = "https://example.com/cancel";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("calls ensureStripeCustomer (creates a customer when none exists yet)", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    const service = createOrganizationSubscriptionService(repo, stripe);

    await service.createCheckoutSession("org-1");

    const createCustomerCalls = stripe.calls.filter((c) => c.method === "createCustomer");
    expect(createCustomerCalls).toHaveLength(1);
    const stored = await repo.findByOrganizationId("org-1");
    expect(stored?.stripeCustomerId).toBeDefined();
  });

  it("short-circuits customer creation when stripeCustomerId already exists", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    await repo.upsert({ organizationId: "org-2", stripeCustomerId: "cus_existing" });
    const service = createOrganizationSubscriptionService(repo, stripe);

    await service.createCheckoutSession("org-2");

    const createCustomerCalls = stripe.calls.filter((c) => c.method === "createCustomer");
    expect(createCustomerCalls).toHaveLength(0);
  });

  it("uses the ensured stripeCustomerId as the Checkout Session customer", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    await repo.upsert({ organizationId: "org-3", stripeCustomerId: "cus_existing_3" });
    const service = createOrganizationSubscriptionService(repo, stripe);

    await service.createCheckoutSession("org-3");

    const checkoutCalls = stripe.calls.filter((c) => c.method === "createCheckoutSession");
    expect(checkoutCalls).toHaveLength(1);
    expect(checkoutCalls[0]?.method === "createCheckoutSession" && checkoutCalls[0].params.customerId).toBe(
      "cus_existing_3",
    );
  });

  it("returns only the Checkout URL", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    stripe.nextCheckoutUrl = "https://checkout.stripe.com/session-abc";
    await repo.upsert({ organizationId: "org-4", stripeCustomerId: "cus_4" });
    const service = createOrganizationSubscriptionService(repo, stripe);

    const url = await service.createCheckoutSession("org-4");

    expect(url).toBe("https://checkout.stripe.com/session-abc");
  });

  it("sends a fresh, request-specific idempotency key each call (not a stable per-organization key)", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    await repo.upsert({ organizationId: "org-5", stripeCustomerId: "cus_5" });
    const service = createOrganizationSubscriptionService(repo, stripe);

    await service.createCheckoutSession("org-5");
    await service.createCheckoutSession("org-5");

    const checkoutCalls = stripe.calls.filter((c) => c.method === "createCheckoutSession");
    expect(checkoutCalls).toHaveLength(2);
    const keys = checkoutCalls.map((c) => c.idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).not.toBe(`create-customer:org-5`);
  });

  it("does not persist anything Checkout-Session-related locally", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    await repo.upsert({ organizationId: "org-6", stripeCustomerId: "cus_6" });
    const service = createOrganizationSubscriptionService(repo, stripe);

    await service.createCheckoutSession("org-6");

    const stored = await repo.findByOrganizationId("org-6");
    // Only the fields ensureStripeCustomer/webhook sync already own exist
    // on this row -- no new Checkout-related field was introduced.
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      [
        "organizationId",
        "stripeCustomerId",
        "stripeSubscriptionId",
        "plan",
        "status",
        "currentPeriodEnd",
        "currentPeriodStart",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
  });

  it("propagates a Stripe client failure without returning a URL", async () => {
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    stripe.failCreateCheckoutSession = true;
    await repo.upsert({ organizationId: "org-7", stripeCustomerId: "cus_7" });
    const service = createOrganizationSubscriptionService(repo, stripe);

    await expect(service.createCheckoutSession("org-7")).rejects.toThrow();
  });

  it("fails closed when Price IDs are not configured", async () => {
    delete process.env.STRIPE_SETUP_PRICE_ID;
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    await repo.upsert({ organizationId: "org-8", stripeCustomerId: "cus_8" });
    const service = createOrganizationSubscriptionService(repo, stripe);

    await expect(service.createCheckoutSession("org-8")).rejects.toThrow();
    const checkoutCalls = stripe.calls.filter((c) => c.method === "createCheckoutSession");
    expect(checkoutCalls).toHaveLength(0);
  });

  it("fails closed when redirect URLs are not configured", async () => {
    delete process.env.STRIPE_CHECKOUT_SUCCESS_URL;
    const repo = createInMemoryOrganizationSubscriptionRepository();
    const stripe = createFakeStripeClient();
    await repo.upsert({ organizationId: "org-9", stripeCustomerId: "cus_9" });
    const service = createOrganizationSubscriptionService(repo, stripe);

    await expect(service.createCheckoutSession("org-9")).rejects.toThrow();
    const checkoutCalls = stripe.calls.filter((c) => c.method === "createCheckoutSession");
    expect(checkoutCalls).toHaveLength(0);
  });
});
