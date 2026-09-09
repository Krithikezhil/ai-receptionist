import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/config/logger.js";
import { buildTestApp, TEST_INTERNAL_SERVICE_KEY } from "./support/build-test-app.js";
import { createOrg, registerAgent, type TestAppContext } from "./support/http-helpers.js";

// pino only writes directly to fd 1 via SonicBoom (bypassing
// process.stdout.write entirely) when process.stdout.write is still its
// own pristine prototype method at the moment the logger singleton is
// constructed (see hasBeenTampered() in node_modules/pino/lib/tools.js).
// vi.hoisted() runs this harmless pass-through wrapper before this
// file's own imports are evaluated -- including the `logger` import
// below, which is what actually triggers pino's one-time construction --
// so pino chooses process.stdout as its real destination instead.
// Behavior is unchanged: every call still delegates to the real native
// write. Without this, a later vi.spyOn(process.stdout, "write") (see
// captureLogLines below) would never see anything, because pino would
// already be writing straight to the file descriptor.
vi.hoisted(() => {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) =>
    originalWrite(...args)) as typeof process.stdout.write;
});

type Ctx = TestAppContext;

const AUTH_HEADER = `Bearer ${TEST_INTERNAL_SERVICE_KEY}`;
const ORG_TOKEN_HEADER = "X-Organization-Service-Token";

// Only what connect() itself reads (see calendar-connection.controller.ts) --
// this file is about logger behavior, not OAuth correctness (already fully
// covered by oauth-flow.test.ts), so only the three vars actually needed to
// reach a real redirect are set here.
const TEST_CLIENT_ID = "test-google-oauth-client-id.apps.googleusercontent.com";
const TEST_REDIRECT_URI = "http://localhost:4000/oauth/google/callback";
const TEST_STATE_SECRET = "test-logger-redaction-state-secret-do-not-use-0123456789";

const ORIGINAL_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  GOOGLE_OAUTH_STATE_SECRET: process.env.GOOGLE_OAUTH_STATE_SECRET,
};

beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = TEST_CLIENT_ID;
  process.env.GOOGLE_OAUTH_REDIRECT_URI = TEST_REDIRECT_URI;
  process.env.GOOGLE_OAUTH_STATE_SECRET = TEST_STATE_SECRET;
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  // Belt-and-suspenders: captureLogLines() below always restores the spy
  // and logger.level itself (in a try/finally), but this guarantees no
  // stray mock ever survives into another test file even if a future test
  // here is added that spies on process.stdout directly.
  vi.restoreAllMocks();
});

interface CapturedLine {
  req?: {
    method?: string;
    url?: string;
    query?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    remoteAddress?: string;
    remotePort?: number;
  };
  res?: {
    statusCode?: number;
    headers?: Record<string, unknown>;
  };
  msg?: string;
}

/**
 * Exercises the REAL exported logger singleton (never a reconstructed
 * copy of its redact config -- config/logger.ts's redact array is not
 * duplicated anywhere in this file), through the REAL pino-http wiring in
 * app.ts, and captures what it actually writes.
 *
 * tests/setup.ts sets LOG_LEVEL=silent globally, and logger.ts reads that
 * once, at module-import time -- so the singleton is silent by default in
 * every test file. pino's `.level` property is documented as mutable at
 * runtime, so it's temporarily raised here rather than reconstructing or
 * modifying the logger. Both the level and the stdout spy are restored in
 * a `finally` block so a failing assertion inside `run()` (or afterward)
 * can never leave either changed for another test.
 */
async function captureLogLines(run: () => Promise<unknown>): Promise<CapturedLine[]> {
  const originalLevel = logger.level;
  logger.level = "info";
  const chunks: string[] = [];
  const writeSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown): boolean => {
      chunks.push(String(chunk));
      return true;
    }) as unknown as typeof process.stdout.write);

  try {
    await run();
    // Defensive one-tick flush in case pino's write to stdout is buffered
    // asynchronously rather than completing synchronously within the
    // request/response cycle triggered by run().
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    writeSpy.mockRestore();
    logger.level = originalLevel;
  }

  return chunks
    .map((line) => {
      try {
        return JSON.parse(line) as CapturedLine;
      } catch {
        return null;
      }
    })
    .filter((line): line is CapturedLine => line !== null);
}

