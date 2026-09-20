import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStripeWebhookRouter } from "../src/routes/stripe-webhook.routes.js";

/**
 * HTTP-level tests for the Stripe webhook route -- built as a minimal
 * standalone Express app (mirroring how app.ts itself mounts this
 * router: express.raw() scoped to the route, no global express.json()
 * ahead of it) rather than going through buildTestApp(), since this
 * router has no injected dependencies to fake. Verifies the raw-body
 * plumbing end-to-end, not just the pure verifier function (see
 * stripe-webhook-signature.test.ts for that).
 */

const SECRET = "test-stripe-webhook-secret-do-not-use-in-prod";

function sign(rawBody: string, secret: string, timestampSeconds: number): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

function buildApp() {
  const app = express();
  app.use("/stripe", createStripeWebhookRouter());
  return app;
}

describe("POST /stripe/webhook", () => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    }
  });

  it("accepts a validly signed request", async () => {
    const app = buildApp();
    const body = JSON.stringify({ id: "evt_123", type: "customer.subscription.updated" });
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const header = sign(body, SECRET, timestampSeconds);

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", header)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it("rejects a request with no Stripe-Signature header", async () => {
    const app = buildApp();
    const body = JSON.stringify({ id: "evt_123" });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(400);
  });

  it("rejects a malformed signature header", async () => {
    const app = buildApp();
    const body = JSON.stringify({ id: "evt_123" });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", "not-a-real-header")
      .send(body);

    expect(res.status).toBe(400);
  });

  it("rejects an invalid signature (wrong secret)", async () => {
    const app = buildApp();
    const body = JSON.stringify({ id: "evt_123" });
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const header = sign(body, "wrong-secret", timestampSeconds);

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", header)
      .send(body);

    expect(res.status).toBe(400);
  });

  it("rejects a stale signature", async () => {
    const app = buildApp();
    const body = JSON.stringify({ id: "evt_123" });
    const staleTimestamp = Math.floor(Date.now() / 1000) - 301;
    const header = sign(body, SECRET, staleTimestamp);

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", header)
      .send(body);

    expect(res.status).toBe(400);
  });

  it("fails closed when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const app = buildApp();
    const body = JSON.stringify({ id: "evt_123" });
    const timestampSeconds = Math.floor(Date.now() / 1000);
    // Signed with a secret that would be valid if configured -- proves
    // the absence of configuration itself is fail-closed, not merely a
    // coincidentally-wrong signature.
    const header = sign(body, SECRET, timestampSeconds);

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", header)
      .send(body);

    expect(res.status).toBe(400);
  });

  it("rejects a request whose body was altered after signing (proves exact raw bytes are verified)", async () => {
    const app = buildApp();
    const signedBody = JSON.stringify({ id: "evt_123" });
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const header = sign(signedBody, SECRET, timestampSeconds);
    const sentBody = JSON.stringify({ id: "evt_456" });

    const res = await request(app)
      .post("/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", header)
      .send(sentBody);

    expect(res.status).toBe(400);
  });
});
