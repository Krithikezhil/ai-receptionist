import type {
  OrganizationSubscriptionRepository,
  OrganizationSubscriptionStatus,
} from "../repositories/organization-subscription-types.js";

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
}

export function createOrganizationSubscriptionService(
  repo: OrganizationSubscriptionRepository,
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
  };
}
