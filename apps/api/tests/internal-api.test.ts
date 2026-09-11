import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { generateCallCredential } from "../src/auth/call-credential.js";
import {
  buildTestApp,
  TEST_INTERNAL_SERVICE_KEY,
  TEST_TWILIO_CALL_CREDENTIAL_SECRET,
} from "./support/build-test-app.js";
import { createOrg, registerAgent, type TestAppContext } from "./support/http-helpers.js";

type Ctx = TestAppContext;

const AUTH_HEADER = `Bearer ${TEST_INTERNAL_SERVICE_KEY}`;
const ORG_TOKEN_HEADER = "X-Organization-Service-Token";

describe("internal voice API (happy path)", () => {
  let ctx: Ctx;
  let ownerAgent: ReturnType<typeof request.agent>;
  let orgId: string;
  let orgToken: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const owner = await registerAgent(ctx, "owner@example.com");
    ownerAgent = owner.agent;
    const created = await createOrg(ownerAgent, "Acme Dental");
    orgId = created.organization.id;
    orgToken = created.serviceCredential.token;
    await ownerAgent
      .post(`/organizations/${orgId}/knowledge`)
      .send({ title: "Parking", content: "Free parking behind the building.", category: "faq" });
  });

  it("returns an aggregated runtime-context for the organization's own credential", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgToken);

    expect(res.status).toBe(200);
    expect(res.body.runtimeContext).toMatchObject({
      organizationId: orgId,
      receptionistConfig: { enabled: false, displayName: "AI Receptionist", language: "en" },
      businessProfile: { businessName: "Acme Dental" },
    });
    expect(res.body.runtimeContext.businessHours).toHaveLength(7);
    expect(Array.isArray(res.body.runtimeContext.services)).toBe(true);
    // No vendor/provider fields anywhere — same provider-agnostic contract
    // as the public receptionist-config endpoint.
    const configKeys = Object.keys(res.body.runtimeContext.receptionistConfig);
    expect(configKeys).not.toContain("provider");
    expect(configKeys).not.toContain("apiKey");
    expect(configKeys).not.toContain("model");
  });

  it("returns knowledge entries for the organization's own credential", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/knowledge`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgToken);

    expect(res.status).toBe(200);
    expect(res.body.knowledge).toHaveLength(1);
    expect(res.body.knowledge[0]).toMatchObject({ title: "Parking", category: "faq" });
  });

  it("supports the same query filters as the public knowledge endpoint", async () => {
    await ownerAgent
      .post(`/organizations/${orgId}/knowledge`)
      .send({ title: "Refund policy", content: "Refunds within 30 days.", category: "policy" });

    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/knowledge?category=policy`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgToken);

    expect(res.status).toBe(200);
    expect(res.body.knowledge).toHaveLength(1);
    expect(res.body.knowledge[0].title).toBe("Refund policy");
  });

  it("q parameter is served by the ranked search path but keeps the same response shape", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/knowledge?q=parking`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgToken);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.knowledge)).toBe(true);
    expect(res.body.knowledge.length).toBeGreaterThan(0);
    expect(res.body.knowledge.length).toBeLessThanOrEqual(5);
    for (const entry of res.body.knowledge) {
      expect(Object.keys(entry).sort()).toEqual(["active", "category", "content", "id", "title"]);
    }
  });

  it("still returns a runtime-context (with enabled: false) for a disabled receptionist — gating is the voice-agent's job, not the API's", async () => {
    // Receptionist configuration is disabled by default at organization
    // creation (see organization.service.ts) — no extra setup needed.
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgToken);

    expect(res.status).toBe(200);
    expect(res.body.runtimeContext.receptionistConfig.enabled).toBe(false);
  });
});

describe("internal voice API — global service authentication (requireServiceAuth)", () => {
  let ctx: Ctx;
  let orgId: string;
  let orgToken: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const owner = await registerAgent(ctx, "owner@example.com");
    const created = await createOrg(owner.agent, "Acme Dental");
    orgId = created.organization.id;
    orgToken = created.serviceCredential.token;
  });

  it("rejects a request with no Authorization header at all", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/runtime-context`)
      .set(ORG_TOKEN_HEADER, orgToken);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid global service credential, even with a correct organization token", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/runtime-context`)
      .set("Authorization", "Bearer wrong-key")
      .set(ORG_TOKEN_HEADER, orgToken);
    expect(res.status).toBe(401);
  });

  it("rejects a global credential of a different length than the real key (length-guard path, not a timingSafeEqual crash)", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/runtime-context`)
      .set("Authorization", "Bearer short")
      .set(ORG_TOKEN_HEADER, orgToken);
    expect(res.status).toBe(401);
  });

  it("rejects a non-Bearer Authorization scheme", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgId}/runtime-context`)
      .set("Authorization", TEST_INTERNAL_SERVICE_KEY)
      .set(ORG_TOKEN_HEADER, orgToken);
    expect(res.status).toBe(401);
  });

  it("a valid session cookie alone (no service credential) does not authorize /internal/v1/*", async () => {
    const owner = await registerAgent(ctx, "cookie-owner@example.com");
    const res = await owner.agent
      .get(`/internal/v1/organizations/${orgId}/runtime-context`)
      .set(ORG_TOKEN_HEADER, orgToken);
    expect(res.status).toBe(401);
  });

  it("a valid service credential alone (no session cookie) does not authorize /organizations/*", async () => {
    const res = await request(ctx.app)
      .get(`/organizations/${orgId}/receptionist-config`)
      .set("Authorization", AUTH_HEADER);
    expect(res.status).toBe(401);
  });
});

