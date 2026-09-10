import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../src/config/logger.js";
import { buildTestApp } from "./support/build-test-app.js";
import type { TestAppContext } from "./support/http-helpers.js";

// pino only writes directly to fd 1 via SonicBoom (bypassing
// process.stdout.write entirely) when process.stdout.write is still its
// own pristine prototype method at the moment the logger singleton is
// constructed (see hasBeenTampered() in node_modules/pino/lib/tools.js).
// vi.hoisted() runs this harmless pass-through wrapper before this
// file's own imports are evaluated -- including the `logger` import
// above, which is what actually triggers pino's one-time construction --
// so pino chooses process.stdout as its real destination instead.
// Copied from the established tests/logger-redaction.test.ts pattern
// (not imported from there -- it's a file-local, unexported helper).
vi.hoisted(() => {
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((...args: Parameters<typeof process.stdout.write>) =>
    originalWrite(...args)) as typeof process.stdout.write;
});

type Ctx = TestAppContext;

const AUTH_TOKEN = "test-twilio-auth-token-do-not-use-in-prod";
const PUBLIC_BASE_URL = "https://api.example.com";
const CANONICAL_URL = `${PUBLIC_BASE_URL}/twilio/sms-status`;

/**
 * process.env.TWILIO_AUTH_TOKEN / API_PUBLIC_BASE_URL are read directly by
 * the controller (no dependency-injection seam -- see
 * controllers/twilio-sms-status.controller.ts's own comment), mirroring
 * oauth-flow.test.ts's identical stubbing convention for the analogous
 * Google OAuth vars. Original values captured once and restored after
 * every test (afterEach still runs on failure) so this file can never
 * contaminate any other test file's environment.
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

function postStatusCallback(
  ctx: Ctx,
  formParams: Record<string, string>,
  options?: { signature?: string; noSignature?: boolean },
) {
  const signature = options?.noSignature
    ? undefined
    : (options?.signature ?? computeValidSignature(CANONICAL_URL, formParams, AUTH_TOKEN));

  let req = request(ctx.app)
    .post("/twilio/sms-status")
    .type("application/x-www-form-urlencoded")
    .send(new URLSearchParams(formParams).toString());

  if (signature !== undefined) {
    req = req.set("X-Twilio-Signature", signature);
  }
  return req;
}

/** Seeds one sms_notifications row already past the worker's own send
 * step (status "sent", a known providerMessageSid) -- the only state a
 * real delivery-status callback would ever arrive against. Uses the
 * in-memory repository directly (test setup), not the HTTP path under
 * test. */
async function seedSentNotification(
  ctx: Ctx,
  providerMessageSid: string,
  providerStatus?: string,
) {
  const organizationId = randomUUID();
  const appointmentId = randomUUID();
  const created = await ctx.smsNotifications.create({
    organizationId,
    notificationType: "appointment_confirmation",
    destinationPhone: "+15551234567",
    appointmentId,
  });
  const [claimed] = await ctx.smsNotifications.claimDue(10);
  await ctx.smsNotifications.updateStatus(claimed!.id, organizationId, {
    status: "sent",
    providerMessageSid,
    ...(providerStatus !== undefined ? { providerStatus } : {}),
  });
  return { id: created.id, organizationId };
}

/**
 * Captures the REAL, final emitted log output (post pino
 * serializers/redaction) -- exactly tests/logger-redaction.test.ts's own
 * captureLogLines, copied here (not imported: that helper is file-local
 * and this change is scoped to this file only). Deliberately NOT a
 * vi.spyOn(logger, ...) capture: spying on the logger method intercepts
 * raw, pre-redaction call arguments, including pino-http's own automatic
 * per-request log call, whose raw req/res objects both bypass pino's
 * redact pipeline entirely AND are circular. This spies on
 * process.stdout.write instead, so what's captured is the actual bytes
 * pino would really emit, after every serializer and redact rule has run.
 */
async function captureLogLines(run: () => Promise<unknown>): Promise<unknown[]> {
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
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    writeSpy.mockRestore();
    logger.level = originalLevel;
  }

  return chunks
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((line): line is unknown => line !== null);
}

