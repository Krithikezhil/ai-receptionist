/**
 * Dedupe/ordering record for one verified Stripe webhook event. `id` is
 * the Stripe event id itself (e.g. "evt_...") -- it IS the dedupe key, via
 * the underlying table's primary key. See db/schema.ts's
 * stripeWebhookEvents comment for the full design rationale.
 *
 * This repository makes no ordering *decision* -- it only records events
 * and reports the latest one already marked applied for a subscription.
 * Whether a given event is stale/out-of-order is the future sync
 * service's call, not this repository's.
 */
export interface StripeWebhookEvent {
  id: string;
  type: string;
  stripeSubscriptionId: string;
  organizationId: string | null;
  stripeCreatedAt: Date;
  applied: boolean;
  receivedAt: Date;
}

export interface NewStripeWebhookEvent {
  id: string;
  type: string;
  stripeSubscriptionId: string;
  organizationId?: string | null;
  stripeCreatedAt: Date;
}

export interface StripeWebhookEventRepository {
  /**
   * Inserts the event row if this id hasn't been seen before (dedupe via
   * the primary key). Returns the inserted row, or undefined when an
   * event with this id already exists (a duplicate delivery) -- the
   * caller must treat undefined as "already processed, do nothing
   * further" rather than an error.
   */
  insertIfAbsent(event: NewStripeWebhookEvent): Promise<StripeWebhookEvent | undefined>;

  /**
   * The stripeCreatedAt of the most recent event already marked
   * applied=true for this subscription, or undefined if none has ever
   * been applied. The future sync service uses this to reject
   * stale/out-of-order events before writing to organization_subscriptions.
   */
  findLatestAppliedForSubscription(stripeSubscriptionId: string): Promise<Date | undefined>;

  /**
   * Marks exactly one already-inserted event row as applied and records
   * the organization it was attributed to.
   */
  markApplied(eventId: string, organizationId: string): Promise<void>;
}
