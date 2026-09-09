import type { NextFunction, Request, Response } from "express";
import { verifyCallCredential } from "../auth/call-credential.js";
import type { OrganizationServiceCredentialRepository } from "../repositories/organization-service-credential-types.js";
import { requireOrganizationServiceToken } from "./require-organization-service-token.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Which mechanism authorized this request for its :organizationId --
       * informational only, nothing branches on it today. Only set on the
       * M7 call-credential path; the M5 fallback path below calls the
       * original requireOrganizationServiceToken unmodified and does not
       * set this.
       */
      serviceAuthenticatedVia?: "call_credential";
      /**
       * M10 Step 7: the call credential's own verified call_sid claim --
       * only ever set on the M7 call-credential path, never on the M5
       * per-organization long-lived-token fallback (that credential
       * carries no call_sid concept at all, so this stays undefined there).
       * Authoritative over anything a request body claims, whenever it is
       * set -- see controllers/internal.controller.ts's bookAppointment.
       */
      verifiedCallSid?: string;
    }
  }
}

/**
 * M7: the tenant-authorization boundary for routes that must accept EITHER
 * a short-lived, call-bound credential (Twilio-originated sessions) OR the
 * existing M5 long-lived per-organization token (the dev/manual flow) --
 * without changing require-organization-service-token.ts at all.
 *
 * This function is a thin composition wrapper, not an extension: it tries
 * the new, independent call-credential check first (cheap, stateless, no
 * DB read); if that doesn't apply, it delegates the ENTIRE request to the
 * original, byte-for-byte unmodified requireOrganizationServiceToken
 * middleware, which produces exactly the 400/403/404 responses it already
 * produces today. A value that isn't a valid call credential is therefore
 * indistinguishable, from the caller's point of view, from a request that
 * had never heard of call credentials at all -- see the approved M7 plan
 * §4 and apps/api/tests/require-organization-auth.test.ts, which proves
 * this equivalence directly against the unmodified middleware.
 *
 * Organization identity is never taken from anywhere other than this
 * verification: the :organizationId URL param is what verifyCallCredential
 * checks the credential's own organization_id claim against (see
 * auth/call-credential.ts) -- a credential minted for one organization can
 * never authorize a different :organizationId, regardless of what a caller
 * requests, and neither this middleware nor the fallback it delegates to
 * ever trusts an organization id from the request body, query string, or
 * any other unverified source.
 *
 * No logging happens in this middleware: call-credential verification
 * failures are not secrets, but this file has no logger wired in and adding
 * one is out of scope for a narrow composition wrapper -- the eventual
 * 400/403/404 response (from either path) is what the standard pino-http
 * request logger (app.ts) already records. Never logs the credential/token
 * value itself either way.
 */
export function requireOrganizationAuth(
  credentials: OrganizationServiceCredentialRepository,
  callCredentialSecret: string,
) {
  const fallback = requireOrganizationServiceToken(credentials);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const organizationId = req.params.organizationId;
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      res.status(400).json({ error: "Missing organization id." });
      return;
    }

    const header = req.headers["x-organization-service-token"];
    const provided = typeof header === "string" ? header : undefined;

    if (provided) {
      const result = verifyCallCredential(provided, organizationId, callCredentialSecret);
      if (result.valid) {
        req.serviceAuthenticatedVia = "call_credential";
        req.verifiedCallSid = result.callSid;
        next();
        return;
      }
    }

    // Not a valid call credential (missing, malformed, wrong org, wrong
    // signature, or expired) -- fall through to the ORIGINAL M5 check,
    // completely unmodified. It re-reads the same header itself and
    // produces its own 403/404 exactly as it does today.
    await fallback(req, res, next);
  };
}
