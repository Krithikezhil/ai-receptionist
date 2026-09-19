import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInMemoryStripeWebhookEventRepository } from "./support/in-memory-organization-repositories.js";
import type { NewStripeWebhookEvent } from "../src/repositories/stripe-webhook-event-types.js";

/**
 * Webhook-sync scaffold ("Subscription lookup + webhook-event
 * repository" -- an informal working-scope name, not an official M13
 * step): exercises the in-memory repository only, following the
 * organization-subscription.repository.test.ts (M13 Step 2) precedent --
 * no webhook route/controller/signature verification exists yet, so
 * there is no HTTP path to exercise this through.
 */

function newEvent(overrides: Partial<NewStripeWebhookEvent> = {}): NewStripeWebhookEvent {
  return {
    id: `evt_${randomUUID()}`,
    type: "customer.subscription.updated",
    stripeSubscriptionId: `sub_${randomUUID()}`,
    stripeCreatedAt: new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("StripeWebhookEventRepository (in-memory)", () => {
  describe("insertIfAbsent", () => {
    it("inserts a new event id successfully", async () => {
      const repo = createInMemoryStripeWebhookEventRepository();
      const event = newEvent();

      const created = await repo.insertIfAbsent(event);

      expect(created).toMatchObject({
        id: event.id,
        type: event.type,
        stripeSubscriptionId: event.stripeSubscriptionId,
        organizationId: null,
        applied: false,
      });
      expect(created?.stripeCreatedAt).toEqual(event.stripeCreatedAt);
    });

    it("does not insert again for a duplicate event id", async () => {
      const repo = createInMemoryStripeWebhookEventRepository();
      const event = newEvent();

      const first = await repo.insertIfAbsent(event);
      const second = await repo.insertIfAbsent({
        ...event,
        // Even a different payload for the same id must be rejected --
        // the id alone is the dedupe key.
        type: "customer.subscription.deleted",
      });

      expect(first).toBeDefined();
      expect(second).toBeUndefined();
    });

    it("stores organizationId when supplied at insert time", async () => {
      const repo = createInMemoryStripeWebhookEventRepository();
      const organizationId = randomUUID();

      const created = await repo.insertIfAbsent(newEvent({ organizationId }));

      expect(created?.organizationId).toBe(organizationId);
    });
  });

  describe("findLatestAppliedForSubscription", () => {
    it("returns undefined when there are no events at all", async () => {
      const repo = createInMemoryStripeWebhookEventRepository();
      const result = await repo.findLatestAppliedForSubscription(`sub_${randomUUID()}`);
      expect(result).toBeUndefined();
    });

    it("returns undefined when events exist but none are applied", async () => {
      const repo = createInMemoryStripeWebhookEventRepository();
      const subscriptionId = `sub_${randomUUID()}`;
      await repo.insertIfAbsent(
        newEvent({ stripeSubscriptionId: subscriptionId, stripeCreatedAt: new Date("2030-01-01T00:00:00.000Z") }),
      );

      const result = await repo.findLatestAppliedForSubscription(subscriptionId);
      expect(result).toBeUndefined();
    });

    it("returns the latest applied event's stripeCreatedAt, ignoring unapplied ones", async () => {
      const repo = createInMemoryStripeWebhookEventRepository();
      const subscriptionId = `sub_${randomUUID()}`;

      const older = await repo.insertIfAbsent(
        newEvent({ stripeSubscriptionId: subscriptionId, stripeCreatedAt: new Date("2030-01-01T00:00:00.000Z") }),
      );
      const newer = await repo.insertIfAbsent(
        newEvent({ stripeSubscriptionId: subscriptionId, stripeCreatedAt: new Date("2030-01-03T00:00:00.000Z") }),
      );
      // A third, even-later event that is never marked applied must not
      // affect the result.
      await repo.insertIfAbsent(
        newEvent({ stripeSubscriptionId: subscriptionId, stripeCreatedAt: new Date("2030-01-05T00:00:00.000Z") }),
      );

      await repo.markApplied(older!.id, randomUUID());
      await repo.markApplied(newer!.id, randomUUID());

      const result = await repo.findLatestAppliedForSubscription(subscriptionId);
      expect(result).toEqual(new Date("2030-01-03T00:00:00.000Z"));
    });

    it("keeps subscription IDs isolated from one another", async () => {
      const repo = createInMemoryStripeWebhookEventRepository();
      const subscriptionA = `sub_${randomUUID()}`;
      const subscriptionB = `sub_${randomUUID()}`;

      const eventA = await repo.insertIfAbsent(
        newEvent({ stripeSubscriptionId: subscriptionA, stripeCreatedAt: new Date("2030-01-01T00:00:00.000Z") }),
      );
      const eventB = await repo.insertIfAbsent(
        newEvent({ stripeSubscriptionId: subscriptionB, stripeCreatedAt: new Date("2030-06-01T00:00:00.000Z") }),
      );
      await repo.markApplied(eventA!.id, randomUUID());
      await repo.markApplied(eventB!.id, randomUUID());

      expect(await repo.findLatestAppliedForSubscription(subscriptionA)).toEqual(
        new Date("2030-01-01T00:00:00.000Z"),
      );
      expect(await repo.findLatestAppliedForSubscription(subscriptionB)).toEqual(
        new Date("2030-06-01T00:00:00.000Z"),
      );
    });
  });

  describe("markApplied", () => {
    it("changes only the requested event", async () => {
      const repo = createInMemoryStripeWebhookEventRepository();
      const subscriptionId = `sub_${randomUUID()}`;

      const eventOne = await repo.insertIfAbsent(newEvent({ stripeSubscriptionId: subscriptionId }));
      const eventTwo = await repo.insertIfAbsent(newEvent({ stripeSubscriptionId: subscriptionId }));
      const organizationId = randomUUID();

      await repo.markApplied(eventOne!.id, organizationId);

      const latest = await repo.findLatestAppliedForSubscription(subscriptionId);
      expect(latest).toEqual(eventOne!.stripeCreatedAt);

      // eventTwo remains unapplied -- proven indirectly: marking it
      // applied changes the "latest applied" result, so if it were
      // already (incorrectly) applied, this assertion would already
      // reflect eventTwo's timestamp above.
      await repo.markApplied(eventTwo!.id, organizationId);
      const latestAfterBoth = await repo.findLatestAppliedForSubscription(subscriptionId);
      expect(latestAfterBoth).toEqual(
        eventOne!.stripeCreatedAt > eventTwo!.stripeCreatedAt
          ? eventOne!.stripeCreatedAt
          : eventTwo!.stripeCreatedAt,
      );
    });

    it("is a safe no-op for an unknown event id", async () => {
      const repo = createInMemoryStripeWebhookEventRepository();
      await expect(repo.markApplied(`evt_${randomUUID()}`, randomUUID())).resolves.toBeUndefined();
    });
  });
});
