export type OrganizationSubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "paused";

/**
 * M13 Step 2: at most one local subscription-state row per organization
 * (organizationId itself is the primary key -- same "one row per org, no
 * synthetic id" shape as OrganizationCalendarConnection). Absence of a row
 * means no local subscription state, not an "inactive" sentinel -- see
 * db/schema.ts's organizationSubscriptions comment.
 */
export interface OrganizationSubscription {
  organizationId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: string | null;
  status: OrganizationSubscriptionStatus | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOrganizationSubscription {
  organizationId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  plan?: string | null;
  status?: OrganizationSubscriptionStatus | null;
  currentPeriodEnd?: Date | null;
}

export interface OrganizationSubscriptionUpdate {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  plan?: string | null;
  status?: OrganizationSubscriptionStatus | null;
  currentPeriodEnd?: Date | null;
}

export interface OrganizationSubscriptionRepository {
  findByOrganizationId(
    organizationId: string,
  ): Promise<OrganizationSubscription | undefined>;

  /**
   * Webhook-sync lookup: resolves the organization already associated
   * with a given Stripe customer id, if any. Used by the future Stripe
   * webhook sync service to attribute an event to the correct
   * organization -- never used to accept a caller-supplied organizationId.
   */
  findByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<OrganizationSubscription | undefined>;

  /**
   * Same as findByStripeCustomerId, keyed by Stripe subscription id
   * instead -- an event may only carry the subscription id (not the
   * customer id) depending on which resolution path succeeds first.
   */
  findByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<OrganizationSubscription | undefined>;

  upsert(
    subscription: NewOrganizationSubscription,
  ): Promise<OrganizationSubscription>;

  update(
    organizationId: string,
    changes: OrganizationSubscriptionUpdate,
  ): Promise<OrganizationSubscription | undefined>;
}
