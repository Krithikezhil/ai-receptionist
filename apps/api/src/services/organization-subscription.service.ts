import type {
  OrganizationSubscriptionRepository,
  OrganizationSubscriptionStatus,
} from "../repositories/organization-subscription-types.js";
import type { StripeClient } from "./stripe-client-types.js";

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
}

export function createOrganizationSubscriptionService(
  repo: OrganizationSubscriptionRepository,
  stripeClient: StripeClient,
): OrganizationSubscriptionService {
  return {
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
  };
}