describe("internal voice API — tenant/organization scoping", () => {
  let ctx: Ctx;
  let orgAId: string;
  let orgAToken: string;
  let orgBId: string;
  let orgBToken: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const ownerA = await registerAgent(ctx, "owner-a@example.com");
    const createdA = await createOrg(ownerA.agent, "Org A");
    orgAId = createdA.organization.id;
    orgAToken = createdA.serviceCredential.token;
    await ownerA.agent
      .post(`/organizations/${orgAId}/knowledge`)
      .send({ title: "Org A secret", content: "Only for Org A." });

    const ownerB = await registerAgent(ctx, "owner-b@example.com");
    const createdB = await createOrg(ownerB.agent, "Org B");
    orgBId = createdB.organization.id;
    orgBToken = createdB.serviceCredential.token;
  });

  it("a valid credential can read organization A using organization A's own token", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgAId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(res.status).toBe(200);
    expect(res.body.runtimeContext.organizationId).toBe(orgAId);
  });

  it("the same valid global credential can also read organization B using organization B's OWN token — each organization's token only ever authorizes itself, and each response only ever contains that organization's own data", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgBId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgBToken);
    expect(res.status).toBe(200);
    expect(res.body.runtimeContext.organizationId).toBe(orgBId);
    expect(res.body.runtimeContext.businessProfile).toMatchObject({ businessName: "Org B" });

    const knowledgeB = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgBId}/knowledge`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgBToken);
    // Org A's knowledge entry must never leak into Org B's response.
    expect(knowledgeB.body.knowledge).toHaveLength(0);
  });

  it("rejects a nonexistent organization id with 404", async () => {
    const res = await request(ctx.app)
      .get("/internal/v1/organizations/00000000-0000-0000-0000-000000000000/runtime-context")
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(res.status).toBe(404);
  });

  it("rejects a nonexistent organization id on the knowledge endpoint with 404", async () => {
    const res = await request(ctx.app)
      .get("/internal/v1/organizations/00000000-0000-0000-0000-000000000000/knowledge")
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(res.status).toBe(404);
  });

  it("returns 404 (route not found) when the organization id path segment is missing entirely", async () => {
    const res = await request(ctx.app)
      .get("/internal/v1/organizations//runtime-context")
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(res.status).toBe(404);
  });
});

describe("internal voice API — per-organization tenant authorization (requireOrganizationServiceToken)", () => {
  let ctx: Ctx;
  let orgAId: string;
  let orgAToken: string;
  let orgBId: string;
  let orgBToken: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const ownerA = await registerAgent(ctx, "owner-a@example.com");
    const createdA = await createOrg(ownerA.agent, "Org A");
    orgAId = createdA.organization.id;
    orgAToken = createdA.serviceCredential.token;

    const ownerB = await registerAgent(ctx, "owner-b@example.com");
    const createdB = await createOrg(ownerB.agent, "Org B");
    orgBId = createdB.organization.id;
    orgBToken = createdB.serviceCredential.token;
  });

  // 1. Org A token + Org A URL -> success.
  it("Org A's token authorizes Org A's own runtime-context", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgAId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(res.status).toBe(200);
    expect(res.body.runtimeContext.organizationId).toBe(orgAId);
  });

  // 2. Org A token + Org B URL -> denied (403). This is the exact scenario
  // that was previously (incorrectly) accepted — see git history on the
  // "tenant/organization scoping" describe block above.
  it("Org A's token does NOT authorize Org B — same valid global key, only the org id in the URL changes", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgBId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Not authorized for this organization." });
  });

  it("Org A's token does NOT authorize Org B's knowledge endpoint either", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgBId}/knowledge`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(res.status).toBe(403);
  });

  // 3. Org B token + Org B URL -> success.
  it("Org B's token authorizes Org B's own runtime-context", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgBId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgBToken);
    expect(res.status).toBe(200);
    expect(res.body.runtimeContext.organizationId).toBe(orgBId);
  });

  // 4. Missing organization token -> denied.
  it("denies access when the organization token header is missing entirely, even with a valid global key", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgAId}/runtime-context`)
      .set("Authorization", AUTH_HEADER);
    expect(res.status).toBe(403);
  });

  // 5. Invalid/wrong-length organization token -> denied safely.
  it("denies a wrong organization token safely", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgAId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, "completely-wrong-token");
    expect(res.status).toBe(403);
  });

  it("denies a wrong-length organization token via the length-guard path, not a timingSafeEqual crash", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgAId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, "short");
    expect(res.status).toBe(403);
  });

  // 6. Invalid global key + valid organization token -> denied (the outer
  // gate is still enforced first; a correct org token alone isn't enough).
  it("denies access when the global key is invalid, even with Org A's own correct token", async () => {
    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgAId}/runtime-context`)
      .set("Authorization", "Bearer wrong-global-key")
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(res.status).toBe(401);
  });

  // 9. Organization-ID tampering: reusing Org A's token cannot cross the
  // tenant boundary by editing the URL, for any other real organization.
  it("organization-ID tampering cannot cross the tenant boundary: swapping the URL id while reusing Org A's token fails for every other real organization", async () => {
    const ownerC = await registerAgent(ctx, "owner-c@example.com");
    const createdC = await createOrg(ownerC.agent, "Org C");

    const resB = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgBId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(resB.status).toBe(403);

    const resC = await request(ctx.app)
      .get(`/internal/v1/organizations/${createdC.organization.id}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(resC.status).toBe(403);

    // Org A's own url with its own token is still the only combination that works.
    const resA = await request(ctx.app)
      .get(`/internal/v1/organizations/${orgAId}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken);
    expect(resA.status).toBe(200);
  });
});

