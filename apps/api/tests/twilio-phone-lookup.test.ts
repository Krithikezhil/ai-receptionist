import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyCallCredential } from "../src/auth/call-credential.js";
import {
  buildTestApp,
  TEST_INTERNAL_SERVICE_KEY,
  TEST_TWILIO_CALL_CREDENTIAL_SECRET,
} from "./support/build-test-app.js";
import { createOrg, registerAgent, type TestAppContext } from "./support/http-helpers.js";

type Ctx = TestAppContext;

const AUTH_HEADER = `Bearer ${TEST_INTERNAL_SERVICE_KEY}`;
const CALL_SID = "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PHONE_NUMBER = "+15551234567";

describe("GET /internal/v1/twilio/phone-numbers/:phoneNumber", () => {
  let ctx: Ctx;
  let orgId: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const owner = await registerAgent(ctx, "owner@example.com");
    const created = await createOrg(owner.agent, "Acme Dental");
    orgId = created.organization.id;
    await ctx.organizationPhoneNumbers.create({ organizationId: orgId, phoneNumber: PHONE_NUMBER });
  });

  it("resolves a mapped number to its organization and mints a valid call credential", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/twilio/phone-numbers/${encodeURIComponent(PHONE_NUMBER)}`)
      .query({ callSid: CALL_SID })
      .set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(orgId);
    expect(typeof res.body.callCredential).toBe("string");

    const result = verifyCallCredential(
      res.body.callCredential,
      orgId,
      TEST_TWILIO_CALL_CREDENTIAL_SECRET,
      CALL_SID,
    );
    expect(result).toEqual({ valid: true, callSid: CALL_SID });
  });

  it("returns 404 for a number with no organization mapping", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/twilio/phone-numbers/${encodeURIComponent("+19998887777")}`)
      .query({ callSid: CALL_SID })
      .set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(404);
    expect(res.body.callCredential).toBeUndefined();
  });

  it("returns 400 when callSid is missing", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/twilio/phone-numbers/${encodeURIComponent(PHONE_NUMBER)}`)
      .set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(400);
  });

  it("returns 401 without a valid INTERNAL_SERVICE_KEY", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/twilio/phone-numbers/${encodeURIComponent(PHONE_NUMBER)}`)
      .query({ callSid: CALL_SID })
      .set("Authorization", "Bearer wrong-key");

    expect(res.status).toBe(401);
  });

  it("returns 401 with no Authorization header at all", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/twilio/phone-numbers/${encodeURIComponent(PHONE_NUMBER)}`)
      .query({ callSid: CALL_SID });

    expect(res.status).toBe(401);
  });

  it("never requires an organization-scoped token -- service auth alone is sufficient", async () => {
    // No X-Organization-Service-Token header at all, by design: this route
    // is what establishes which organization a call belongs to, so there is
    // no :organizationId to check a per-org credential against yet.
    const res = await request(ctx.app)
      .get(`/internal/v1/twilio/phone-numbers/${encodeURIComponent(PHONE_NUMBER)}`)
      .query({ callSid: CALL_SID })
      .set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
  });
});

describe("requireOrganizationAuth wired into the real internal routes (integration)", () => {
  let ctx: Ctx;
  let orgId: string;
  let orgToken: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const owner = await registerAgent(ctx, "owner2@example.com");
    const created = await createOrg(owner.agent, "Acme Salon");
    orgId = created.organization.id;
    orgToken = created.serviceCredential.token;
  });

  it("accepts the existing M5 dev token on runtime-context (fallback path still works end to end)", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set("X-Organization-Service-Token", orgToken);

    expect(res.status).toBe(200);
  });

  it("accepts a freshly minted M7 call credential on runtime-context", async () => {
    await ctx.organizationPhoneNumbers.create({ organizationId: orgId, phoneNumber: PHONE_NUMBER });
    const lookup = await request(ctx.app)
      .get(`/internal/v1/twilio/phone-numbers/${encodeURIComponent(PHONE_NUMBER)}`)
      .query({ callSid: CALL_SID })
      .set("Authorization", AUTH_HEADER);
    expect(lookup.status).toBe(200);

    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set("X-Organization-Service-Token", lookup.body.callCredential);

    expect(res.status).toBe(200);
  });

  it("rejects a call credential minted for a different organization on runtime-context", async () => {
    const otherOwner = await registerAgent(ctx, "other-owner@example.com");
    const otherOrg = await createOrg(otherOwner.agent, "Other Org");
    await ctx.organizationPhoneNumbers.create({
      organizationId: otherOrg.organization.id,
      phoneNumber: PHONE_NUMBER,
    });
    const lookup = await request(ctx.app)
      .get(`/internal/v1/twilio/phone-numbers/${encodeURIComponent(PHONE_NUMBER)}`)
      .query({ callSid: CALL_SID })
      .set("Authorization", AUTH_HEADER);
    expect(lookup.body.organizationId).toBe(otherOrg.organization.id);

    // otherOrg's credential presented against orgId's URL.
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set("X-Organization-Service-Token", lookup.body.callCredential);

    expect(res.status).toBe(403);
  });
});
