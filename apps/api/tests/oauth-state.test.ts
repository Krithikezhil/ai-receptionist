import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OAuthStateConfigurationError,
  OAUTH_STATE_TTL_SECONDS,
  generateOAuthState,
  verifyOAuthState,
} from "../src/auth/oauth-state.js";

const SECRET = "test-oauth-state-secret-do-not-use-in-prod-0123456789";
const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/**
 * oauth-state.ts, unlike call-credential.ts, reads its secret directly via
 * process.env.GOOGLE_OAUTH_STATE_SECRET -- there is no function-parameter
 * injection seam (an explicit, already-approved M10 design decision, not
 * an oversight). Tests must set/restore the env var directly around each
 * test rather than passing it as an argument.
 */
const ORIGINAL_SECRET = process.env.GOOGLE_OAUTH_STATE_SECRET;

beforeEach(() => {
  process.env.GOOGLE_OAUTH_STATE_SECRET = SECRET;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.GOOGLE_OAUTH_STATE_SECRET;
  } else {
    process.env.GOOGLE_OAUTH_STATE_SECRET = ORIGINAL_SECRET;
  }
});

function signPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("oauth-state", () => {
  it("round-trips: a state minted for an org/user verifies successfully", () => {
    const state = generateOAuthState(ORG_A, USER_A);
    const result = verifyOAuthState(state);
    expect(result).toEqual({ valid: true, organizationId: ORG_A, userId: USER_A });
  });

  it("produces a token shaped as base64url(payload).base64url(signature)", () => {
    const state = generateOAuthState(ORG_A, USER_A);
    expect(state.split(".")).toHaveLength(2);
  });

  it("never mints two identical states for the same organization/user (random nonce)", () => {
    const a = generateOAuthState(ORG_A, USER_A);
    const b = generateOAuthState(ORG_A, USER_A);
    expect(a).not.toBe(b);
  });

  it("rejects a state tampered with after signing (organizationId swapped)", () => {
    const state = generateOAuthState(ORG_A, USER_A);
    const [payloadB64, sigB64] = state.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const tamperedPayload = encodePayload({ ...decoded, organizationId: ORG_B });
    const result = verifyOAuthState(`${tamperedPayload}.${sigB64}`);
    expect(result).toEqual({ valid: false, reason: "signature" });
    expect(tamperedPayload).not.toBe(payloadB64);
  });

  it("rejects a state signed with a different secret", () => {
    const state = generateOAuthState(ORG_A, USER_A);
    process.env.GOOGLE_OAUTH_STATE_SECRET = "a-completely-different-secret-0123456789";
    expect(verifyOAuthState(state)).toEqual({ valid: false, reason: "signature" });
  });

  it("rejects a tampered signature", () => {
    const state = generateOAuthState(ORG_A, USER_A);
    const [payloadB64] = state.split(".");
    expect(verifyOAuthState(`${payloadB64}.not-a-real-signature`)).toEqual({
      valid: false,
      reason: "signature",
    });
  });

  it("rejects a token with no dot separator", () => {
    expect(verifyOAuthState("not-a-valid-token-at-all")).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects a token with more than one dot", () => {
    expect(verifyOAuthState("a.b.c")).toEqual({ valid: false, reason: "malformed" });
  });

  it("rejects a correctly-signed payload segment that is not valid JSON", () => {
    const payloadB64 = "not-valid-base64-json";
    const sig = signPayload(payloadB64, SECRET);
    expect(verifyOAuthState(`${payloadB64}.${sig}`)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects a correctly-signed payload missing required claims", () => {
    const payloadB64 = encodePayload({ organizationId: ORG_A });
    const sig = signPayload(payloadB64, SECRET);
    expect(verifyOAuthState(`${payloadB64}.${sig}`)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects a correctly-signed payload with an empty organizationId", () => {
    const payloadB64 = encodePayload({
      organizationId: "",
      userId: USER_A,
      nonce: "abc",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const sig = signPayload(payloadB64, SECRET);
    expect(verifyOAuthState(`${payloadB64}.${sig}`)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects a correctly-signed payload with an empty userId", () => {
    const payloadB64 = encodePayload({
      organizationId: ORG_A,
      userId: "",
      nonce: "abc",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const sig = signPayload(payloadB64, SECRET);
    expect(verifyOAuthState(`${payloadB64}.${sig}`)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects a correctly-signed payload with an empty nonce", () => {
    const payloadB64 = encodePayload({
      organizationId: ORG_A,
      userId: USER_A,
      nonce: "",
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const sig = signPayload(payloadB64, SECRET);
    expect(verifyOAuthState(`${payloadB64}.${sig}`)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects a correctly-signed payload with a non-integer exp", () => {
    const payloadB64 = encodePayload({
      organizationId: ORG_A,
      userId: USER_A,
      nonce: "abc",
      exp: Math.floor(Date.now() / 1000) + 600.5,
    });
    const sig = signPayload(payloadB64, SECRET);
    expect(verifyOAuthState(`${payloadB64}.${sig}`)).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("rejects a correctly-signed payload with a non-finite exp", () => {
    // JSON.stringify(Infinity) collapses to "null", which would only
    // exercise the missing-claim branch -- so this constructs the raw JSON
    // string directly with an overflowing numeric literal, which JSON.parse
    // resolves to Infinity, to actually exercise Number.isFinite's check.
    const raw = Buffer.from(
      `{"organizationId":"${ORG_A}","userId":"${USER_A}","nonce":"abc","exp":1e400}`,
      "utf8",
    ).toString("base64url");
    const sig = signPayload(raw, SECRET);
    expect(verifyOAuthState(`${raw}.${sig}`)).toEqual({ valid: false, reason: "malformed" });
  });

  it("rejects an expired state", () => {
    const payloadB64 = encodePayload({
      organizationId: ORG_A,
      userId: USER_A,
      nonce: "abc",
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const sig = signPayload(payloadB64, SECRET);
    expect(verifyOAuthState(`${payloadB64}.${sig}`)).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("rejects a state whose exp equals exactly now (boundary is exclusive)", () => {
    const payloadB64 = encodePayload({
      organizationId: ORG_A,
      userId: USER_A,
      nonce: "abc",
      exp: Math.floor(Date.now() / 1000),
    });
    const sig = signPayload(payloadB64, SECRET);
    expect(verifyOAuthState(`${payloadB64}.${sig}`)).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("accepts a state one second before expiry", () => {
    const payloadB64 = encodePayload({
      organizationId: ORG_A,
      userId: USER_A,
      nonce: "abc",
      exp: Math.floor(Date.now() / 1000) + 1,
    });
    const sig = signPayload(payloadB64, SECRET);
    expect(verifyOAuthState(`${payloadB64}.${sig}`)).toEqual({
      valid: true,
      organizationId: ORG_A,
      userId: USER_A,
    });
  });

  it("never returns the token or payload contents in a failure result", () => {
    const state = generateOAuthState(ORG_A, USER_A);
    process.env.GOOGLE_OAUTH_STATE_SECRET = "a-completely-different-secret-0123456789";
    const serialized = JSON.stringify(verifyOAuthState(state));
    expect(serialized).not.toContain(ORG_A);
    expect(serialized).not.toContain(USER_A);
  });

  it("throws OAuthStateConfigurationError when the secret is not set", () => {
    delete process.env.GOOGLE_OAUTH_STATE_SECRET;
    expect(() => generateOAuthState(ORG_A, USER_A)).toThrow(OAuthStateConfigurationError);
  });

  it("throws OAuthStateConfigurationError when the secret is too short", () => {
    process.env.GOOGLE_OAUTH_STATE_SECRET = "too-short";
    expect(() => generateOAuthState(ORG_A, USER_A)).toThrow(OAuthStateConfigurationError);
  });

  it("OAUTH_STATE_TTL_SECONDS is 10 minutes, matching the documented TTL", () => {
    expect(OAUTH_STATE_TTL_SECONDS).toBe(600);
  });
});
