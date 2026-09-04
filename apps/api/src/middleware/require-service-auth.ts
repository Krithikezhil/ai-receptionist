import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Set once requireServiceAuth accepts the request. There is no
       * per-request "service identity" beyond this boolean — a valid key
       * authenticates the caller as *a* trusted internal service, not as
       * any particular user or organization. See SECURITY.md
       * "Service-to-service authentication".
       */
      serviceAuthenticated?: boolean;
    }
  }
}

/**
 * The service-to-service authentication boundary for /internal/v1/*,
 * completely separate from requireAuth/requireOrgMembership (those are
 * user-identity/membership checks; a backend service has neither). Expects
 * `Authorization: Bearer <key>` and compares it to the configured
 * INTERNAL_SERVICE_KEY in constant time.
 *
 * A valid key grants read access to ANY organization's internal data via
 * whatever :organizationId appears in the URL — it is deliberately
 * broad-scoped, not per-tenant. This is an accepted, documented trust
 * model (the caller is a trusted internal process, not an end user); see
 * SECURITY.md for the full reasoning and its limits. The key must never be
 * exposed to apps/web or any browser context.
 */
export function requireServiceAuth(expectedKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const provided =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : undefined;

    if (!provided || !safeCompare(provided, expectedKey)) {
      res.status(401).json({ error: "Not authenticated." });
      return;
    }

    req.serviceAuthenticated = true;
    next();
  };
}

/**
 * timingSafeEqual throws if the two buffers differ in length instead of
 * returning false, so a length mismatch is checked explicitly first — a
 * wrong-length key must 401 like any other mismatch, not crash into the
 * generic 500 handler. Exported so require-organization-service-token.ts
 * reuses this exact comparison rather than duplicating it.
 */
export function safeCompare(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
