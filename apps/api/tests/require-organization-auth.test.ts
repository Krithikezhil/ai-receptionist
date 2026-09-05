import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { generateCallCredential } from "../src/auth/call-credential.js";
import { requireOrganizationAuth } from "../src/middleware/require-organization-auth.js";
import { requireOrganizationServiceToken } from "../src/middleware/require-organization-service-token.js";
import type { OrganizationServiceCredentialRepository } from "../src/repositories/organization-service-credential-types.js";

const CALL_SECRET = "test-call-credential-secret";
const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const CALL_SID = "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** Mirrors auth/organization-service-token.ts's hashOrganizationServiceToken
 * exactly (SHA-256 hex) without importing it, so this fake stays a
 * self-contained test double rather than depending on production hashing
 * internals. */
function hashForTest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** ORG_A's real M5 dev token/hash -- ORG_B deliberately has no credential
 * row at all, mirroring "an organization that exists but a token was never
 * issued for it" as distinctly as "an organization that doesn't exist". */
const ORG_A_TOKEN = "org-a-real-dev-token";
const ORG_A_TOKEN_HASH = hashForTest(ORG_A_TOKEN);

function fakeCredentialRepo(
  rows: Record<string, string>, // organizationId -> tokenHash
): OrganizationServiceCredentialRepository {
  return {
    async create() {
      throw new Error("not implemented in this fake");
    },
    async findByOrganizationId(organizationId) {
      const tokenHash = rows[organizationId];
      return tokenHash ? { organizationId, tokenHash, createdAt: new Date() } : undefined;
    },
  };
}

function fakeReq(organizationId: string | undefined, headerValue: string | undefined): Request {
  return {
    params: organizationId === undefined ? {} : { organizationId },
    headers: headerValue === undefined ? {} : { "x-organization-service-token": headerValue },
  } as unknown as Request;
}

interface CapturedResponse {
  statusCode?: number;
  body?: unknown;
}

function fakeRes(): { res: Response; captured: CapturedResponse } {
  const captured: CapturedResponse = {};
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, captured };
}

const REPO = fakeCredentialRepo({ [ORG_A]: ORG_A_TOKEN_HASH });

async function run(
  middleware: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
  organizationId: string | undefined,
  headerValue: string | undefined,
): Promise<{ captured: CapturedResponse; next: ReturnType<typeof vi.fn> }> {
  const req = fakeReq(organizationId, headerValue);
  const { res, captured } = fakeRes();
  const next = vi.fn();
  await middleware(req, res, next);
  return { captured, next };
}

describe("requireOrganizationAuth", () => {
  it("authorizes a valid call credential for the organization it was minted for", async () => {
    const token = generateCallCredential(ORG_A, CALL_SID, CALL_SECRET);
    const { captured, next } = await run(
      requireOrganizationAuth(REPO, CALL_SECRET),
      ORG_A,
      token,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(); // no error
    expect(captured.statusCode).toBeUndefined();
  });

  it("rejects an expired call credential (and also fails the M5 fallback, since it is not a real dev token)", async () => {
    const expired = generateCallCredential(ORG_A, CALL_SID, CALL_SECRET, -1);
    const { captured, next } = await run(
      requireOrganizationAuth(REPO, CALL_SECRET),
      ORG_A,
      expired,
    );
    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(403);
  });

  it("rejects a malformed credential value (falls through to the M5 check, which also rejects it)", async () => {
    const { captured, next } = await run(
      requireOrganizationAuth(REPO, CALL_SECRET),
      ORG_A,
      "not-a-valid-token-shape",
    );
    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(403);
  });

  it("falls back to the M5 organization service token when no call credential is presented", async () => {
    const { captured, next } = await run(
      requireOrganizationAuth(REPO, CALL_SECRET),
      ORG_A,
      ORG_A_TOKEN,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.statusCode).toBeUndefined();
  });

  it("rejects when neither a valid call credential nor a valid service token is presented", async () => {
    const { captured, next } = await run(
      requireOrganizationAuth(REPO, CALL_SECRET),
      ORG_A,
      "garbage-value",
    );
    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(403);
  });

  it("rejects when no credential header is present at all", async () => {
    const { captured, next } = await run(
      requireOrganizationAuth(REPO, CALL_SECRET),
      ORG_A,
      undefined,
    );
    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(403);
  });

  it("tenant isolation: a call credential minted for org A never authorizes org B's URL", async () => {
    const tokenForOrgA = generateCallCredential(ORG_A, CALL_SID, CALL_SECRET);
    const { captured, next } = await run(
      requireOrganizationAuth(REPO, CALL_SECRET),
      ORG_B,
      tokenForOrgA,
    );
    expect(next).not.toHaveBeenCalled();
    // ORG_B has no credential row in REPO, so the M5 fallback 404s (same
    // non-enumeration behavior it already has today) rather than 403 --
    // asserting the exact code proves this reached the real fallback logic,
    // not a generic rejection invented by the composed middleware.
    expect(captured.statusCode).toBe(404);
  });

  it("tenant isolation: the M5 dev token for org A never authorizes org B's URL", async () => {
    const { captured, next } = await run(
      requireOrganizationAuth(REPO, CALL_SECRET),
      ORG_B,
      ORG_A_TOKEN,
    );
    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(404);
  });

  it("400s on a missing organization id, before attempting either check", async () => {
    const { captured, next } = await run(
      requireOrganizationAuth(REPO, CALL_SECRET),
      undefined,
      "anything",
    );
    expect(next).not.toHaveBeenCalled();
    expect(captured.statusCode).toBe(400);
  });

  describe("equivalence with the unmodified M5 middleware (proves it is untouched)", () => {
    const scenarios: Array<{
      name: string;
      organizationId: string | undefined;
      header: string | undefined;
    }> = [
      { name: "no header", organizationId: ORG_A, header: undefined },
      { name: "garbage header", organizationId: ORG_A, header: "garbage-value" },
      { name: "wrong org's real dev token", organizationId: ORG_B, header: ORG_A_TOKEN },
      { name: "correct dev token", organizationId: ORG_A, header: ORG_A_TOKEN },
      { name: "missing organization id", organizationId: undefined, header: ORG_A_TOKEN },
    ];

    for (const scenario of scenarios) {
      it(`produces the identical response to the original middleware for: ${scenario.name}`, async () => {
        const composed = await run(
          requireOrganizationAuth(REPO, CALL_SECRET),
          scenario.organizationId,
          scenario.header,
        );
        const original = await run(
          requireOrganizationServiceToken(REPO),
          scenario.organizationId,
          scenario.header,
        );

        expect(composed.captured.statusCode).toBe(original.captured.statusCode);
        expect(composed.captured.body).toEqual(original.captured.body);
        expect(composed.next.mock.calls.length).toBe(original.next.mock.calls.length);
      });
    }
  });
});
