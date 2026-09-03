import type { NextFunction, Request, Response } from "express";
import type {
  MembershipRepository,
  OrganizationMembership,
} from "../repositories/organization-types.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      membership?: OrganizationMembership;
    }
  }
}

/**
 * The tenant-isolation boundary. Reads :organizationId from the URL — but
 * never trusts it: every request independently re-queries the database for
 * a real membership row matching (organizationId, the authenticated
 * user's id from requireAuth). No cached/session-stored "current
 * organization" is ever treated as authorization. See SECURITY.md
 * "Tenant isolation" and ARCHITECTURE.md "Organizations".
 *
 * Must be mounted after requireAuth (needs req.user) on every
 * organization-scoped route.
 */
export function requireOrgMembership(memberships: MembershipRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const organizationId = req.params.organizationId;
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      res.status(400).json({ error: "Missing organization id." });
      return;
    }

    const membership = await memberships.findByOrgAndUser(organizationId, req.user!.id);
    if (!membership) {
      // 404, not 403 — a non-member gets the same response whether the
      // organization exists or not, so they can't use this endpoint to
      // enumerate organization ids that exist but aren't theirs.
      res.status(404).json({ error: "Organization not found." });
      return;
    }

    req.membership = membership;
    next();
  };
}
