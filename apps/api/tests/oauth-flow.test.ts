import { createHmac } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyOAuthState } from "../src/auth/oauth-state.js";
import { buildTestApp } from "./support/build-test-app.js";
import { createOrg, registerAgent, type TestAppContext } from "./support/http-helpers.js";

type Ctx = TestAppContext;

// Mirrors the real endpoints calendar-connection.service.ts's
// completeOAuthConnection() calls -- confirmed by reading that file's
// GOOGLE_TOKEN_ENDPOINT/GOOGLE_USERINFO_ENDPOINT constants directly.
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
// Mirrors calendar-connection.controller.ts's own GOOGLE_OAUTH_SCOPES literal.
const GOOGLE_OAUTH_SCOPES =
  "https://www.googleapis.com/auth/calendar.events " +
  "https://www.googleapis.com/auth/calendar.freebusy openid email";

const TEST_CLIENT_ID = "test-google-oauth-client-id.apps.googleusercontent.com";
const TEST_CLIENT_SECRET = "test-google-oauth-client-secret-do-not-use";
const TEST_REDIRECT_URI = "http://localhost:4000/oauth/google/callback";
const TEST_STATE_SECRET = "test-oauth-flow-state-secret-do-not-use-0123456789";
// A valid base64-encoded 32-byte key -- computed here rather than
// hand-written to guarantee it actually satisfies
// google-token-crypto.ts's strict length/round-trip validation.
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

/**
 * oauth-state.ts, calendar-connection.controller.ts, and
 * calendar-connection.service.ts all read their configuration directly via
 * process.env -- no dependency-injection seam (an explicit, already-approved
 * M10 design decision -- see oauth-state.test.ts's own note). Original
 * values are captured once, before any test runs, and restored after every
 * test in afterEach (which Vitest still runs even when a test fails), so
 * this file can never contaminate any other test file's environment.
 */
const ORIGINAL_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  GOOGLE_OAUTH_STATE_SECRET: process.env.GOOGLE_OAUTH_STATE_SECRET,
  GOOGLE_TOKEN_ENCRYPTION_KEY: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
};

beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = TEST_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = TEST_CLIENT_SECRET;
  process.env.GOOGLE_OAUTH_REDIRECT_URI = TEST_REDIRECT_URI;
  process.env.GOOGLE_OAUTH_STATE_SECRET = TEST_STATE_SECRET;
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.unstubAllGlobals();
});

/** Stubs fetch to answer Google's token-exchange and userinfo endpoints
 * exactly as completeOAuthConnection() expects. Any other URL throws,
 * which fails the test loudly instead of silently returning undefined. */