describe("organization service credential — issuance and storage", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = buildTestApp();
  });

  // 7. Organization creation returns the raw token once, while only its
  // hash is persisted.
  it("returns the raw service credential exactly once, in the creation response, and persists only its hash", async () => {
    const owner = await registerAgent(ctx, "owner@example.com");
    const created = await createOrg(owner.agent, "Acme Dental");

    expect(typeof created.serviceCredential.token).toBe("string");
    expect(created.serviceCredential.token.length).toBeGreaterThanOrEqual(32);

    const stored = await ctx.organizationServiceCredentials.findByOrganizationId(
      created.organization.id,
    );
    expect(stored).toBeDefined();
    expect(stored?.tokenHash).not.toBe(created.serviceCredential.token);
    // The stored value really is a SHA-256 hex digest, not the raw token
    // stored under a different key or lightly obfuscated.
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // 8. The credential hash/token can never appear in any normal API
  // response other than the one-time creation response.
  it("never includes the credential token or hash in GET /organizations/:id", async () => {
    const owner = await registerAgent(ctx, "owner@example.com");
    const created = await createOrg(owner.agent, "Acme Dental");

    const res = await owner.agent.get(`/organizations/${created.organization.id}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(created.serviceCredential.token);
    expect(Object.keys(res.body.organization)).not.toContain("serviceCredential");
    expect(Object.keys(res.body.organization)).not.toContain("tokenHash");
  });

  it("never includes the credential token or hash in GET /organizations (list)", async () => {
    const owner = await registerAgent(ctx, "owner@example.com");
    const created = await createOrg(owner.agent, "Acme Dental");

    const res = await owner.agent.get("/organizations");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(created.serviceCredential.token);
  });

  it("never includes the credential token or hash in the public receptionist-config response", async () => {
    const owner = await registerAgent(ctx, "owner@example.com");
    const created = await createOrg(owner.agent, "Acme Dental");

    const res = await owner.agent.get(
      `/organizations/${created.organization.id}/receptionist-config`,
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(created.serviceCredential.token);
    expect(Object.keys(res.body.receptionistConfig)).not.toContain("serviceCredential");
    expect(Object.keys(res.body.receptionistConfig)).not.toContain("tokenHash");
  });

  it("never includes the credential token or hash in the internal runtime-context response", async () => {
    const owner = await registerAgent(ctx, "owner@example.com");
    const created = await createOrg(owner.agent, "Acme Dental");

    const res = await request(ctx.app)
      .get(`/internal/v1/organizations/${created.organization.id}/runtime-context`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, created.serviceCredential.token);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(created.serviceCredential.token);
    expect(JSON.stringify(res.body)).not.toContain("tokenHash");
    expect(JSON.stringify(res.body)).not.toContain("serviceCredential");
  });
});

describe("internal voice API -- lead capture (M9 Step 6)", () => {
  let ctx: Ctx;
  let orgAId: string;
  let orgAToken: string;
  let orgBId: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const ownerA = await registerAgent(ctx, "owner-a@example.com");
    const createdA = await createOrg(ownerA.agent, "Org A");
    orgAId = createdA.organization.id;
    orgAToken = createdA.serviceCredential.token;

    const ownerB = await registerAgent(ctx, "owner-b@example.com");
    const createdB = await createOrg(ownerB.agent, "Org B");
    orgBId = createdB.organization.id;
  });

  it("creates a lead with a valid service credential and organization token", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/leads`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({ contactName: "Jane Caller", intent: "Wants a quote" });

    expect(res.status).toBe(201);
    expect(res.body.lead).toMatchObject({
      organizationId: orgAId,
      contactName: "Jane Caller",
      intent: "Wants a quote",
      status: "new",
    });

    const stored = await ctx.leads.findByIdAndOrganizationId(res.body.lead.id, orgAId);
    expect(stored).toBeDefined();
  });

  it("rejects a completely empty lead", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/leads`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects lead creation with no Authorization header", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/leads`)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({ contactName: "Jane Caller" });
    expect(res.status).toBe(401);
  });

  it("rejects lead creation with an invalid global service credential", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/leads`)
      .set("Authorization", "Bearer wrong-key")
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({ contactName: "Jane Caller" });
    expect(res.status).toBe(401);
  });

  it("rejects lead creation when the organization token is missing", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/leads`)
      .set("Authorization", AUTH_HEADER)
      .send({ contactName: "Jane Caller" });
    expect(res.status).toBe(403);
  });

  it("org A's token cannot create a lead for org B", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgBId}/leads`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({ contactName: "Jane Caller" });
    expect(res.status).toBe(403);

    const leaked = await ctx.leads.listByOrganizationId(orgBId);
    expect(leaked).toHaveLength(0);
  });

  it("ignores a spoofed organizationId in the request body -- the URL/token-verified id always wins", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/leads`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({ contactName: "Jane Caller", organizationId: orgBId });

    expect(res.status).toBe(201);
    expect(res.body.lead.organizationId).toBe(orgAId);

    const leakedIntoB = await ctx.leads.listByOrganizationId(orgBId);
    expect(leakedIntoB).toHaveLength(0);
  });

  it("newly created leads always have status 'new', never a caller-supplied value", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/leads`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({ contactName: "Jane Caller", status: "closed" });

    expect(res.status).toBe(201);
    expect(res.body.lead.status).toBe("new");
  });

  it("schedules exactly one lead_confirmation SMS notification when the lead has a contact phone number", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/leads`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({ contactName: "Jane Caller", contactPhone: "+15551234567", intent: "Wants a quote" });

    expect(res.status).toBe(201);

    const scheduled = await ctx.smsNotifications.claimDue(10);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      organizationId: orgAId,
      notificationType: "lead_confirmation",
      leadId: res.body.lead.id,
      appointmentId: null,
      destinationPhone: "+15551234567",
    });
  });

  it("creates no SMS notification when the lead has no contact phone number", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/leads`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({ contactName: "Jane Caller", intent: "Wants a quote" });

    expect(res.status).toBe(201);

    const scheduled = await ctx.smsNotifications.claimDue(10);
    expect(scheduled).toHaveLength(0);
  });
});

describe("internal voice API -- appointment booking (M11 Step 3 SMS confirmation)", () => {
  let ctx: Ctx;
  let orgAId: string;
  let orgAToken: string;
  let serviceId: string;

  const APPOINTMENT_DATE = "2030-01-07"; // a Monday
  const APPOINTMENT_TIME = "10:00";

  beforeEach(async () => {
    ctx = buildTestApp();
    const ownerA = await registerAgent(ctx, "owner-a@example.com");
    const createdA = await createOrg(ownerA.agent, "Org A");
    orgAId = createdA.organization.id;
    orgAToken = createdA.serviceCredential.token;

    const businessHoursEntries = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isOpen: dayOfWeek >= 1 && dayOfWeek <= 5,
      openTime: dayOfWeek >= 1 && dayOfWeek <= 5 ? "09:00" : null,
      closeTime: dayOfWeek >= 1 && dayOfWeek <= 5 ? "17:00" : null,
    }));
    const businessHoursRes = await ownerA.agent
      .put(`/organizations/${orgAId}/business-hours`)
      .send(businessHoursEntries);
    expect(businessHoursRes.status).toBe(200);

    const serviceRes = await ownerA.agent
      .post(`/organizations/${orgAId}/services`)
      .send({ name: "Consultation", durationMinutes: 60, price: 100 });
    expect(serviceRes.status).toBe(201);
    serviceId = serviceRes.body.service.id as string;

    // Deterministic, no-network "connected" calendar -- see the narrow
    // fakeCalendarConnectionService injection in build-test-app.ts. The
    // existing googleCalendarClient fake already defaults to no busy
    // periods and a successful createEvent, so no extra configuration is
    // needed for that half.
    ctx.fakeCalendarConnectionService.getAccessTokenResult = {
      status: "ok",
      accessToken: "fake-google-access-token",
      expiresAt: new Date(Date.now() + 3600_000),
    };
  });

  it("schedules exactly one appointment_confirmation SMS notification when the booking has a customer phone number", async () => {
    const bookRes = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/appointments`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({
        serviceId,
        date: APPOINTMENT_DATE,
        time: APPOINTMENT_TIME,
        customerName: "Jane Caller",
        customerPhone: "+15551234567",
      });

    expect(bookRes.status).toBe(201);
    expect(bookRes.body.appointment).toMatchObject({
      organizationId: orgAId,
      serviceId,
      customerPhone: "+15551234567",
      status: "scheduled",
    });

    const scheduled = await ctx.smsNotifications.claimDue(10);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      organizationId: orgAId,
      notificationType: "appointment_confirmation",
      appointmentId: bookRes.body.appointment.id,
      leadId: null,
      destinationPhone: "+15551234567",
    });
  });

  it("creates no SMS notification when the booking has no customer phone number", async () => {
    const bookRes = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/appointments`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({
        serviceId,
        date: APPOINTMENT_DATE,
        time: APPOINTMENT_TIME,
        customerName: "Jane Caller",
      });

    expect(bookRes.status).toBe(201);
    expect(bookRes.body.appointment).toMatchObject({
      organizationId: orgAId,
      serviceId,
      customerPhone: null,
      status: "scheduled",
    });

    const scheduled = await ctx.smsNotifications.claimDue(10);
    expect(scheduled).toHaveLength(0);
  });
});

describe("internal voice API -- call recording (M12 Step 5)", () => {
  let ctx: Ctx;
  let orgAId: string;
  let orgAToken: string;
  let orgBId: string;
  let orgBToken: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const ownerA = await registerAgent(ctx, "owner-a@example.com");
    const createdA = await createOrg(ownerA.agent, "Org A");
    orgAId = createdA.organization.id;
    orgAToken = createdA.serviceCredential.token;

    const ownerB = await registerAgent(ctx, "owner-b@example.com");
    const createdB = await createOrg(ownerB.agent, "Org B");
    orgBId = createdB.organization.id;
    orgBToken = createdB.serviceCredential.token;
  });

  it("records a call with a valid service credential and organization token (M5 token path)", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/calls`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({
        callSid: "CA-test-call-1",
        startedAt: "2026-01-01T10:00:00.000Z",
        endedAt: "2026-01-01T10:05:00.000Z",
        disposition: "completed",
      });

    expect(res.status).toBe(201);
    expect(res.body.call).toMatchObject({
      organizationId: orgAId,
      callSid: "CA-test-call-1",
      disposition: "completed",
    });
    expect(res.body.call.startedAt).toBe("2026-01-01T10:00:00.000Z");
    expect(res.body.call.endedAt).toBe("2026-01-01T10:05:00.000Z");
  });

  it("rejects invalid call data", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/calls`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({
        callSid: "CA-bad-datetime",
        startedAt: "not-a-date",
        endedAt: "2026-01-01T10:05:00.000Z",
        disposition: "completed",
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid call data." });

    const stored = await ctx.calls.listByOrganizationId(orgAId);
    expect(stored).toHaveLength(0);
  });

  it("rejects call recording with no Authorization header", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/calls`)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({
        callSid: "CA-no-auth",
        startedAt: "2026-01-01T10:00:00.000Z",
        endedAt: "2026-01-01T10:05:00.000Z",
        disposition: "completed",
      });

    expect(res.status).toBe(401);
  });

  // Matches requireOrganizationServiceToken existing, unmodified behavior
  // for a missing or invalid per-organization token -- see this same file
  // "denies access when the organization token header is missing entirely"
  // and lead-capture "rejects lead creation when the organization token is
  // missing" precedents, both 403. 401 is reserved for a missing or invalid
  // GLOBAL service key (requireServiceAuth) only.
  it("rejects call recording when the organization token is missing", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/calls`)
      .set("Authorization", AUTH_HEADER)
      .send({
        callSid: "CA-no-org-token",
        startedAt: "2026-01-01T10:00:00.000Z",
        endedAt: "2026-01-01T10:05:00.000Z",
        disposition: "completed",
      });

    expect(res.status).toBe(403);

    const stored = await ctx.calls.listByOrganizationId(orgAId);
    expect(stored).toHaveLength(0);
  });

  it("rejects using the org A token to record a call for org B", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgBId}/calls`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({
        callSid: "CA-cross-org",
        startedAt: "2026-01-01T10:00:00.000Z",
        endedAt: "2026-01-01T10:05:00.000Z",
        disposition: "completed",
      });

    expect(res.status).toBe(403);

    const leaked = await ctx.calls.listByOrganizationId(orgBId);
    expect(leaked).toHaveLength(0);
  });

  it("ignores a spoofed organizationId in the request body -- the route/token-verified id always wins", async () => {
    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/calls`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({
        callSid: "CA-spoofed-org",
        startedAt: "2026-01-01T10:00:00.000Z",
        endedAt: "2026-01-01T10:05:00.000Z",
        disposition: "completed",
        organizationId: orgBId,
      });

    expect(res.status).toBe(201);
    expect(res.body.call.organizationId).toBe(orgAId);

    const leakedIntoB = await ctx.calls.listByOrganizationId(orgBId);
    expect(leakedIntoB).toHaveLength(0);
  });

  it("records a call authenticated via a valid M7 call credential whose verified callSid matches the body", async () => {
    const credential = generateCallCredential(
      orgAId,
      "CA-test-call-2",
      TEST_TWILIO_CALL_CREDENTIAL_SECRET,
    );

    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/calls`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, credential)
      .send({
        callSid: "CA-test-call-2",
        startedAt: "2026-01-01T10:00:00.000Z",
        endedAt: "2026-01-01T10:05:00.000Z",
        disposition: "completed",
      });

    expect(res.status).toBe(201);
    expect(res.body.call.callSid).toBe("CA-test-call-2");

    const stored = await ctx.calls.listByOrganizationId(orgAId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.callSid).toBe("CA-test-call-2");
  });

  it("rejects a call credential whose verified callSid does not match the body callSid", async () => {
    const credential = generateCallCredential(
      orgAId,
      "CA-test-call-3",
      TEST_TWILIO_CALL_CREDENTIAL_SECRET,
    );

    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/calls`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, credential)
      .send({
        callSid: "CA-different-call",
        startedAt: "2026-01-01T10:00:00.000Z",
        endedAt: "2026-01-01T10:05:00.000Z",
        disposition: "completed",
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "callSid does not match the authenticated call." });

    const stored = await ctx.calls.listByOrganizationId(orgAId);
    expect(stored).toHaveLength(0);
  });

  it("rejects a call credential request with no body callSid at all (recordCallSchema requires it)", async () => {
    const credential = generateCallCredential(
      orgAId,
      "CA-test-call-4",
      TEST_TWILIO_CALL_CREDENTIAL_SECRET,
    );

    const res = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/calls`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, credential)
      .send({
        startedAt: "2026-01-01T10:00:00.000Z",
        endedAt: "2026-01-01T10:05:00.000Z",
        disposition: "completed",
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid call data." });

    const stored = await ctx.calls.listByOrganizationId(orgAId);
    expect(stored).toHaveLength(0);
  });

  it("allows the same callSid to be recorded under two different organizations (organization-scoped, not global, uniqueness)", async () => {
    const resA = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgAId}/calls`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgAToken)
      .send({
        callSid: "CA-shared-sid",
        startedAt: "2026-01-01T10:00:00.000Z",
        endedAt: "2026-01-01T10:05:00.000Z",
        disposition: "completed",
      });
    expect(resA.status).toBe(201);
    expect(resA.body.call.organizationId).toBe(orgAId);

    const resB = await request(ctx.app)
      .post(`/internal/v1/organizations/${orgBId}/calls`)
      .set("Authorization", AUTH_HEADER)
      .set(ORG_TOKEN_HEADER, orgBToken)
      .send({
        callSid: "CA-shared-sid",
        startedAt: "2026-01-01T11:00:00.000Z",
        endedAt: "2026-01-01T11:05:00.000Z",
        disposition: "failed",
      });
    expect(resB.status).toBe(201);
    expect(resB.body.call.organizationId).toBe(orgBId);

    const storedA = await ctx.calls.listByOrganizationId(orgAId);
    const storedB = await ctx.calls.listByOrganizationId(orgBId);
    expect(storedA).toHaveLength(1);
    expect(storedB).toHaveLength(1);
    expect(storedA[0]?.callSid).toBe("CA-shared-sid");
    expect(storedB[0]?.callSid).toBe("CA-shared-sid");
  });
});
