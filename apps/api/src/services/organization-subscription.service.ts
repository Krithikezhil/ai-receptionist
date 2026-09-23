import { randomUUID } from "node:crypto";
import type {
  OrganizationSubscriptionRepository,
  OrganizationSubscriptionStatus,
} from "../repositories/organization-subscription-types.js";
import { StripeApiError, type StripeClient } from "./stripe-client-types.js";

/**
 * M13 Step 6: the three non-secret Stripe Price IDs for the approved
 * commercial model (one-time setup, recurring licensed plan, metered
 * overage). Read directly from process.env at the point they're needed --
 * matching STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET's existing
 * optional-per-deployment Stripe-integration convention (see
 * stripe-client.ts / stripe-webhook.controller.ts's loadStripeWebhookSecret()),
 * not env.ts's central object -- keeping all Stripe-specific configuration
 * in one consistent place rather than splitting it across two mechanisms.
 * None of these are secrets; they are never sent to the browser regardless
 * (this file is server-only), and Products/Prices are never created by
 * application code -- these ids reference Prices configured outside the
 * repository (Stripe Dashboard/API), per the approved Step 6 design.
 */
function loadStripePriceIds(): {
  setupPriceId: string;
  licensedPriceId: string;
  meteredPriceId: string;
} {
  const setupPriceId = process.env.STRIPE_SETUP_PRICE_ID;
  const licensedPriceId = process.env.STRIPE_LICENSED_PRICE_ID;
  const meteredPriceId = process.env.STRIPE_METERED_PRICE_ID;
  if (!setupPriceId || !licensedPriceId || !meteredPriceId) {
    throw new StripeApiError(
      "Stripe Checkout is not configured: STRIPE_SETUP_PRICE_ID, STRIPE_LICENSED_PRICE_ID, " +
        "and STRIPE_METERED_PRICE_ID must all be set.",
    );
  }
  return { setupPriceId, licensedPriceId, meteredPriceId };
}

/**
 * M13 Step 6: full, deployment-configured Checkout redirect URLs --
 * mirrors GOOGLE_OAUTH_REDIRECT_URI's existing precedent (a complete URL
 * supplied by configuration, never synthesized here from env.corsOrigin +
 * an assumed path) so this code never has to guess at a Step 9 billing-UI
 * route that doesn't exist yet. Read at point of use, same reasoning as
 * loadStripePriceIds() above.
 */
function loadStripeCheckoutRedirectUrls(): { successUrl: string; cancelUrl: string } {
  const successUrl = process.env.STRIPE_CHECKOUT_SUCCESS_URL;
  const cancelUrl = process.env.STRIPE_CHECKOUT_CANCEL_URL;
  if (!successUrl || !cancelUrl) {
    throw new StripeApiError(
      "Stripe Checkout is not configured: STRIPE_CHECKOUT_SUCCESS_URL and " +
        "STRIPE_CHECKOUT_CANCEL_URL must both be set.",
    );
  }
  return { successUrl, cancelUrl };
}

/**
 * M13 Step 3: the public, dashboard-facing view of an organization's local
 * subscription state. Deliberately excludes stripeCustomerId/
 * stripeSubscriptionId -- those are server-side identifiers with no
 * current UI purpose, following the same minimal-exposure convention as
 * CalendarConnectionService's getStatus() (never returns ciphertext/tokens).
 */
export interface OrganizationSubscriptionStatusView {
  plan: string | null;
  status: OrganizationSubscriptionStatus | null;
  currentPeriodEnd: Date | null;
}

export interface OrganizationSubscriptionService {
  getStatus(organizationId: string): Promise<OrganizationSubscriptionStatusView>;

  /**
   * M13 Step 5: ensures a Stripe Customer exists for this organization and
   * that its id is durably persisted locally. A no-op (zero Stripe calls,
   * zero writes) once organizationSubscriptions.stripeCustomerId is
   * already set for this organization -- that column, once persisted, is
   * the true durable local invariant; the deterministic
   * `create-customer:{organizationId}` Idempotency-Key sent to Stripe is a
   * secondary defense for the short window between the Stripe call
   * succeeding and this persistence step completing (see the inline
   * comment below), not an indefinite guarantee on its own -- Stripe's own
   * idempotency-key retention is finite. Never returns the Stripe customer
   * id -- callers that need it read it back via getStatus()/the
   * repository, matching this service's existing minimal-exposure
   * convention.
   */
  ensureStripeCustomer(organizationId: string): Promise<void>;