function stubGoogleOAuthSuccess(overrides?: {
  accessToken?: string;
  refreshToken?: string;
  email?: string;
  emailVerified?: boolean;
}) {
  const accessToken = overrides?.accessToken ?? "test-google-access-token";
  const refreshToken = overrides?.refreshToken ?? "test-google-refresh-token";
  const email = overrides?.email ?? "connected-calendar@example.com";
  const emailVerified = overrides?.emailVerified ?? true;

  const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
    if (url === GOOGLE_TOKEN_ENDPOINT) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: accessToken, refresh_token: refreshToken }),
      };
    }
    if (url === GOOGLE_USERINFO_ENDPOINT) {
      return { ok: true, status: 200, json: async () => ({ email, email_verified: emailVerified }) };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

/** A fetch stub that must never be called -- used for every callback
 * rejection path that should fail closed before any Google request. */
function stubFetchMustNotBeCalled() {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function extractStateFromRedirect(location: string): string {
  const url = new URL(location);
  const state = url.searchParams.get("state");
  if (!state) throw new Error("Redirect Location had no state parameter.");
  return state;
}

describe("POST /organizations/:organizationId/calendar (OAuth start)", () => {
  let ctx: Ctx;
  let ownerAgent: Awaited<ReturnType<typeof registerAgent>>["agent"];
  let ownerUserId: string;
  let orgId: string;

  beforeEach(async () => {
    ctx = buildTestApp();
    const owner = await registerAgent(ctx, "owner@example.com");
    ownerAgent = owner.agent;
    ownerUserId = owner.userId;
    const created = await createOrg(ownerAgent, "Acme Dental");
    orgId = created.organization.id;
  });

  it("redirects the owner to Google's authorization endpoint with the expected query parameters", async () => {
    const res = await ownerAgent.post(`/organizations/${orgId}/calendar`);

    expect(res.status).toBe(302);
    const location = res.headers.location as string;
    expect(location.startsWith(GOOGLE_AUTHORIZATION_URL)).toBe(true);

    const url = new URL(location);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(TEST_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(TEST_REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe(GOOGLE_OAUTH_SCOPES);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("mints a state that verifies to the connecting organization and the requesting owner's user id", async () => {
    const res = await ownerAgent.post(`/organizations/${orgId}/calendar`);
    const state = extractStateFromRedirect(res.headers.location as string);

    const verified = verifyOAuthState(state);
    expect(verified).toEqual({ valid: true, organizationId: orgId, userId: ownerUserId });
  });

  it("rejects a non-owner member with 403 (no redirect produced)", async () => {
    const member = await registerAgent(ctx, "member@example.com");
    await ctx.memberships.create({ organizationId: orgId, userId: member.userId, role: "member" });

    const res = await member.agent.post(`/organizations/${orgId}/calendar`);

    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
  });

  it("returns 404 for a user with no membership in the organization at all", async () => {
    const stranger = await registerAgent(ctx, "stranger@example.com");
    const res = await stranger.agent.post(`/organizations/${orgId}/calendar`);
    expect(res.status).toBe(404);
  });

  it("fails closed (500, generic body) when GOOGLE_OAUTH_CLIENT_ID is not configured", async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;

    const res = await ownerAgent.post(`/organizations/${orgId}/calendar`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error." });
  });
});

describe("GET /oauth/google/callback (OAuth callback)", () => {
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

  const FAILURE_BODY = "Google Calendar connection failed. Please try again from the dashboard.";

  it("rejects a request missing the state parameter", async () => {
    const fetchSpy = stubFetchMustNotBeCalled();
    const res = await request(ctx.app).get("/oauth/google/callback?code=test-code");
    expect(res.status).toBe(400);
    expect(res.text).toBe(FAILURE_BODY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a request missing the code parameter", async () => {
    const fetchSpy = stubFetchMustNotBeCalled();
    const res = await request(ctx.app).get("/oauth/google/callback?state=test-state");
    expect(res.status).toBe(400);
    expect(res.text).toBe(FAILURE_BODY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a request where Google reports an error, without calling Google at all", async () => {
    const fetchSpy = stubFetchMustNotBeCalled();
    const res = await request(ctx.app).get(
      "/oauth/google/callback?error=access_denied&code=test-code&state=test-state",
    );
    expect(res.status).toBe(400);
    expect(res.text).toBe(FAILURE_BODY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a structurally invalid state token", async () => {
    const fetchSpy = stubFetchMustNotBeCalled();
    const res = await request(ctx.app).get(
      "/oauth/google/callback?code=test-code&state=not-a-valid-state-token",
    );
    expect(res.status).toBe(400);
    expect(res.text).toBe(FAILURE_BODY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an expired state token", async () => {
    const fetchSpy = stubFetchMustNotBeCalled();
    const payloadB64 = encodePayload({
      organizationId: orgId,
      userId: "11111111-1111-1111-1111-111111111111",
      nonce: "abc",
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const state = `${payloadB64}.${signPayload(payloadB64, TEST_STATE_SECRET)}`;

    const res = await request(ctx.app).get(
      `/oauth/google/callback?code=test-code&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(400);
    expect(res.text).toBe(FAILURE_BODY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a state token with a tampered payload", async () => {
    const fetchSpy = stubFetchMustNotBeCalled();
    const connectRes = await ownerAgent.post(`/organizations/${orgId}/calendar`);
    const validState = extractStateFromRedirect(connectRes.headers.location as string);
    const stateParts = validState.split(".");
    expect(stateParts).toHaveLength(2);
    const [payloadB64, sigB64] = stateParts as [string, string];
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const tamperedPayload = encodePayload({ ...decoded, organizationId: "attacker-controlled-org" });
    const tamperedState = `${tamperedPayload}.${sigB64}`;

    const res = await request(ctx.app).get(
      `/oauth/google/callback?code=test-code&state=${encodeURIComponent(tamperedState)}`,
    );
    expect(res.status).toBe(400);
    expect(res.text).toBe(FAILURE_BODY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("on success, persists the connection under the organization embedded in the state (not any other value)", async () => {
    stubGoogleOAuthSuccess({ email: "connected-calendar@example.com" });
    const connectRes = await ownerAgent.post(`/organizations/${orgId}/calendar`);
    const state = extractStateFromRedirect(connectRes.headers.location as string);

    await request(ctx.app).get(
      `/oauth/google/callback?code=test-authorization-code&state=${encodeURIComponent(state)}`,
    );

    const connection = await ctx.organizationCalendarConnections.findByOrganizationId(orgId);
    expect(connection).toMatchObject({
      organizationId: orgId,
      status: "connected",
      googleAccountEmail: "connected-calendar@example.com",
    });
  });

  it("on success, returns the exact confirmation text and 200 status", async () => {
    stubGoogleOAuthSuccess();
    const connectRes = await ownerAgent.post(`/organizations/${orgId}/calendar`);
    const state = extractStateFromRedirect(connectRes.headers.location as string);

    const res = await request(ctx.app).get(
      `/oauth/google/callback?code=test-authorization-code&state=${encodeURIComponent(state)}`,
    );

    expect(res.status).toBe(200);
    expect(res.text).toBe("Google Calendar connected. You can close this window.");
  });

  it("maps a Google token-exchange failure to the generic failure response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url === GOOGLE_TOKEN_ENDPOINT) {
          return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) };
        }
        throw new Error(`Unexpected fetch URL in test: ${url}`);
      }),
    );
    const connectRes = await ownerAgent.post(`/organizations/${orgId}/calendar`);
    const state = extractStateFromRedirect(connectRes.headers.location as string);

    const res = await request(ctx.app).get(
      `/oauth/google/callback?code=test-authorization-code&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(400);
    expect(res.text).toBe(FAILURE_BODY);
  });

  it("maps an unverified userinfo email to the generic failure response", async () => {
    stubGoogleOAuthSuccess({ emailVerified: false });
    const connectRes = await ownerAgent.post(`/organizations/${orgId}/calendar`);
    const state = extractStateFromRedirect(connectRes.headers.location as string);

    const res = await request(ctx.app).get(
      `/oauth/google/callback?code=test-authorization-code&state=${encodeURIComponent(state)}`,
    );
    expect(res.status).toBe(400);
    expect(res.text).toBe(FAILURE_BODY);

    const connection = await ctx.organizationCalendarConnections.findByOrganizationId(orgId);
    expect(connection).toBeUndefined();
  });

  it("fails closed (500, generic body) when GOOGLE_TOKEN_ENCRYPTION_KEY is not configured, without leaking Google's tokens", async () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    const accessToken = "test-access-token-must-not-leak";
    const refreshToken = "test-refresh-token-must-not-leak";
    stubGoogleOAuthSuccess({ accessToken, refreshToken });
    const connectRes = await ownerAgent.post(`/organizations/${orgId}/calendar`);
    const state = extractStateFromRedirect(connectRes.headers.location as string);

    const res = await request(ctx.app).get(
      `/oauth/google/callback?code=test-authorization-code&state=${encodeURIComponent(state)}`,
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error." });
    expect(res.text).not.toContain(accessToken);
    expect(res.text).not.toContain(refreshToken);
  });

  it("never includes the authorization code, state token, or client secret in a failure response body", async () => {
    const fetchSpy = stubFetchMustNotBeCalled();
    const connectRes = await ownerAgent.post(`/organizations/${orgId}/calendar`);
    const validState = extractStateFromRedirect(connectRes.headers.location as string);
    const stateParts = validState.split(".");
    expect(stateParts).toHaveLength(2);
    const [payloadB64, sigB64] = stateParts as [string, string];
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const tamperedPayload = encodePayload({ ...decoded, organizationId: "attacker-controlled-org" });
    const tamperedState = `${tamperedPayload}.${sigB64}`;
    const suspiciousCode = "authorization-code-must-not-leak";

    const res = await request(ctx.app).get(
      `/oauth/google/callback?code=${suspiciousCode}&state=${encodeURIComponent(tamperedState)}`,
    );

    expect(res.status).toBe(400);
    expect(res.text).not.toContain(suspiciousCode);
    expect(res.text).not.toContain(tamperedState);
    expect(res.text).not.toContain(TEST_CLIENT_SECRET);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never includes the access token or refresh token in the success response body", async () => {
    const accessToken = "test-access-token-must-not-appear-in-response";
    const refreshToken = "test-refresh-token-must-not-appear-in-response";
    stubGoogleOAuthSuccess({ accessToken, refreshToken });
    const connectRes = await ownerAgent.post(`/organizations/${orgId}/calendar`);
    const state = extractStateFromRedirect(connectRes.headers.location as string);

    const res = await request(ctx.app).get(
      `/oauth/google/callback?code=test-authorization-code&state=${encodeURIComponent(state)}`,
    );

    expect(res.text).not.toContain(accessToken);
    expect(res.text).not.toContain(refreshToken);
  });
});
