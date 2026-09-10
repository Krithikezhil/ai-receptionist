import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTwilioSignature } from "../src/auth/twilio-webhook-signature.js";

const AUTH_TOKEN = "test-twilio-auth-token-do-not-use-in-prod";
const URL = "https://api.example.com/twilio/sms-status";

/** Independently computes a genuinely valid signature using the same
 * documented Twilio algorithm the production code implements -- mirrors
 * oauth-flow.test.ts's own convention of constructing real HMACs in tests
 * rather than ever bypassing the check under test. */
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

describe("verifyTwilioSignature", () => {
  it("accepts a genuinely valid signature", () => {
    const formParams = { MessageSid: "SM123", MessageStatus: "delivered" };
    const signature = computeValidSignature(URL, formParams, AUTH_TOKEN);
    expect(verifyTwilioSignature(URL, formParams, signature, AUTH_TOKEN)).toBe(true);
  });

  it("rejects the same signature checked against a different canonical URL", () => {
    const formParams = { MessageSid: "SM123", MessageStatus: "delivered" };
    const signature = computeValidSignature(URL, formParams, AUTH_TOKEN);
    expect(
      verifyTwilioSignature(
        "https://api.example.com/twilio/sms-inbound",
        formParams,
        signature,
        AUTH_TOKEN,
      ),
    ).toBe(false);
  });

  it("rejects a tampered form parameter", () => {
    const formParams = { MessageSid: "SM123", MessageStatus: "delivered" };
    const signature = computeValidSignature(URL, formParams, AUTH_TOKEN);
    const tamperedParams = { ...formParams, MessageStatus: "failed" };
    expect(verifyTwilioSignature(URL, tamperedParams, signature, AUTH_TOKEN)).toBe(false);
  });

  it("rejects a signature computed with the wrong auth token", () => {
    const formParams = { MessageSid: "SM123", MessageStatus: "delivered" };
    const signature = computeValidSignature(URL, formParams, "wrong-auth-token");
    expect(verifyTwilioSignature(URL, formParams, signature, AUTH_TOKEN)).toBe(false);
  });

  it("rejects a missing signature", () => {
    const formParams = { MessageSid: "SM123", MessageStatus: "delivered" };
    expect(verifyTwilioSignature(URL, formParams, "", AUTH_TOKEN)).toBe(false);
  });

  it("rejects a malformed/garbage signature without throwing", () => {
    const formParams = { MessageSid: "SM123", MessageStatus: "delivered" };
    expect(() =>
      verifyTwilioSignature(URL, formParams, "not-a-real-signature", AUTH_TOKEN),
    ).not.toThrow();
    expect(verifyTwilioSignature(URL, formParams, "not-a-real-signature", AUTH_TOKEN)).toBe(
      false,
    );
  });

  it("handles empty form parameters correctly (signs the bare URL)", () => {
    const signature = computeValidSignature(URL, {}, AUTH_TOKEN);
    expect(verifyTwilioSignature(URL, {}, signature, AUTH_TOKEN)).toBe(true);
  });
});
