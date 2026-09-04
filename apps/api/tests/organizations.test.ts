import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./support/build-test-app.js";
import { createOrg, registerAgent, type TestAppContext } from "./support/http-helpers.js";

type Ctx = TestAppContext;

describe("POST /organizations (creation)", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildTestApp();
  });

  it("rejects unauthenticated organization creation", async () => {
    const res = await request(ctx.app).post("/organizations").send({ name: "No Auth Co" });
    expect(res.status).toBe(401);
  });

  it("creates the organization with its owner membership and an initial business profile in one operation", async () => {
    const { agent, userId } = await registerAgent(ctx, "owner@example.com");

    const res = await agent.post("/organizations").send({ name: "Acme Dental" });

    expect(res.status).toBe(201);
    expect(res.body.organization).toMatchObject({ name: "Acme Dental" });
    expect(res.body.membership).toMatchObject({
      organizationId: res.body.organization.id,
      userId,
      role: "owner",
    });
    expect(res.body.businessProfile).toMatchObject({
      organizationId: res.body.organization.id,
      businessName: "Acme Dental",
    });
    // M4: a default receptionist configuration is seeded too, and it must
    // always be disabled — organization creation must never activate it.
    expect(res.body.receptionistConfig).toMatchObject({
      organizationId: res.body.organization.id,
      enabled: false,
      displayName: "AI Receptionist",
    });
    // M5: a per-organization internal-API service credential is seeded too,
    // returned exactly once, here — see internal-api.test.ts for the full
    // issuance/storage and cross-tenant-denial coverage.
    expect(typeof res.body.serviceCredential?.token).toBe("string");
    expect(res.body.serviceCredential.token.length).toBeGreaterThanOrEqual(32);

    // Verify directly against the repository too, not just the HTTP response.
    const membership = await ctx.memberships.findByOrgAndUser(res.body.organization.id, userId);
    expect(membership?.role).toBe("owner");
    const config = await ctx.receptionistConfigs.findByOrganizationId(res.body.organization.id);
    expect(config?.enabled).toBe(false);
    const credential = await ctx.organizationServiceCredentials.findByOrganizationId(
      res.body.organization.id,
    );
    expect(credential?.tokenHash).not.toBe(res.body.serviceCredential.token);
  });

  it("rejects invalid organization creation input", async () => {
    const { agent } = await registerAgent(ctx, "invalid@example.com");
    const res = await agent.post("/organizations").send({ name: "" });
    expect(res.status).toBe(400);
  });
});

describe("tenant isolation", () => {
  let ctx: Ctx;
  let ownerAgent: ReturnType<typeof request.agent>;
  let outsiderAgent: ReturnType<typeof request.agent>;
  let orgId: string;
  let serviceId: string;

  beforeEach(async () => {
    ctx = buildTestApp();

    const owner = await registerAgent(ctx, "owner@example.com");
    ownerAgent = owner.agent;
    const created = await createOrg(ownerAgent, "Owner Org");
    orgId = created.organization.id;

    const service = await ownerAgent
      .post(`/organizations/${orgId}/services`)
      .send({ name: "Haircut", durationMinutes: 30, price: 25 });
    serviceId = service.body.service.id;

    const outsider = await registerAgent(ctx, "outsider@example.com");
    outsiderAgent = outsider.agent;
  });

  it("1. rejects unauthenticated access to organization endpoints", async () => {
    const res = await request(ctx.app).get(`/organizations/${orgId}`);
    expect(res.status).toBe(401);
  });

  it("2. allows the authenticated owner to access their own organization", async () => {
    const res = await ownerAgent.get(`/organizations/${orgId}`);
    expect(res.status).toBe(200);
    expect(res.body.organization.id).toBe(orgId);
  });

  it("3. allows a non-owner member to access an organization they belong to", async () => {
    const member = await registerAgent(ctx, "member@example.com");
    await ctx.memberships.create({ organizationId: orgId, userId: member.userId, role: "member" });

    const res = await member.agent.get(`/organizations/${orgId}`);
    expect(res.status).toBe(200);
    expect(res.body.organization.id).toBe(orgId);
  });

  it("4. rejects a user who does not belong to the organization", async () => {
    const res = await outsiderAgent.get(`/organizations/${orgId}`);
    expect(res.status).toBe(404);
  });

  it("5. cannot bypass authorization by naming a different organization id in the request", async () => {
    // The outsider creates their own org, then tries to PATCH the owner's
    // org id directly — the URL id alone must never grant access.
    await createOrg(outsiderAgent, "Outsider Org");

    const res = await outsiderAgent.patch(`/organizations/${orgId}`).send({ name: "Hijacked" });
    expect(res.status).toBe(404);

    const stillOriginal = await ownerAgent.get(`/organizations/${orgId}`);
    expect(stillOriginal.body.organization.name).toBe("Owner Org");
  });

  it("6. rejects reading another organization's business profile", async () => {
    const res = await outsiderAgent.get(`/organizations/${orgId}/business-profile`);
    expect(res.status).toBe(404);
  });

  it("7. rejects modifying another organization's business profile, and leaves it unchanged", async () => {
    const res = await outsiderAgent
      .put(`/organizations/${orgId}/business-profile`)
      .send({ businessName: "Hijacked Business" });
    expect(res.status).toBe(404);

    const profile = await ctx.businessProfiles.findByOrganizationId(orgId);
    expect(profile?.businessName).toBe("Owner Org");
  });

  it("8. rejects listing another organization's services", async () => {
    const res = await outsiderAgent.get(`/organizations/${orgId}/services`);
    expect(res.status).toBe(404);
  });

  it("9. rejects modifying and deleting another organization's service", async () => {
    const updateRes = await outsiderAgent
      .patch(`/organizations/${orgId}/services/${serviceId}`)
      .send({ name: "Hijacked Service" });
    expect(updateRes.status).toBe(404);

    const deleteRes = await outsiderAgent.delete(`/organizations/${orgId}/services/${serviceId}`);
    expect(deleteRes.status).toBe(404);

    const stillThere = await ctx.services.findByIdAndOrganizationId(serviceId, orgId);
    expect(stillThere?.name).toBe("Haircut");
  });

  it("10. rejects a duplicate membership for the same (organization, user) pair", async () => {
    const ownerUser = await ctx.users.findByEmail("owner@example.com");
    await expect(
      ctx.memberships.create({ organizationId: orgId, userId: ownerUser!.id, role: "member" }),
    ).rejects.toThrow();
  });

  it("11. creates exactly the correct owner membership on organization creation (no extras, no missing)", async () => {
    const ownerUser = await ctx.users.findByEmail("owner@example.com");
    const allMembershipsForOwner = await ctx.memberships.listByUser(ownerUser!.id);
    expect(allMembershipsForOwner).toHaveLength(1);
    expect(allMembershipsForOwner[0]).toMatchObject({ organizationId: orgId, role: "owner" });
  });

  it("12. a spoofed organizationId in the request body cannot orphan a record into another organization", async () => {
    const outsiderOrg = await createOrg(outsiderAgent, "Outsider Org");

    // Attempt to create a service under the outsider's org URL while
    // claiming (via body) that it belongs to the owner's org instead.
    const res = await outsiderAgent
      .post(`/organizations/${outsiderOrg.organization.id}/services`)
      .send({ name: "Spoofed", durationMinutes: 15, organizationId: orgId });

    expect(res.status).toBe(201);
    // The service must belong to the URL's org (outsider's), never the
    // spoofed body value — and must not be visible to the owner's org.
    expect(res.body.service.organizationId).toBe(outsiderOrg.organization.id);
    const leakedIntoOwnerOrg = await ctx.services.findByIdAndOrganizationId(
      res.body.service.id,
      orgId,
    );
    expect(leakedIntoOwnerOrg).toBeUndefined();
  });
});

