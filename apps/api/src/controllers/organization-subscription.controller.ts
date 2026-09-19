import type { Request, Response } from "express";
import type { OrganizationSubscriptionService } from "../services/organization-subscription.service.js";

/**
 * M13 Step 3: GET /organizations/:organizationId/subscription -- read-only,
 * open to any member (matches every other read endpoint's convention, no
 * owner-gating since there is no mutating action here). Absence of a local
 * subscription row is not a 404 -- it's a normal, valid state (see
 * OrganizationSubscriptionService.getStatus()), so this always returns 200.
 * No Stripe/network call ever happens on this path.
 */
export function createOrganizationSubscriptionController(
  subscriptionService: OrganizationSubscriptionService,
) {
  return {
    async getStatus(req: Request, res: Response): Promise<void> {
      const status = await subscriptionService.getStatus(req.params.organizationId as string);
      res.status(200).json(status);
    },
  };
}