describe("POST /twilio/sms-status", () => {
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
    vi.restoreAllMocks();
  });

  it("rejects with 403 when TWILIO_AUTH_TOKEN is not configured, without touching the repository", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const res = await postStatusCallback(ctx, { MessageSid: "SM1", MessageStatus: "delivered" });
    expect(res.status).toBe(403);
  });

  it("rejects with 403 when API_PUBLIC_BASE_URL is not configured, without touching the repository", async () => {
    delete process.env.API_PUBLIC_BASE_URL;
    const res = await postStatusCallback(ctx, { MessageSid: "SM1", MessageStatus: "delivered" });
    expect(res.status).toBe(403);
  });

  it("rejects with 403 when the signature header is missing", async () => {
    const res = await postStatusCallback(
      ctx,
      { MessageSid: "SM1", MessageStatus: "delivered" },
      { noSignature: true },
    );
    expect(res.status).toBe(403);
  });

  it("rejects with 403 when the signature is invalid", async () => {
    const res = await postStatusCallback(
      ctx,
      { MessageSid: "SM1", MessageStatus: "delivered" },
      { signature: "totally-wrong-signature" },
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for a validly signed request missing MessageSid", async () => {
    const res = await postStatusCallback(ctx, { MessageStatus: "delivered" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a validly signed request missing MessageStatus", async () => {
    const res = await postStatusCallback(ctx, { MessageSid: "SM1" });
    expect(res.status).toBe(400);
  });

  it("returns 200 for a validly signed request with an unknown MessageSid, with no DB modification", async () => {
    const res = await postStatusCallback(ctx, {
      MessageSid: "SM-unknown",
      MessageStatus: "delivered",
    });
    expect(res.status).toBe(200);
  });

  it("updates providerStatus for a known MessageSid, leaving the internal queue status unchanged", async () => {
    const { id, organizationId } = await seedSentNotification(ctx, "SM-known");

    const res = await postStatusCallback(ctx, { MessageSid: "SM-known", MessageStatus: "delivered" });
    expect(res.status).toBe(200);

    const updated = await ctx.smsNotifications.findByIdAndOrganizationId(id, organizationId);
    expect(updated?.providerStatus).toBe("delivered");
    expect(updated?.status).toBe("sent"); // internal queue status unchanged
  });

  it("rejects a provider-status regression (delivered must not revert to sending)", async () => {
    const { id, organizationId } = await seedSentNotification(ctx, "SM-regress", "delivered");

    const res = await postStatusCallback(ctx, { MessageSid: "SM-regress", MessageStatus: "sending" });
    expect(res.status).toBe(200);

    const updated = await ctx.smsNotifications.findByIdAndOrganizationId(id, organizationId);
    expect(updated?.providerStatus).toBe("delivered"); // unchanged, regression rejected
  });

  it("handles a duplicate callback as a safe no-op", async () => {
    const { id, organizationId } = await seedSentNotification(ctx, "SM-dup");

    const first = await postStatusCallback(ctx, { MessageSid: "SM-dup", MessageStatus: "delivered" });
    expect(first.status).toBe(200);
    const second = await postStatusCallback(ctx, { MessageSid: "SM-dup", MessageStatus: "delivered" });
    expect(second.status).toBe(200);

    const updated = await ctx.smsNotifications.findByIdAndOrganizationId(id, organizationId);
    expect(updated?.providerStatus).toBe("delivered");
  });

  it("terminal provider status cannot regress to an earlier known status even via a second callback", async () => {
    const { id, organizationId } = await seedSentNotification(ctx, "SM-terminal-guard", "delivered");

    await postStatusCallback(ctx, { MessageSid: "SM-terminal-guard", MessageStatus: "sent" });
    const updated = await ctx.smsNotifications.findByIdAndOrganizationId(id, organizationId);
    expect(updated?.providerStatus).toBe("delivered");
  });

  it("allows a known non-terminal current status to be overwritten by an unrecognized future status", async () => {
    const { id, organizationId } = await seedSentNotification(ctx, "SM-future", "queued");

    const res = await postStatusCallback(ctx, { MessageSid: "SM-future", MessageStatus: "read" });
    expect(res.status).toBe(200);
    const updated = await ctx.smsNotifications.findByIdAndOrganizationId(id, organizationId);
    expect(updated?.providerStatus).toBe("read");
  });

  it("rejects an unrecognized future status overwriting a known terminal status", async () => {
    const { id, organizationId } = await seedSentNotification(ctx, "SM-protect", "delivered");

    const res = await postStatusCallback(ctx, { MessageSid: "SM-protect", MessageStatus: "read" });
    expect(res.status).toBe(200);
    const updated = await ctx.smsNotifications.findByIdAndOrganizationId(id, organizationId);
    expect(updated?.providerStatus).toBe("delivered"); // unchanged
  });

  it("the final emitted logs never contain the auth token, signature, phone number, or SMS body", async () => {
    await seedSentNotification(ctx, "SM-log-check");
    const forbidden = [AUTH_TOKEN, "+15551234567", "totally-wrong-signature"];

    const lines = await captureLogLines(async () => {
      // Exercises every branch that logs: a successful, known-SID update
      // (info), a validly-signed-but-malformed request (warn), and a
      // rejected signature carrying the literal forbidden string (warn).
      await postStatusCallback(ctx, { MessageSid: "SM-log-check", MessageStatus: "delivered" });
      await postStatusCallback(ctx, { MessageStatus: "delivered" });
      await postStatusCallback(
        ctx,
        { MessageSid: "SM1", MessageStatus: "delivered" },
        { signature: "totally-wrong-signature" },
      );
    });

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const serialized = JSON.stringify(line);
      for (const secret of forbidden) {
        expect(serialized).not.toContain(secret);
      }
    }
  });
});
