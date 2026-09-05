import { beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./support/build-test-app.js";
import { createOrg, registerAgent, type TestAppContext } from "./support/http-helpers.js";

type Ctx = TestAppContext;

describe("/organizations/:organizationId/phone-numbers", () => {
  let ctx: Ctx;
  let ownerAgent: Awaited<ReturnType<typeof registerAgent>>["agent"];
  let orgId: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const owner = await registerAgent(ctx, "owner@example.com");
    ownerAgent = owner.agent;
    const created = await createOrg(ownerAgent, "Acme Dental");
    orgId = created.organization.id;
  });

  describe("POST (create)", () => {
    it("lets the owner assign a valid E.164 number", async () => {
      const res = await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      expect(res.status).toBe(201);
      expect(res.body.phoneNumber).toMatchObject({
        organizationId: orgId,
        phoneNumber: "+15551234567",
      });
      expect(typeof res.body.phoneNumber.id).toBe("string");
    });

    it.each([
      ["missing leading +", "15551234567"],
      ["leading zero after +", "+05551234567"],
      ["contains letters", "+1555ABC4567"],
      ["contains a space", "+1 5551234567"],
      ["contains a dash", "+1-555-123-4567"],
      ["too long (16 digits)", "+1234567890123456"],
      ["empty string", ""],
    ])("rejects an invalid E.164 value: %s", async (_label, phoneNumber) => {
      const res = await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber });

      expect(res.status).toBe(400);
    });

    it("rejects a number that is already assigned to another organization (409)", async () => {
      const otherOwner = await registerAgent(ctx, "other-owner@example.com");
      const otherOrg = await createOrg(otherOwner.agent, "Other Org");
      await otherOwner.agent
        .post(`/organizations/${otherOrg.organization.id}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      const res = await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      expect(res.status).toBe(409);
    });

    it("rejects a number that is already assigned to the SAME organization (409, not a silent duplicate)", async () => {
      await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      const res = await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      expect(res.status).toBe(409);
      const numbers = await ctx.organizationPhoneNumbers.listByOrganizationId(orgId);
      expect(numbers).toHaveLength(1);
    });

    it("allows re-adding a number after it was deleted (proves uniqueness isn't a soft-delete artifact)", async () => {
      const created = await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });
      expect(created.status).toBe(201);

      const del = await ownerAgent.delete(
        `/organizations/${orgId}/phone-numbers/${created.body.phoneNumber.id}`,
      );
      expect(del.status).toBe(204);

      const recreated = await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });
      expect(recreated.status).toBe(201);
    });

    it("rejects a non-owner member (403)", async () => {
      const member = await registerAgent(ctx, "member@example.com");
      await ctx.memberships.create({ organizationId: orgId, userId: member.userId, role: "member" });

      const res = await member.agent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      expect(res.status).toBe(403);
    });

    it("returns 404 (not 403) for a user who is not a member of the organization at all", async () => {
      const stranger = await registerAgent(ctx, "stranger@example.com");
      const res = await stranger.agent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      expect(res.status).toBe(404);
    });
  });

  describe("GET (list)", () => {
    it("lets any member (not just the owner) list the organization's numbers", async () => {
      await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      const member = await registerAgent(ctx, "member2@example.com");
      await ctx.memberships.create({ organizationId: orgId, userId: member.userId, role: "member" });

      const res = await member.agent.get(`/organizations/${orgId}/phone-numbers`);

      expect(res.status).toBe(200);
      expect(res.body.phoneNumbers).toHaveLength(1);
      expect(res.body.phoneNumbers[0].phoneNumber).toBe("+15551234567");
    });

    it("never returns another organization's numbers (404 for a non-member)", async () => {
      const otherOwner = await registerAgent(ctx, "other-owner-2@example.com");
      const res = await otherOwner.agent.get(`/organizations/${orgId}/phone-numbers`);

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE (remove)", () => {
    it("lets the owner remove a number", async () => {
      const created = await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      const res = await ownerAgent.delete(
        `/organizations/${orgId}/phone-numbers/${created.body.phoneNumber.id}`,
      );

      expect(res.status).toBe(204);
      const remaining = await ctx.organizationPhoneNumbers.listByOrganizationId(orgId);
      expect(remaining).toHaveLength(0);
    });

    it("returns 404 for an id that doesn't exist", async () => {
      const res = await ownerAgent.delete(
        `/organizations/${orgId}/phone-numbers/00000000-0000-0000-0000-000000000000`,
      );
      expect(res.status).toBe(404);
    });

    it("rejects a non-owner member (403)", async () => {
      const created = await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      const member = await registerAgent(ctx, "member3@example.com");
      await ctx.memberships.create({ organizationId: orgId, userId: member.userId, role: "member" });

      const res = await member.agent.delete(
        `/organizations/${orgId}/phone-numbers/${created.body.phoneNumber.id}`,
      );

      expect(res.status).toBe(403);
      const remaining = await ctx.organizationPhoneNumbers.listByOrganizationId(orgId);
      expect(remaining).toHaveLength(1);
    });

    it("cross-tenant: an owner of a DIFFERENT organization cannot delete this org's number", async () => {
      const created = await ownerAgent
        .post(`/organizations/${orgId}/phone-numbers`)
        .send({ phoneNumber: "+15551234567" });

      const otherOwner = await registerAgent(ctx, "other-owner-3@example.com");
      const otherOrg = await createOrg(otherOwner.agent, "Other Org 2");

      // Attempting the delete via the OTHER organization's own URL --
      // requireOrgMembership 404s before the controller's owner check even
      // runs, since this user has no membership row for `orgId` at all.
      const res = await otherOwner.agent.delete(
        `/organizations/${otherOrg.organization.id}/phone-numbers/${created.body.phoneNumber.id}`,
      );

      expect(res.status).toBe(404);
      const remaining = await ctx.organizationPhoneNumbers.listByOrganizationId(orgId);
      expect(remaining).toHaveLength(1);
    });
  });
});
