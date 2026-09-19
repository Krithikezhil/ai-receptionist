import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
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
