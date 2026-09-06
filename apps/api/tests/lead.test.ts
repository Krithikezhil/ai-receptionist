import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./support/build-test-app.js";
import { createOrg, registerAgent, type TestAppContext } from "./support/http-helpers.js";

type Ctx = TestAppContext;

describe("lead dashboard endpoints (happy path)", () => {
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
    const res = await request(ctx.app).get(`/organizations/${orgId}/leads`);
    expect(res.status).toBe(401);
  });

  it("lists leads captured for the organization", async () => {
    await ctx.leads.create({
      organizationId: orgId,
      contactName: "Jane Caller",
      contactPhone: "555-1234",
      intent: "Wants a quote",
    });
    await ctx.leads.create({
      organizationId: orgId,
      contactEmail: "someone@example.com",
      notes: "Asked about hours",
    });

    const res = await ownerAgent.get(`/organizations/${orgId}/leads`);
    expect(res.status).toBe(200);
    expect(res.body.leads).toHaveLength(2);
    expect(res.body.leads.every((l: { status: string }) => l.status === "new")).toBe(true);
  });

  it("filters leads by status", async () => {
    const a = await ctx.leads.create({ organizationId: orgId, contactName: "A" });
    await ctx.leads.create({ organizationId: orgId, contactName: "B" });
    await ctx.leads.updateStatus(a.id, orgId, { status: "contacted" });

    const res = await ownerAgent.get(`/organizations/${orgId}/leads?status=contacted`);
    expect(res.status).toBe(200);
    expect(res.body.leads).toHaveLength(1);
    expect(res.body.leads[0].contactName).toBe("A");
  });

  it("rejects an invalid status filter value", async () => {
    const res = await ownerAgent.get(`/organizations/${orgId}/leads?status=bogus`);
    expect(res.status).toBe(400);
  });

  it("updates a lead's status", async () => {
    const lead = await ctx.leads.create({ organizationId: orgId, contactName: "Jane Caller" });

    const res = await ownerAgent
      .patch(`/organizations/${orgId}/leads/${lead.id}`)
      .send({ status: "closed" });
    expect(res.status).toBe(200);
    expect(res.body.lead.status).toBe("closed");
  });

  it("rejects an invalid status value", async () => {
    const lead = await ctx.leads.create({ organizationId: orgId, contactName: "Jane Caller" });

    const res = await ownerAgent
      .patch(`/organizations/${orgId}/leads/${lead.id}`)
      .send({ status: "bogus" });
    expect(res.status).toBe(400);
  });

  it("ignores any fields beyond status in the update body", async () => {
    const lead = await ctx.leads.create({
      organizationId: orgId,
      contactName: "Jane Caller",
      contactPhone: "555-1234",
    });

    const res = await ownerAgent.patch(`/organizations/${orgId}/leads/${lead.id}`).send({
      status: "contacted",
      contactName: "Hijacked Name",
      contactPhone: "000-0000",
      organizationId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(200);
    expect(res.body.lead.contactName).toBe("Jane Caller");
    expect(res.body.lead.contactPhone).toBe("555-1234");
    expect(res.body.lead.organizationId).toBe(orgId);
  });

  it("rejects updating/deleting a lead that doesn't exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const update = await ownerAgent
      .patch(`/organizations/${orgId}/leads/${fakeId}`)
      .send({ status: "closed" });
    expect(update.status).toBe(404);

    const remove = await ownerAgent.delete(`/organizations/${orgId}/leads/${fakeId}`);
    expect(remove.status).toBe(404);
  });

  it("deletes a lead", async () => {
    const lead = await ctx.leads.create({ organizationId: orgId, contactName: "Jane Caller" });

    const remove = await ownerAgent.delete(`/organizations/${orgId}/leads/${lead.id}`);
    expect(remove.status).toBe(204);

    const listAfter = await ownerAgent.get(`/organizations/${orgId}/leads`);
    expect(listAfter.body.leads).toHaveLength(0);
  });
});

describe("lead dashboard endpoints tenant isolation", () => {
  let ctx: Ctx;
  let ownerAgent: ReturnType<typeof request.agent>;
  let outsiderAgent: ReturnType<typeof request.agent>;
  let orgId: string;
  let leadId: string;

  beforeEach(async () => {
    ctx = buildTestApp();

    const owner = await registerAgent(ctx, "owner@example.com");
    ownerAgent = owner.agent;
    const created = await createOrg(ownerAgent, "Owner Org");
    orgId = created.organization.id;

    const lead = await ctx.leads.create({
      organizationId: orgId,
      contactName: "Secret Lead",
      notes: "Confidential internal content.",
    });
    leadId = lead.id;

    const outsider = await registerAgent(ctx, "outsider@example.com");
    outsiderAgent = outsider.agent;
  });

  it("a user who is not a member cannot list another organization's leads", async () => {
    const res = await outsiderAgent.get(`/organizations/${orgId}/leads`);
    expect(res.status).toBe(404);
  });

  it("a user cannot update another organization's lead, and it stays unchanged", async () => {
    const res = await outsiderAgent
      .patch(`/organizations/${orgId}/leads/${leadId}`)
      .send({ status: "closed" });
    expect(res.status).toBe(404);

    const stillThere = await ctx.leads.findByIdAndOrganizationId(leadId, orgId);
    expect(stillThere?.status).toBe("new");
  });

  it("a user cannot delete another organization's lead", async () => {
    const res = await outsiderAgent.delete(`/organizations/${orgId}/leads/${leadId}`);
    expect(res.status).toBe(404);

    const stillThere = await ctx.leads.findByIdAndOrganizationId(leadId, orgId);
    expect(stillThere).toBeDefined();
  });

  it("changing the organization id in the request path cannot bypass authorization", async () => {
    const outsiderOrg = await createOrg(outsiderAgent, "Outsider Org");
    const res = await outsiderAgent
      .patch(`/organizations/${orgId}/leads/${leadId}`)
      .send({ status: "closed" });
    expect(res.status).toBe(404);
    const outsiderList = await outsiderAgent.get(
      `/organizations/${outsiderOrg.organization.id}/leads`,
    );
    expect(outsiderList.body.leads).toHaveLength(0);
  });
});
