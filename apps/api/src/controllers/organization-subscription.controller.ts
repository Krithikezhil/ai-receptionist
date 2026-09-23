import type { Request, Response } from "express";
import type { OrganizationSubscriptionService } from "../services/organization-subscription.service.js";

/**
 * M13 Step 3: GET /organizations/:organizationId/subscription -- read-only,
 * open to any member (matches every other read endpoint's convention, no
 * owner-gating since there is no mutating action here). Absence of a local
 * subscription row is not a 404 -- it's a normal, valid state (see
 * OrganizationSubscriptionService.getStatus()), so this always returns 200.
 * No Stripe/network call ever happens on this path.
 *
 * M13 Step 5: POST /organizations/:organizationId/subscription/stripe-customer
 * additionally requires the owner role -- same requireOwner pattern as
 * calendar-connection.controller.ts/phone-number.controller.ts, since this
 * is the first mutating, billing-relevant action this controller exposes.
 * Never returns the Stripe customer id, the Stripe Customer object, or any
 * other subscription field -- 204 on success, matching phone-number
 * remove()'s "mutation, nothing to return" convention. Any failure
 * (including a missing STRIPE_SECRET_KEY, surfaced by the Stripe client as
 * a thrown StripeApiError) propagates to the app's centralized error
 * handler, which already never leaks internal error detail to the client.
 *
 * M13 Step 6: POST /organizations/:organizationId/subscription/checkout-session
 * is owner-gated the same way, and returns only `{ url }` -- the Checkout
 * URL to redirect the browser to. Never returns the Stripe customer id,
 * Checkout Session id, subscription id, price ids, or any raw Stripe
 * response data. Missing Price-ID/redirect-URL configuration surfaces as a
 * StripeApiError, same centralized-error-handling treatment as above.
 */
export function createOrganizationSubscriptionController(
  subscriptionService: OrganizationSubscriptionService,
) {
  function requireOwner(req: Request, res: Response): boolean {
    if (req.membership?.role !== "owner") {
      res
        .status(403)
        .json({ error: "Only an organization owner can manage the Stripe subscription." });
      return false;
    }
    return true;
  }

  return {
    async getStatus(req: Request, res: Response): Promise<void> {
      const status = await subscriptionService.getStatus(req.params.organizationId as string);
      res.status(200).json(status);
    },

    async ensureStripeCustomer(req: Request, res: Response): Promise<void> {
      if (!requireOwner(req, res)) return;

      await subscriptionService.ensureStripeCustomer(req.params.organizationId as string);
      res.status(204).send();
    },

    async createCheckoutSession(req: Request, res: Response): Promise<void> {
      if (!requireOwner(req, res)) return;

      const url = await subscriptionService.createCheckoutSession(
        req.params.organizationId as string,
      );
      res.status(200).json({ url });
    },
  };
}