  /**
   * M13 Step 6: ensures a Stripe customer exists (calling
   * ensureStripeCustomer itself -- callers never need to invoke that
   * endpoint separately first), then creates a fresh Stripe Checkout
   * Session for the approved commercial model's three line items and
   * returns only the Checkout URL. Every invocation is a new, short-lived
   * checkout attempt -- unlike ensureStripeCustomer's stable per-organization
   * idempotency key, this uses a fresh, request-specific Idempotency-Key
   * for every call (see the inline comment below) and never persists the
   * Checkout Session or its key locally.
   */
  createCheckoutSession(organizationId: string): Promise<string>;
}

export function createOrganizationSubscriptionService(
  repo: OrganizationSubscriptionRepository,
  stripeClient: StripeClient,
): OrganizationSubscriptionService {
  const service: OrganizationSubscriptionService = {
    async getStatus(organizationId) {
      const subscription = await repo.findByOrganizationId(organizationId);
      if (!subscription) {
        return { plan: null, status: null, currentPeriodEnd: null };
      }
      return {
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
      };
    },

    async ensureStripeCustomer(organizationId) {
      const existing = await repo.findByOrganizationId(organizationId);
      if (existing?.stripeCustomerId) {
        return;
      }

      // Deterministic and stable per organization -- reused unchanged
      // across every retry of this same logical "ensure a customer
      // exists" operation, never a fresh value per attempt (a
      // time-varying key would defeat Stripe's own deduplication
      // entirely). See the interface doc comment above for the accepted
      // limitation this key does and does not cover.
      const idempotencyKey = `create-customer:${organizationId}`;
      const customer = await stripeClient.createCustomer({ organizationId }, idempotencyKey);

      // repo.update() only affects a row that already exists (a plain SQL
      // UPDATE ... WHERE) -- silently a no-op otherwise, which would lose
      // the Stripe customer id forever for an organization with no prior
      // subscription row. repo.upsert() is only safe here in the opposite
      // case: its ON CONFLICT branch overwrites every column (plan,
      // status, stripeSubscriptionId, period fields) with `?? null`, so
      // calling it against an existing row would destroy state a webhook
      // sync may have already written. `existing` (looked up above) tells
      // us unambiguously which case we're in, so exactly one of the two
      // already-existing, already-tested repository methods is used, each
      // only in the case it's actually safe for.
      if (existing) {
        await repo.update(organizationId, { stripeCustomerId: customer.id });
      } else {
        await repo.upsert({ organizationId, stripeCustomerId: customer.id });
      }
    },

    async createCheckoutSession(organizationId) {
      await service.ensureStripeCustomer(organizationId);

      const subscription = await repo.findByOrganizationId(organizationId);
      const stripeCustomerId = subscription?.stripeCustomerId;
      if (!stripeCustomerId) {
        // Should be unreachable if ensureStripeCustomer succeeded -- fail
        // closed rather than send an undefined customer to Stripe.
        throw new StripeApiError("Stripe customer could not be resolved.");
      }

      const { setupPriceId, licensedPriceId, meteredPriceId } = loadStripePriceIds();
      const { successUrl, cancelUrl } = loadStripeCheckoutRedirectUrls();

      // Fresh per invocation, never reused or persisted -- a Checkout
      // Session is a new short-lived attempt each time, not a durable
      // per-organization resource like the Stripe customer itself (see
      // ensureStripeCustomer's stable create-customer:{organizationId}
      // key above, which this deliberately does NOT mirror).
      const idempotencyKey = `checkout:${randomUUID()}`;

      const session = await stripeClient.createCheckoutSession(
        {
          customerId: stripeCustomerId,
          successUrl,
          cancelUrl,
          setupPriceId,
          licensedPriceId,
          meteredPriceId,
        },
        idempotencyKey,
      );

      return session.url;
    },
  };
  return service;
}
