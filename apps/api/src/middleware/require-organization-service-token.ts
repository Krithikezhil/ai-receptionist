import type { NextFunction, Request, Response } from "express";
import { hashOrganizationServiceToken } from "../auth/organization-service-token.js";
import type { OrganizationServiceCredentialRepository } from "../repositories/organization-service-credential-types.js";
import { safeCompare } from "./require-service-auth.js";

/**
 * The tenant-authorization boundary for /internal/v1/*, mounted AFTER
 * requireServiceAuth (which only proves "this caller knows
 * INTERNAL_SERVICE_KEY" — a fact that is the same for every organization
 * and therefore proves nothing about which one this request is allowed to
 * touch). This middleware is what actually establishes the authorized
 * organization: it reads `X-Organization-Service-Token`, hashes it, and
 * checks it against the hash stored for the exact :organizationId named in
 * the URL — the same "independently re-authorize the URL's id against a
 * database fact on every request" pattern requireOrgMembership already uses
 * for user sessions (org+user membership row instead of org+token hash).
 *
 * A token that is valid for one organization is never valid for another:
 * changing only the URL's :organizationId while reusing a different
 * organization's token fails here, every time — the API enforces this
 * itself; it never trusts the caller (the voice-agent) to only ask for the
 * organization it should. See ARCHITECTURE.md "Internal voice API" and
 * SECURITY.md "Service-to-service authentication".
 *
 * Response codes are deliberately three-tiered and distinct from
 * requireServiceAuth's 401:
 *   - 404 — no such organization (or, in principle, one that exists without
 *     a credential row, which organization creation never allows) — same
 *     non-enumeration convention requireOrgMembership already uses.
 *   - 403 — the organization exists, but the presented token (missing,
 *     wrong-length, or simply wrong) does not authorize it.
 */
export function requireOrganizationServiceToken(
  credentials: OrganizationServiceCredentialRepository,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const organizationId = req.params.organizationId;
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      res.status(400).json({ error: "Missing organization id." });
      return;
    }

    const credential = await credentials.findByOrganizationId(organizationId);
    if (!credential) {
      res.status(404).json({ error: "Organization not found." });
      return;
    }

    const header = req.headers["x-organization-service-token"];
    const provided = typeof header === "string" ? header : undefined;

    if (!provided || !safeCompare(hashOrganizationServiceToken(provided), credential.tokenHash)) {
      res.status(403).json({ error: "Not authorized for this organization." });
      return;
    }

    next();
  };
}
