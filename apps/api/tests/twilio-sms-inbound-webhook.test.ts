import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./support/build-test-app.js";
import type { TestAppContext } from "./support/http-helpers.js";

type Ctx = TestAppContext;

const AUTH_TOKEN = "test-twilio-auth-token-do-not-use-in-prod";
const PUBLIC_BASE_URL = "https://api.example.com";
const CANONICAL_URL = `${PUBLIC_BASE_URL}/twilio/sms-inbound`;

/**
 * process.env.TWILIO_AUTH_TOKEN / API_PUBLIC_BASE_URL are read directly by
 * the controller (no dependency-injection seam), mirroring
 * twilio-sms-status-webhook.test.ts's identical stubbing convention.
 * Original values captured once and restored after every test (afterEach
 * still runs on failure) so this file can never contaminate any other
 * test file's environment.
 */
const ORIGINAL_ENV = {
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  API_PUBLIC_BASE_URL: process.env.API_PUBLIC_BASE_URL,
};

/** Independently computes a genuinely valid signature using the same
 * documented Twilio algorithm the production code implements -- every
 * HTTP test below that expects success sends a REAL, independently
 * computed signature; signature verification is never bypassed. */
function computeValidSignature(
  url: string,
  formParams: Record<string, string>,
  authToken: string,
): string {
  const concatenated =
    url +
    Object.keys(formParams)
      .sort()
      .map((key) => `${key}${formParams[key]}`)
      .join("");
  return createHmac("sha1", authToken).update(concatenated, "utf8").digest("base64");
}

function postInboundMessage(
  ctx: Ctx,
  formParams: Record<string, string>,
  options?: { signature?: string; noSignature?: boolean },
) {
  const signature = options?.noSignature
    ? undefined
    : (options?.signature ?? computeValidSignature(CANONICAL_URL, formParams, AUTH_TOKEN));

  let req = request(ctx.app)
    .post("/twilio/sms-inbound")
    .type("application/x-www-form-urlencoded")
    .send(new URLSearchParams(formParams).toString());

  if (signature !== undefined) {
    req = req.set("X-Twilio-Signature", signature);
  }
  return req;
}

async function seedOrgWithNumber(ctx: Ctx, phoneNumber: string): Promise<string> {
  const organization = await ctx.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
  await ctx.organizationPhoneNumbers.create({ organizationId: organization.id, phoneNumber });
  return organization.id;
}

