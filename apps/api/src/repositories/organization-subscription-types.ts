export type OrganizationSubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

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

  upsert(
    subscription: NewOrganizationSubscription,
  ): Promise<OrganizationSubscription>;

  update(
    organizationId: string,
    changes: OrganizationSubscriptionUpdate,
  ): Promise<OrganizationSubscription | undefined>;
}
