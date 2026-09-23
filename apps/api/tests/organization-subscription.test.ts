import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./support/build-test-app.js";
import { createOrg, registerAgent, type TestAppContext } from "./support/http-helpers.js";

type Ctx = TestAppContext;

describe("organization subscription status (M13 Step 3)", () => {
  let ctx: Ctx;
  let ownerAgent: ReturnType<typeof request.agent>;
  let orgId: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const owner = await registerAgent(ctx, "owner@example.com");
    ownerAgent = owner.agent;
    const created = await createOrg(ownerAgent, "Acme Dental");
    orgId = created.organization.id;
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(ctx.app).get(`/organizations/${orgId}/subscription`);
    expect(res.status).toBe(401);
  });

  it("returns the null-filled status when no subscription row exists", async () => {
    const res = await ownerAgent.get(`/organizations/${orgId}/subscription`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      plan: null,
      status: null,
      currentPeriodEnd: null,
    });
  });

  it("returns the subscription's plan/status/currentPeriodEnd when a row exists", async () => {
    await ctx.organizationSubscriptions.upsert({
      organizationId: orgId,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      plan: "pro",
      status: "active",
      currentPeriodEnd: new Date("2030-02-01T00:00:00.000Z"),
    });

    const res = await ownerAgent.get(`/organizations/${orgId}/subscription`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      plan: "pro",
      status: "active",
      currentPeriodEnd: "2030-02-01T00:00:00.000Z",
    });
  });

  it("never exposes stripeCustomerId or stripeSubscriptionId", async () => {
    await ctx.organizationSubscriptions.upsert({
      organizationId: orgId,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      plan: "pro",
      status: "active",
    });

    const res = await ownerAgent.get(`/organizations/${orgId}/subscription`);
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body);
    expect(keys).not.toContain("stripeCustomerId");
    expect(keys).not.toContain("stripeSubscriptionId");
  });
});

describe("organization subscription status tenant isolation", () => {
  let ctx: Ctx;
  let ownerAgent: ReturnType<typeof request.agent>;
  let outsiderAgent: ReturnType<typeof request.agent>;
  let orgId: string;

  beforeEach(async () => {
    ctx = buildTestApp();

    const owner = await registerAgent(ctx, "owner@example.com");
    ownerAgent = owner.agent;
    const created = await createOrg(ownerAgent, "Owner Org");
    orgId = created.organization.id;

    const outsider = await registerAgent(ctx, "outsider@example.com");
    outsiderAgent = outsider.agent;
  });

  it("a user who is not a member cannot read another organization's subscription status", async () => {
    const res = await outsiderAgent.get(`/organizations/${orgId}/subscription`);
    expect(res.status).toBe(404);
  });

  it("two organizations cannot see each other's subscription state", async () => {
    await ctx.organizationSubscriptions.upsert({
      organizationId: orgId,
      plan: "pro",
      status: "active",
    });

    const outsiderOrg = await createOrg(outsiderAgent, "Outsider Org");
    await ctx.organizationSubscriptions.upsert({
      organizationId: outsiderOrg.organization.id,
      plan: "starter",
      status: "incomplete",
    });

    const ownerRes = await ownerAgent.get(`/organizations/${orgId}/subscription`);
    expect(ownerRes.body).toEqual({
      plan: "pro",
      status: "active",
      currentPeriodEnd: null,
    });

    const outsiderRes = await outsiderAgent.get(
      `/organizations/${outsiderOrg.organization.id}/subscription`,
    );
    expect(outsiderRes.body).toEqual({
      plan: "starter",
      status: "incomplete",
      currentPeriodEnd: null,
    });

    // The outsider still cannot reach the owner org's subscription directly.
    const crossRes = await outsiderAgent.get(`/organizations/${orgId}/subscription`);
    expect(crossRes.status).toBe(404);
  });
});

