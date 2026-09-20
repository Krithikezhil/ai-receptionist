import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "../src/auth/stripe-webhook-signature.js";

const SECRET = "test-stripe-webhook-secret-do-not-use-in-prod";
const NOW_MS = 1_700_000_000_000; // fixed reference instant for deterministic tests
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

/** Independently computes a genuinely valid Stripe-style signature using
 * the same documented algorithm the production code implements -- mirrors
 * twilio-webhook-signature.test.ts's own convention of constructing real
 * HMACs in tests rather than ever bypassing the check under test. */
function sign(rawBody: string, secret: string, timestampSeconds: number): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a genuinely valid signature", () => {
    const body = '{"id":"evt_123"}';
    const header = sign(body, SECRET, NOW_SECONDS);
    expect(verifyStripeSignature(body, header, SECRET, NOW_MS)).toBe(true);
  });

  it("accepts when multiple v1 signatures are present and one matches (rotation)", () => {
    const body = '{"id":"evt_123"}';
    const validDigest = createHmac("sha256", SECRET)
      .update(`${NOW_SECONDS}.${body}`, "utf8")
      .digest("hex");
    const header = `t=${NOW_SECONDS},v1=deadbeefdeadbeef,v1=${validDigest}`;
    expect(verifyStripeSignature(body, header, SECRET, NOW_MS)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = '{"id":"evt_123"}';
    const header = sign(body, "wrong-secret", NOW_SECONDS);
    expect(verifyStripeSignature(body, header, SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const body = '{"id":"evt_123"}';
    const header = sign(body, SECRET, NOW_SECONDS);
    const tamperedBody = '{"id":"evt_456"}';
    expect(verifyStripeSignature(tamperedBody, header, SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a stale timestamp outside the 300-second tolerance", () => {
    const body = '{"id":"evt_123"}';
    const staleTimestamp = NOW_SECONDS - 301;
    const header = sign(body, SECRET, staleTimestamp);
    expect(verifyStripeSignature(body, header, SECRET, NOW_MS)).toBe(false);
  });

  it("accepts a timestamp exactly at the 300-second tolerance boundary", () => {
    const body = '{"id":"evt_123"}';
    const boundaryTimestamp = NOW_SECONDS - 300;
    const header = sign(body, SECRET, boundaryTimestamp);
    expect(verifyStripeSignature(body, header, SECRET, NOW_MS)).toBe(true);
  });

  it("rejects a missing signature header", () => {
    const body = '{"id":"evt_123"}';
    expect(verifyStripeSignature(body, undefined, SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a malformed header with no recognizable key=value pairs", () => {
    const body = '{"id":"evt_123"}';
    expect(verifyStripeSignature(body, "not-a-real-header", SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a header missing t=", () => {
    const body = '{"id":"evt_123"}';
    const digest = createHmac("sha256", SECRET)
      .update(`${NOW_SECONDS}.${body}`, "utf8")
      .digest("hex");
    const header = `v1=${digest}`;
    expect(verifyStripeSignature(body, header, SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a header missing v1=", () => {
    const body = '{"id":"evt_123"}';
    const header = `t=${NOW_SECONDS}`;
    expect(verifyStripeSignature(body, header, SECRET, NOW_MS)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    const body = '{"id":"evt_123"}';
    const digest = createHmac("sha256", SECRET)
      .update(`not-a-number.${body}`, "utf8")
      .digest("hex");
    const header = `t=not-a-number,v1=${digest}`;
    expect(verifyStripeSignature(body, header, SECRET, NOW_MS)).toBe(false);
  });

  it("does not throw on a garbage signature value", () => {
    const body = '{"id":"evt_123"}';
    const header = `t=${NOW_SECONDS},v1=not-a-real-signature`;
    expect(() => verifyStripeSignature(body, header, SECRET, NOW_MS)).not.toThrow();
    expect(verifyStripeSignature(body, header, SECRET, NOW_MS)).toBe(false);
  });
});