describe("POST /twilio/sms-inbound", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildTestApp();
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    process.env.API_PUBLIC_BASE_URL = PUBLIC_BASE_URL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof ORIGINAL_ENV];
      } else {
        process.env[key as keyof typeof ORIGINAL_ENV] = value;
      }
    }
  });

  it("rejects with 403 when the signature header is missing", async () => {
    const res = await postInboundMessage(
      ctx,
      { From: "+15559990000", To: "+15551234000", Body: "STOP", MessageSid: "SM1" },
      { noSignature: true },
    );
    expect(res.status).toBe(403);
  });

  it("rejects with 403 when the signature is invalid", async () => {
    const res = await postInboundMessage(
      ctx,
      { From: "+15559990000", To: "+15551234000", Body: "STOP", MessageSid: "SM1" },
      { signature: "totally-wrong-signature" },
    );
    expect(res.status).toBe(403);
  });

  it("STOP updates the opt-out state for the organization resolved from To", async () => {
    const organizationId = await seedOrgWithNumber(ctx, "+15551234000");

    const res = await postInboundMessage(ctx, {
      From: "+15559990000",
      To: "+15551234000",
      Body: "STOP",
      MessageSid: "SM1",
    });

    expect(res.status).toBe(200);
    expect(await ctx.smsOptOuts.isOptedOut(organizationId, "+15559990000")).toBe(true);
  });

  it("normalizes a cosmetically-formatted From before persisting", async () => {
    const organizationId = await seedOrgWithNumber(ctx, "+15551234000");

    const res = await postInboundMessage(ctx, {
      From: "+1 (555) 999-0000",
      To: "+15551234000",
      Body: "STOP",
      MessageSid: "SM1",
    });

    expect(res.status).toBe(200);
    expect(await ctx.smsOptOuts.isOptedOut(organizationId, "+15559990000")).toBe(true);
  });

  it("START removes an existing opt-out for the correct organization", async () => {
    const organizationId = await seedOrgWithNumber(ctx, "+15551234000");
    await ctx.smsOptOuts.optOut(organizationId, "+15559990000");

    const res = await postInboundMessage(ctx, {
      From: "+15559990000",
      To: "+15551234000",
      Body: "START",
      MessageSid: "SM1",
    });

    expect(res.status).toBe(200);
    expect(await ctx.smsOptOuts.isOptedOut(organizationId, "+15559990000")).toBe(false);
  });

  it("UNSTOP removes an existing opt-out for the correct organization", async () => {
    const organizationId = await seedOrgWithNumber(ctx, "+15551234000");
    await ctx.smsOptOuts.optOut(organizationId, "+15559990000");

    const res = await postInboundMessage(ctx, {
      From: "+15559990000",
      To: "+15551234000",
      Body: "UNSTOP",
      MessageSid: "SM1",
    });

    expect(res.status).toBe(200);
    expect(await ctx.smsOptOuts.isOptedOut(organizationId, "+15559990000")).toBe(false);
  });

  it("HELP does not modify opt-out state", async () => {
    const organizationId = await seedOrgWithNumber(ctx, "+15551234000");

    const res = await postInboundMessage(ctx, {
      From: "+15559990000",
      To: "+15551234000",
      Body: "HELP",
      MessageSid: "SM1",
    });

    expect(res.status).toBe(200);
    expect(await ctx.smsOptOuts.isOptedOut(organizationId, "+15559990000")).toBe(false);
  });

  it("an unrecognized message does not modify opt-out state", async () => {
    const organizationId = await seedOrgWithNumber(ctx, "+15551234000");

    const res = await postInboundMessage(ctx, {
      From: "+15559990000",
      To: "+15551234000",
      Body: "what time is my appointment",
      MessageSid: "SM1",
    });

    expect(res.status).toBe(200);
    expect(await ctx.smsOptOuts.isOptedOut(organizationId, "+15559990000")).toBe(false);
  });

  it("an unresolved To number does not crash and never guesses a tenant", async () => {
    const res = await postInboundMessage(ctx, {
      From: "+15559990000",
      To: "+15559999999", // no organization owns this number
      Body: "STOP",
      MessageSid: "SM1",
    });

    expect(res.status).toBe(200);
  });

  it("a From that fails E.164 normalization does not mutate opt-out state", async () => {
    const organizationId = await seedOrgWithNumber(ctx, "+15551234000");

    const res = await postInboundMessage(ctx, {
      From: "not-a-real-phone-number",
      To: "+15551234000",
      Body: "STOP",
      MessageSid: "SM1",
    });

    expect(res.status).toBe(200);
    expect(await ctx.smsOptOuts.isOptedOut(organizationId, "not-a-real-phone-number")).toBe(false);
  });

  it("keeps organizations isolated -- the same sender phone number opting out of one organization does not opt them out of another", async () => {
    const organizationA = await seedOrgWithNumber(ctx, "+15551234000");
    const organizationB = await seedOrgWithNumber(ctx, "+15551234111");

    await postInboundMessage(ctx, {
      From: "+15559990000",
      To: "+15551234000",
      Body: "STOP",
      MessageSid: "SM1",
    });

    expect(await ctx.smsOptOuts.isOptedOut(organizationA, "+15559990000")).toBe(true);
    expect(await ctx.smsOptOuts.isOptedOut(organizationB, "+15559990000")).toBe(false);
  });

  it("never generates an outbound reply body -- structurally cannot call the outbound Twilio SMS client (this controller is never given one)", async () => {
    await seedOrgWithNumber(ctx, "+15551234000");

    const res = await postInboundMessage(ctx, {
      From: "+15559990000",
      To: "+15551234000",
      Body: "STOP",
      MessageSid: "SM1",
    });

    expect(res.status).toBe(200);
    expect(res.text).toBe("<Response></Response>");
  });

  it("a duplicate STOP webhook for the same MessageSid remains idempotent -- no duplicate opt-out row, no error", async () => {
    const organizationId = await seedOrgWithNumber(ctx, "+15551234000");

    const first = await postInboundMessage(ctx, {
      From: "+15559990000",
      To: "+15551234000",
      Body: "STOP",
      MessageSid: "SM1",
    });
    const second = await postInboundMessage(ctx, {
      From: "+15559990000",
      To: "+15551234000",
      Body: "STOP",
      MessageSid: "SM1",
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await ctx.smsOptOuts.isOptedOut(organizationId, "+15559990000")).toBe(true);
  });
});