describe("POST /organizations/:organizationId/subscription/stripe-customer (M13 Step 5)", () => {
  let ctx: Ctx;
  let ownerAgent: ReturnType<typeof request.agent>;
  let orgId: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const owner = await registerAgent(ctx, "owner@example.com");
    ownerAgent = owner.agent;
    const created = await createOrg(ownerAgent, "Acme Dental");
    orgId = created.organization.id;
  });

  it("rejects an unauthenticated request before the handler/service runs", async () => {
    const res = await request(ctx.app).post(`/organizations/${orgId}/subscription/stripe-customer`);
    expect(res.status).toBe(401);
    expect(ctx.stripeClient.calls).toHaveLength(0);
  });

  it("rejects a non-owner member (403) and never calls Stripe", async () => {
    const member = await registerAgent(ctx, "member@example.com");
    await ctx.memberships.create({ organizationId: orgId, userId: member.userId, role: "member" });

    const res = await member.agent.post(`/organizations/${orgId}/subscription/stripe-customer`);

    expect(res.status).toBe(403);
    expect(ctx.stripeClient.calls).toHaveLength(0);
  });

  it("rejects a user who is not a member of the organization at all (cross-organization access)", async () => {
    const outsider = await registerAgent(ctx, "outsider@example.com");

    const res = await outsider.agent.post(`/organizations/${orgId}/subscription/stripe-customer`);

    expect(res.status).toBe(404);
    expect(ctx.stripeClient.calls).toHaveLength(0);
  });

  it("returns 204 with no Stripe customer id (or any body) on success", async () => {
    const res = await ownerAgent.post(`/organizations/${orgId}/subscription/stripe-customer`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(res.text).toBe("");

    const stored = await ctx.organizationSubscriptions.findByOrganizationId(orgId);
    expect(stored?.stripeCustomerId).toBeDefined();
  });
});

describe("POST /organizations/:organizationId/subscription/checkout-session (M13 Step 6)", () => {
  let ctx: Ctx;
  let ownerAgent: ReturnType<typeof request.agent>;
  let orgId: string;
  const ENV_KEYS = [
    "STRIPE_SETUP_PRICE_ID",
    "STRIPE_LICENSED_PRICE_ID",
    "STRIPE_METERED_PRICE_ID",
    "STRIPE_CHECKOUT_SUCCESS_URL",
    "STRIPE_CHECKOUT_CANCEL_URL",
  ] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    process.env.STRIPE_SETUP_PRICE_ID = "price_setup";
    process.env.STRIPE_LICENSED_PRICE_ID = "price_licensed";
    process.env.STRIPE_METERED_PRICE_ID = "price_metered";
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = "https://example.com/success";
    process.env.STRIPE_CHECKOUT_CANCEL_URL = "https://example.com/cancel";

    ctx = buildTestApp();
    const owner = await registerAgent(ctx, "owner2@example.com");
    ownerAgent = owner.agent;
    const created = await createOrg(ownerAgent, "Acme Veterinary");
    orgId = created.organization.id;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("rejects an unauthenticated request before the handler/service runs", async () => {
    const res = await request(ctx.app).post(`/organizations/${orgId}/subscription/checkout-session`);
    expect(res.status).toBe(401);
    expect(ctx.stripeClient.calls).toHaveLength(0);
  });

  it("rejects a non-owner member (403) and never calls Stripe", async () => {
    const member = await registerAgent(ctx, "member2@example.com");
    await ctx.memberships.create({ organizationId: orgId, userId: member.userId, role: "member" });

    const res = await member.agent.post(`/organizations/${orgId}/subscription/checkout-session`);

    expect(res.status).toBe(403);
    expect(ctx.stripeClient.calls).toHaveLength(0);
  });

  it("rejects a user who is not a member of the organization at all (cross-organization access)", async () => {
    const outsider = await registerAgent(ctx, "outsider2@example.com");

    const res = await outsider.agent.post(`/organizations/${orgId}/subscription/checkout-session`);

    expect(res.status).toBe(404);
    expect(ctx.stripeClient.calls).toHaveLength(0);
  });

  it("returns only the Checkout URL on success, with no Stripe identifiers in the response", async () => {
    ctx.stripeClient.nextCheckoutUrl = "https://checkout.stripe.com/fake-session-xyz";

    const res = await ownerAgent.post(`/organizations/${orgId}/subscription/checkout-session`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://checkout.stripe.com/fake-session-xyz" });
    const keys = Object.keys(res.body);
    expect(keys).toEqual(["url"]);
  });

  it("ensures a Stripe customer as part of the same request when none exists yet", async () => {
    await ownerAgent.post(`/organizations/${orgId}/subscription/checkout-session`);

    const stored = await ctx.organizationSubscriptions.findByOrganizationId(orgId);
    expect(stored?.stripeCustomerId).toBeDefined();
  });
});