describe("organization-scoped resource CRUD (happy path)", () => {
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

  it("lists only organizations the authenticated user belongs to", async () => {
    const res = await ownerAgent.get("/organizations");
    expect(res.status).toBe(200);
    expect(res.body.organizations).toHaveLength(1);
    expect(res.body.organizations[0].id).toBe(orgId);
  });

  it("gets and updates the business profile", async () => {
    const get = await ownerAgent.get(`/organizations/${orgId}/business-profile`);
    expect(get.status).toBe(200);
    expect(get.body.businessProfile.businessName).toBe("Acme Dental");

    const update = await ownerAgent
      .put(`/organizations/${orgId}/business-profile`)
      .send({ businessName: "Acme Dental & Orthodontics", phone: "555-0100" });
    expect(update.status).toBe(200);
    expect(update.body.businessProfile).toMatchObject({
      businessName: "Acme Dental & Orthodontics",
      phone: "555-0100",
    });
  });

  it("gets default (closed, all 7 days) business hours and replaces them", async () => {
    const get = await ownerAgent.get(`/organizations/${orgId}/business-hours`);
    expect(get.status).toBe(200);
    expect(get.body.businessHours).toHaveLength(7);
    expect(get.body.businessHours.every((h: { isOpen: boolean }) => h.isOpen === false)).toBe(true);

    const entries = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isOpen: dayOfWeek >= 1 && dayOfWeek <= 5,
      openTime: dayOfWeek >= 1 && dayOfWeek <= 5 ? "09:00" : null,
      closeTime: dayOfWeek >= 1 && dayOfWeek <= 5 ? "17:00" : null,
    }));
    const put = await ownerAgent.put(`/organizations/${orgId}/business-hours`).send(entries);
    expect(put.status).toBe(200);
    expect(put.body.businessHours.filter((h: { isOpen: boolean }) => h.isOpen)).toHaveLength(5);
  });

  it("rejects business hours missing a day", async () => {
    const entries = Array.from({ length: 6 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isOpen: false,
      openTime: null,
      closeTime: null,
    }));
    const res = await ownerAgent.put(`/organizations/${orgId}/business-hours`).send(entries);
    expect(res.status).toBe(400);
  });

  it("creates, updates, and deletes a service", async () => {
    const create = await ownerAgent
      .post(`/organizations/${orgId}/services`)
      .send({ name: "Cleaning", durationMinutes: 45, price: 100 });
    expect(create.status).toBe(201);
    const serviceId = create.body.service.id as string;

    const update = await ownerAgent
      .patch(`/organizations/${orgId}/services/${serviceId}`)
      .send({ active: false });
    expect(update.status).toBe(200);
    expect(update.body.service.active).toBe(false);

    const remove = await ownerAgent.delete(`/organizations/${orgId}/services/${serviceId}`);
    expect(remove.status).toBe(204);

    const listAfter = await ownerAgent.get(`/organizations/${orgId}/services`);
    expect(listAfter.body.services).toHaveLength(0);
  });

  it("rejects deleting a service that doesn't exist", async () => {
    const res = await ownerAgent.delete(
      `/organizations/${orgId}/services/00000000-0000-0000-0000-000000000000`,
    );
    expect(res.status).toBe(404);
  });
});
