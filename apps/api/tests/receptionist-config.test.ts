import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./support/build-test-app.js";
import { createOrg, registerAgent, type TestAppContext } from "./support/http-helpers.js";

type Ctx = TestAppContext;

describe("receptionist configuration (happy path)", () => {
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
    const res = await request(ctx.app).get(`/organizations/${orgId}/receptionist-config`);
    expect(res.status).toBe(401);
  });

  it("gets the default configuration created at organization creation, disabled", async () => {
    const res = await ownerAgent.get(`/organizations/${orgId}/receptionist-config`);
    expect(res.status).toBe(200);
    expect(res.body.receptionistConfig).toMatchObject({
      organizationId: orgId,
      enabled: false,
      displayName: "AI Receptionist",
      language: "en",
    });
    // No vendor/provider fields anywhere in the response.
    const keys = Object.keys(res.body.receptionistConfig);
    expect(keys).not.toContain("provider");
    expect(keys).not.toContain("apiKey");
    expect(keys).not.toContain("model");
  });

  it("updates the configuration, including enabling it", async () => {
    const res = await ownerAgent.put(`/organizations/${orgId}/receptionist-config`).send({
      enabled: true,
      displayName: "Ava",
      greeting: "Hi, thanks for calling Acme Dental!",
      tone: "warm and concise",
    });
    expect(res.status).toBe(200);
    expect(res.body.receptionistConfig).toMatchObject({
      enabled: true,
      displayName: "Ava",
      greeting: "Hi, thanks for calling Acme Dental!",
      tone: "warm and concise",
    });

    const getAfter = await ownerAgent.get(`/organizations/${orgId}/receptionist-config`);
    expect(getAfter.body.receptionistConfig.enabled).toBe(true);
  });

  it("rejects invalid update input", async () => {
    const res = await ownerAgent
      .put(`/organizations/${orgId}/receptionist-config`)
      .send({ displayName: "" });
    expect(res.status).toBe(400);
  });
});

describe("receptionist configuration tenant isolation", () => {
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

  it("a user who is not a member cannot read another organization's receptionist configuration", async () => {
    const res = await outsiderAgent.get(`/organizations/${orgId}/receptionist-config`);
    expect(res.status).toBe(404);
  });

  it("a user cannot modify another organization's receptionist configuration, and it stays unchanged", async () => {
    const res = await outsiderAgent
      .put(`/organizations/${orgId}/receptionist-config`)
      .send({ enabled: true, displayName: "Hijacked" });
    expect(res.status).toBe(404);

    const stillOriginal = await ctx.receptionistConfigs.findByOrganizationId(orgId);
    expect(stillOriginal?.enabled).toBe(false);
    expect(stillOriginal?.displayName).toBe("AI Receptionist");
  });

  it("changing the organization id in the request cannot bypass authorization or enable another org's receptionist", async () => {
    await createOrg(outsiderAgent, "Outsider Org");

    const res = await outsiderAgent
      .put(`/organizations/${orgId}/receptionist-config`)
      .send({ enabled: true });
    expect(res.status).toBe(404);

    const config = await ctx.receptionistConfigs.findByOrganizationId(orgId);
    expect(config?.enabled).toBe(false);
  });
});
