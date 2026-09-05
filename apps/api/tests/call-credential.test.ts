import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateCallCredential, verifyCallCredential } from "../src/auth/call-credential.js";

const SECRET = "test-call-credential-secret-do-not-use-in-prod";
const OTHER_SECRET = "a-completely-different-secret";
const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const CALL_SID_A = "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CALL_SID_B = "CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("call-credential", () => {
  it("round-trips: a credential minted for an org verifies successfully for that org", () => {
    const token = generateCallCredential(ORG_A, CALL_SID_A, SECRET);
    const result = verifyCallCredential(token, ORG_A, SECRET);
    expect(result).toEqual({ valid: true, callSid: CALL_SID_A });
  });

  it("round-trips with an explicit matching call_sid", () => {
    const token = generateCallCredential(ORG_A, CALL_SID_A, SECRET);
    const result = verifyCallCredential(token, ORG_A, SECRET, CALL_SID_A);
    expect(result.valid).toBe(true);
  });

  it("rejects a credential presented against a different organization", () => {
    const token = generateCallCredential(ORG_A, CALL_SID_A, SECRET);
    const result = verifyCallCredential(token, ORG_B, SECRET);
    expect(result).toEqual({ valid: false, reason: "org_mismatch" });
  });

  it("rejects a credential presented with a mismatched expected call_sid", () => {
    const token = generateCallCredential(ORG_A, CALL_SID_A, SECRET);
    const result = verifyCallCredential(token, ORG_A, SECRET, CALL_SID_B);
    expect(result).toEqual({ valid: false, reason: "call_mismatch" });
  });

  it("rejects an expired credential", () => {
    const token = generateCallCredential(ORG_A, CALL_SID_A, SECRET, -1);
    const result = verifyCallCredential(token, ORG_A, SECRET);
    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects a credential signed with a different secret", () => {
    const token = generateCallCredential(ORG_A, CALL_SID_A, OTHER_SECRET);
    const result = verifyCallCredential(token, ORG_A, SECRET);
    expect(result).toEqual({ valid: false, reason: "signature" });
  });

  it("rejects a credential with a tampered payload (org swapped after signing)", () => {
    const token = generateCallCredential(ORG_A, CALL_SID_A, SECRET);
    const [payloadB64, sigB64] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        organization_id: ORG_B,
        call_sid: CALL_SID_A,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    const tampered = `${tamperedPayload}.${sigB64}`;
    const result = verifyCallCredential(tampered, ORG_B, SECRET);
    expect(result).toEqual({ valid: false, reason: "signature" });
    expect(payloadB64).not.toBe(tamperedPayload);
  });

  it("rejects a tampered signature", () => {
    const token = generateCallCredential(ORG_A, CALL_SID_A, SECRET);
    const [payloadB64] = token.split(".");
    const tampered = `${payloadB64}.not-a-real-signature`;
    const result = verifyCallCredential(tampered, ORG_A, SECRET);
    expect(result).toEqual({ valid: false, reason: "signature" });
  });

  it("rejects a token with no dot separator", () => {
    const result = verifyCallCredential("not-a-valid-token-at-all", ORG_A, SECRET);
    expect(result).toEqual({ valid: false, reason: "malformed" });
  });

  it("rejects a token with more than one dot", () => {
    const result = verifyCallCredential("a.b.c", ORG_A, SECRET);
    expect(result).toEqual({ valid: false, reason: "malformed" });
  });

  it("rejects a token whose payload segment is not valid base64url JSON", () => {
    const token = generateCallCredential(ORG_A, CALL_SID_A, SECRET);
    const [, sigB64] = token.split(".");
    const result = verifyCallCredential(`not-valid-base64-json.${sigB64}`, ORG_A, SECRET);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(["malformed", "signature"]).toContain(result.reason);
    }
  });

  it("rejects a payload missing required claims (correctly signed, wrong shape)", () => {
    const badPayload = Buffer.from(JSON.stringify({ organization_id: ORG_A })).toString(
      "base64url",
    );
    // Sign it correctly so this specifically exercises the shape check, not
    // the signature check.
    const sig = createHmac("sha256", SECRET).update(badPayload).digest("base64url");
    const result = verifyCallCredential(`${badPayload}.${sig}`, ORG_A, SECRET);
    expect(result).toEqual({ valid: false, reason: "malformed" });
  });

  it("never returns the token or payload contents in a failure result", () => {
    const token = generateCallCredential(ORG_A, CALL_SID_A, SECRET);
    const result = verifyCallCredential(token, ORG_B, SECRET);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ORG_A);
    expect(serialized).not.toContain(CALL_SID_A);
  });
});