describe("logger redaction (real app.ts / pino-http wiring)", () => {
  let ctx: Ctx;

  beforeEach(() => {
    ctx = buildTestApp();
  });

  it("redacts Authorization and Cookie request headers while other fields remain visible", async () => {
    const lines = await captureLogLines(() =>
      request(ctx.app)
        .get("/health")
        .set("Authorization", "Bearer test-secret-authorization-value")
        .set("Cookie", "ai_receptionist_session=test-secret-cookie-value"),
    );

    const line = lines.find((l) => l.req?.url === "/health");
    expect(line).toBeDefined();
    expect(line?.req?.headers?.authorization).toBe("[Redacted]");
    expect(line?.req?.headers?.cookie).toBe("[Redacted]");
    expect(line?.req?.method).toBe("GET");
  });

  it("redacts the per-organization service token header", async () => {
    const owner = await registerAgent(ctx, "owner@example.com");
    const created = await createOrg(owner.agent, "Acme Dental");
    const orgId = created.organization.id;
    const orgToken = created.serviceCredential.token;

    const lines = await captureLogLines(() =>
      request(ctx.app)
        .get(`/internal/v1/organizations/${orgId}/runtime-context`)
        .set("Authorization", AUTH_HEADER)
        .set(ORG_TOKEN_HEADER, orgToken),
    );

    const line = lines.find((l) => l.req?.url?.includes("/runtime-context"));
    expect(line).toBeDefined();
    expect(line?.req?.headers?.["x-organization-service-token"]).toBe("[Redacted]");
  });

  it("logs an OAuth callback request with the query string removed from url and query blanked", async () => {
    const lines = await captureLogLines(() =>
      request(ctx.app).get("/oauth/google/callback?code=test-code&state=test-state"),
    );

    const line = lines.find((l) => l.req?.url?.startsWith("/oauth/google/callback"));
    expect(line).toBeDefined();
    expect(line?.req?.url).toBe("/oauth/google/callback");
    expect(line?.req?.query).toEqual({});
  });

  it("logs a non-OAuth request's url and query intact", async () => {
    const lines = await captureLogLines(() => request(ctx.app).get("/health?foo=bar"));

    const line = lines.find((l) => l.req?.url === "/health?foo=bar");
    expect(line).toBeDefined();
    expect(line?.req?.query).toEqual({ foo: "bar" });
  });

  it("preserves remoteAddress and remotePort in a real request's log line", async () => {
    const lines = await captureLogLines(() => request(ctx.app).get("/health"));

    const line = lines.find((l) => l.req?.url === "/health");
    expect(line).toBeDefined();
    expect(typeof line?.req?.remoteAddress).toBe("string");
    expect(line?.req?.remoteAddress?.length).toBeGreaterThan(0);
    expect(typeof line?.req?.remotePort).toBe("number");
    expect(line?.req?.remotePort).toBeGreaterThan(0);
  });

  it("redacts the Location header on the real OAuth connect() redirect", async () => {
    const owner = await registerAgent(ctx, "owner@example.com");
    const created = await createOrg(owner.agent, "Acme Dental");
    const orgId = created.organization.id;

    const lines = await captureLogLines(() => owner.agent.post(`/organizations/${orgId}/calendar`));

    const line = lines.find((l) => l.req?.method === "POST" && l.req?.url === `/organizations/${orgId}/calendar`);
    expect(line).toBeDefined();
    expect(line?.res?.statusCode).toBe(302);
    expect(line?.res?.headers?.location).toBe("[Redacted]");
  });

  it("does not redact response headers on a response with no Location header", async () => {
    const lines = await captureLogLines(() => request(ctx.app).get("/health"));

    const line = lines.find((l) => l.req?.url === "/health");
    expect(line).toBeDefined();
    expect(line?.res?.headers?.location).toBeUndefined();
  });
});
