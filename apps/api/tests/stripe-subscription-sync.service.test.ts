import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createStripeSubscriptionSyncService,
  MalformedStripeEventError,
  parseStripeWebhookEventPayload,
  type StripeSyncRepos,
  type StripeSyncTransactionRunner,
  type StripeWebhookEventPayload,
} from "../src/services/stripe-subscription-sync.service.js";
import type { OrganizationSubscriptionStatus } from "../src/repositories/organization-subscription-types.js";
import {
  createInMemoryOrganizationRepositories,
  createInMemoryOrganizationSubscriptionRepository,
  createInMemoryStripeWebhookEventRepository,
} from "./support/in-memory-organization-repositories.js";

/**
 * Service-level tests for the Stripe subscription sync pipeline, run
 * against in-memory repositories via a no-real-transaction runner --
 * mirrors createInMemoryUnitOfWork's own documented reasoning
 * (unit-of-work.ts): a single-threaded test double needs no real
 * transaction semantics to verify the DECISION LOGIC (dedupe, ordering,
 * resolution, mapping). This does NOT prove true concurrent-PostgreSQL
 * safety -- see the "sequential ordering" describe block below, and
 * SECURITY.md's Stripe webhook section, for the accepted first-row
 * concurrency residual risk this test suite cannot and does not claim to
 * disprove.
 */

function buildService() {
  const orgRepos = createInMemoryOrganizationRepositories();
  const repos: StripeSyncRepos = {
    organizationSubscriptions: createInMemoryOrganizationSubscriptionRepository(),
    stripeWebhookEvents: createInMemoryStripeWebhookEventRepository(),
    organizations: orgRepos.organizations,
  };
  const runner: StripeSyncTransactionRunner = {
    run: (fn) => fn(repos),
  };
  const service = createStripeSubscriptionSyncService(runner);
  return { service, repos };
}

/**
 * price.recurring.usage_type is the verified, documented Stripe field
 * ("licensed" vs "metered") the service now uses to resolve the licensed
 * item -- see resolveLicensedItem in stripe-subscription-sync.service.ts.
 * Test fixtures must supply it explicitly; there is no positional
 * (items[0]) fallback anymore. current_period_start/current_period_end
 * mirror StripeSubscriptionLineItem's own fields -- typed `number` to
 * match production, with individual malformed-value tests casting a
 * literal through `as unknown as TestSubscriptionItem` where a genuinely
 * invalid runtime value (string, NaN, Infinity, negative) is required,
 * the same way a real un-validated JSON payload could carry one.
 */
type TestSubscriptionItem = {
  price?: { id?: string; recurring?: { usage_type?: string } };
  current_period_start?: number;
  current_period_end?: number;
};

/** A single licensed-only item -- the default, minimal valid shape: a
 * subscription that has the $2,500 recurring plan but no metered overage
 * item yet. */
const LICENSED_ITEM: TestSubscriptionItem = {
  price: { id: "price_123", recurring: { usage_type: "licensed" } },
};

function makeEvent(overrides: {
  id?: string;
  type?: string;
  created?: number;
  subscriptionId?: string;
  customerId?: string;
  status?: string;
  metadata?: Record<string, unknown> | null;
  items?: TestSubscriptionItem[];
} = {}): StripeWebhookEventPayload {
  const {
    id = `evt_${randomUUID()}`,
    type = "customer.subscription.updated",
    created = Math.floor(Date.now() / 1000),
    subscriptionId = `sub_${randomUUID()}`,
    customerId = `cus_${randomUUID()}`,
    status = "active",
    metadata = null,
    items = [LICENSED_ITEM],
  } = overrides;
  return {
    id,
    type,
    created,
    data: {
      object: { id: subscriptionId, customer: customerId, status, metadata, items: { data: items } },
    },
  };
}

/** True if a row for this event id has already been recorded -- proven
 * indirectly via insertIfAbsent's own dedupe contract, since the
 * repository interface has no plain "get by id" read. */
async function eventAlreadyRecorded(
  repos: StripeSyncRepos,
  event: StripeWebhookEventPayload,
): Promise<boolean> {
  const result = await repos.stripeWebhookEvents.insertIfAbsent({
    id: event.id,
    type: event.type,
    stripeSubscriptionId: event.data.object.id,
    stripeCreatedAt: new Date(event.created * 1000),
  });
  return result === undefined;
}

describe("StripeSubscriptionSyncService", () => {
  describe("supported event types", () => {
    it("applies customer.subscription.created via metadata resolution", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const event = makeEvent({
        type: "customer.subscription.created",
        status: "active",
        metadata: { organizationId: org.id },
      });

      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.status).toBe("active");
      expect(sub?.stripeSubscriptionId).toBe(event.data.object.id);
    });

    it("applies customer.subscription.updated to an existing association", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      await repos.organizationSubscriptions.upsert({
        organizationId: org.id,
        stripeSubscriptionId: subscriptionId,
        status: "incomplete",
      });

      const event = makeEvent({
        type: "customer.subscription.updated",
        subscriptionId,
        status: "active",
      });
      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.status).toBe("active");
    });

    it("processes customer.subscription.deleted through the same mapping, preserving IDs/plan", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      const customerId = `cus_${randomUUID()}`;
      await repos.organizationSubscriptions.upsert({
        organizationId: org.id,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: customerId,
        plan: "price_123",
        status: "active",
      });

      const event = makeEvent({
        id: `evt_${randomUUID()}`,
        type: "customer.subscription.deleted",
        subscriptionId,
        customerId,
        status: "canceled",
        created: Math.floor(Date.now() / 1000) + 10,
      });
      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.status).toBe("canceled");
      expect(sub?.stripeSubscriptionId).toBe(subscriptionId);
      expect(sub?.stripeCustomerId).toBe(customerId);
      expect(sub?.plan).toBe("price_123");
    });
  });

  describe("unsupported event type", () => {
    it("does not create a stripe_webhook_events row and does not mutate state", async () => {
      const { service, repos } = buildService();
      const event = makeEvent({ type: "invoice.created" });

      await service.processEvent(event);

      expect(await eventAlreadyRecorded(repos, event)).toBe(false);
      expect(
        await repos.organizationSubscriptions.findByStripeSubscriptionId(event.data.object.id),
      ).toBeUndefined();
    });
  });

  describe("dedupe", () => {
    it("a duplicate event id causes no second mutation", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const event = makeEvent({ status: "active", metadata: { organizationId: org.id } });

      await service.processEvent(event);
      // Same event object again -- duplicate id.
      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.status).toBe("active");
      expect(sub?.updatedAt).toEqual(sub?.updatedAt); // sanity: still exactly one row
    });
  });

  describe("first subscription creation", () => {
    it("creates a new row for an organization with no prior subscription state", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      expect(await repos.organizationSubscriptions.findByOrganizationId(org.id)).toBeUndefined();

      const event = makeEvent({ status: "active", metadata: { organizationId: org.id } });
      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub).toBeDefined();
      expect(sub?.status).toBe("active");
      // First-ever write for this organization -- currentPeriodEnd was
      // never set anywhere, so it correctly remains null (an absence of
      // data, not an overwrite of an existing value).
      expect(sub?.currentPeriodEnd).toBeNull();
    });
  });

  describe("currentPeriodEnd preservation on existing rows", () => {
    it("does not null out an existing currentPeriodEnd when updating other webhook-owned fields", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      const existingPeriodEnd = new Date("2030-06-01T00:00:00.000Z");

      // Seed an existing row with a real currentPeriodEnd -- set by some
      // means other than this webhook path (this service never sets it),
      // e.g. a future step or manual data correction.
      await repos.organizationSubscriptions.upsert({
        organizationId: org.id,
        stripeSubscriptionId: subscriptionId,
        status: "incomplete",
        currentPeriodEnd: existingPeriodEnd,
      });
      const before = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(before?.currentPeriodEnd).toEqual(existingPeriodEnd);

      // A newer event for the same subscription, processed through the
      // real service end-to-end -- not calling repo.update() directly --
      // so this genuinely exercises the existing-row branch inside
      // processEvent(), not just the repository method in isolation.
      const newerEvent = makeEvent({
        subscriptionId,
        status: "active",
        created: Math.floor(Date.now() / 1000) + 100,
      });
      await service.processEvent(newerEvent);

      const after = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      // Webhook-owned fields were updated...
      expect(after?.status).toBe("active");
      expect(after?.stripeSubscriptionId).toBe(subscriptionId);
      // ...but currentPeriodEnd is exactly unchanged, not reset to null.
      expect(after?.currentPeriodEnd).toEqual(existingPeriodEnd);
    });
  });

  describe("event ordering (sequential, NOT a proof of concurrent-PostgreSQL safety)", () => {
    /**
     * These tests call processEvent() one after another with `await` --
     * genuinely sequential execution, never interleaved. They verify the
     * ORDERING DECISION LOGIC (compare against latest applied timestamp)
     * is correct when events arrive out of order, which is necessary but
     * not sufficient for real concurrency safety. They do NOT exercise,
     * and cannot exercise, the first-row race two truly simultaneous
     * Postgres transactions could hit -- see this file's top comment and
     * SECURITY.md.
     */

    it("newer event followed by an older event: older does not overwrite", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      const now = Math.floor(Date.now() / 1000);

      const newer = makeEvent({
        subscriptionId,
        created: now,
        status: "active",
        metadata: { organizationId: org.id },
      });
      const older = makeEvent({
        subscriptionId,
        created: now - 100,
        status: "past_due",
      });

      await service.processEvent(newer);
      await service.processEvent(older);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.status).toBe("active");
    });

    it("older event followed by a newer event: newer applies on top", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      const now = Math.floor(Date.now() / 1000);

      const older = makeEvent({
        subscriptionId,
        created: now - 100,
        status: "past_due",
        metadata: { organizationId: org.id },
      });
      const newer = makeEvent({
        subscriptionId,
        created: now,
        status: "active",
      });

      await service.processEvent(older);
      await service.processEvent(newer);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.status).toBe("active");
    });

    it("an event with a timestamp EQUAL to the latest applied event does not mutate", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);

      const first = makeEvent({
        subscriptionId,
        created,
        status: "active",
        metadata: { organizationId: org.id },
      });
      const second = makeEvent({
        subscriptionId,
        created, // identical timestamp
        status: "past_due",
      });

      await service.processEvent(first);
      await service.processEvent(second);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.status).toBe("active"); // second (equal-timestamp) did not win
    });
  });

  describe("multi-item subscriptions", () => {
    it("synchronizes successfully for the approved licensed + metered shape, storing the licensed price as plan", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const event = makeEvent({
        metadata: { organizationId: org.id },
        status: "active",
        items: [
          { price: { id: "price_metered_overage", recurring: { usage_type: "metered" } } },
          { price: { id: "price_licensed_2500", recurring: { usage_type: "licensed" } } },
        ],
      });

      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      // plan is the licensed recurring price, never the metered overage
      // price, and never selected positionally (the licensed item is
      // deliberately placed second in this fixture's items array).
      expect(sub?.plan).toBe("price_licensed_2500");
      expect(sub?.status).toBe("active");
    });

    it("preserves an existing non-null currentPeriodEnd when synchronizing a two-item subscription", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      const existingPeriodEnd = new Date("2030-06-01T00:00:00.000Z");
      await repos.organizationSubscriptions.upsert({
        organizationId: org.id,
        stripeSubscriptionId: subscriptionId,
        status: "incomplete",
        currentPeriodEnd: existingPeriodEnd,
      });

      const event = makeEvent({
        subscriptionId,
        status: "active",
        created: Math.floor(Date.now() / 1000) + 100,
        items: [
          { price: { id: "price_licensed_2500", recurring: { usage_type: "licensed" } } },
          { price: { id: "price_metered_overage", recurring: { usage_type: "metered" } } },
        ],
      });
      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.plan).toBe("price_licensed_2500");
      expect(sub?.currentPeriodEnd).toEqual(existingPeriodEnd);
    });

    it("does not select an item positionally and does not mutate when no item has a recognized usage_type", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const event = makeEvent({
        metadata: { organizationId: org.id },
        items: [{ price: { id: "price_1" } }, { price: { id: "price_2" } }],
      });

      await service.processEvent(event);

      expect(await eventAlreadyRecorded(repos, event)).toBe(true);
      expect(await repos.organizationSubscriptions.findByOrganizationId(org.id)).toBeUndefined();
      expect(
        await repos.stripeWebhookEvents.findLatestAppliedForSubscription(event.data.object.id),
      ).toBeUndefined();
    });

    it("does not mutate when two items both claim to be the licensed price (ambiguous)", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const event = makeEvent({
        metadata: { organizationId: org.id },
        items: [
          { price: { id: "price_a", recurring: { usage_type: "licensed" } } },
          { price: { id: "price_b", recurring: { usage_type: "licensed" } } },
        ],
      });

      await service.processEvent(event);

      expect(await eventAlreadyRecorded(repos, event)).toBe(true);
      expect(await repos.organizationSubscriptions.findByOrganizationId(org.id)).toBeUndefined();
    });

    it("does not mutate when a licensed item is accompanied by more than one metered item", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const event = makeEvent({
        metadata: { organizationId: org.id },
        items: [
          { price: { id: "price_licensed_2500", recurring: { usage_type: "licensed" } } },
          { price: { id: "price_metered_1", recurring: { usage_type: "metered" } } },
          { price: { id: "price_metered_2", recurring: { usage_type: "metered" } } },
        ],
      });

      await service.processEvent(event);

      expect(await eventAlreadyRecorded(repos, event)).toBe(true);
      expect(await repos.organizationSubscriptions.findByOrganizationId(org.id)).toBeUndefined();
    });
  });

  describe("billing period extraction (currentPeriodStart/currentPeriodEnd from the licensed item)", () => {
    it("uses the licensed item's period values, never the metered item's", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const licensedStart = Math.floor(new Date("2030-01-01T00:00:00.000Z").getTime() / 1000);
      const licensedEnd = Math.floor(new Date("2030-02-01T00:00:00.000Z").getTime() / 1000);
      const meteredStart = Math.floor(new Date("2031-01-01T00:00:00.000Z").getTime() / 1000);
      const meteredEnd = Math.floor(new Date("2031-02-01T00:00:00.000Z").getTime() / 1000);

      const event = makeEvent({
        metadata: { organizationId: org.id },
        status: "active",
        items: [
          {
            price: { id: "price_metered_overage", recurring: { usage_type: "metered" } },
            current_period_start: meteredStart,
            current_period_end: meteredEnd,
          },
          {
            price: { id: "price_licensed_2500", recurring: { usage_type: "licensed" } },
            current_period_start: licensedStart,
            current_period_end: licensedEnd,
          },
        ],
      });

      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.currentPeriodStart).toEqual(new Date("2030-01-01T00:00:00.000Z"));
      expect(sub?.currentPeriodEnd).toEqual(new Date("2030-02-01T00:00:00.000Z"));
    });

    it("never persists the metered item's period values, even when they differ from the licensed item's", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const licensedStart = Math.floor(new Date("2032-05-01T00:00:00.000Z").getTime() / 1000);
      const licensedEnd = Math.floor(new Date("2032-06-01T00:00:00.000Z").getTime() / 1000);
      const meteredStart = Math.floor(new Date("2033-05-01T00:00:00.000Z").getTime() / 1000);
      const meteredEnd = Math.floor(new Date("2033-06-01T00:00:00.000Z").getTime() / 1000);

      const event = makeEvent({
        metadata: { organizationId: org.id },
        status: "active",
        items: [
          {
            price: { id: "price_licensed_2500", recurring: { usage_type: "licensed" } },
            current_period_start: licensedStart,
            current_period_end: licensedEnd,
          },
          {
            price: { id: "price_metered_overage", recurring: { usage_type: "metered" } },
            current_period_start: meteredStart,
            current_period_end: meteredEnd,
          },
        ],
      });

      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.currentPeriodStart).not.toEqual(new Date("2033-05-01T00:00:00.000Z"));
      expect(sub?.currentPeriodEnd).not.toEqual(new Date("2033-06-01T00:00:00.000Z"));
      expect(sub?.currentPeriodStart).toEqual(new Date("2032-05-01T00:00:00.000Z"));
      expect(sub?.currentPeriodEnd).toEqual(new Date("2032-06-01T00:00:00.000Z"));
    });

    it("stores the licensed item's valid period values as Dates for a first-ever subscription", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const periodStart = Math.floor(new Date("2030-03-01T00:00:00.000Z").getTime() / 1000);
      const periodEnd = Math.floor(new Date("2030-04-01T00:00:00.000Z").getTime() / 1000);

      const event = makeEvent({
        metadata: { organizationId: org.id },
        status: "active",
        items: [
          {
            price: { id: "price_123", recurring: { usage_type: "licensed" } },
            current_period_start: periodStart,
            current_period_end: periodEnd,
          },
        ],
      });

      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.currentPeriodStart).toEqual(new Date("2030-03-01T00:00:00.000Z"));
      expect(sub?.currentPeriodEnd).toEqual(new Date("2030-04-01T00:00:00.000Z"));
    });

    it("stores null for both period fields when the licensed item omits them entirely on first-ever creation", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const event = makeEvent({
        metadata: { organizationId: org.id },
        status: "active",
        items: [LICENSED_ITEM], // no current_period_start/current_period_end at all
      });

      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.currentPeriodStart).toBeNull();
      expect(sub?.currentPeriodEnd).toBeNull();
    });

    it.each<[string, unknown]>([
      ["a non-number string", "not-a-number"],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["a negative value", -1],
    ])(
      "stores null for both period fields when the licensed item's period values are %s, on first-ever creation",
      async (_label, invalidValue) => {
        const { service, repos } = buildService();
        const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
        const item = {
          price: { id: "price_123", recurring: { usage_type: "licensed" } },
          current_period_start: invalidValue,
          current_period_end: invalidValue,
        } as unknown as TestSubscriptionItem;

        const event = makeEvent({
          metadata: { organizationId: org.id },
          status: "active",
          items: [item],
        });

        await service.processEvent(event);

        const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
        expect(sub?.currentPeriodStart).toBeNull();
        expect(sub?.currentPeriodEnd).toBeNull();
      },
    );

    it("preserves an existing currentPeriodStart when the licensed item omits it, while still updating a supplied currentPeriodEnd", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      const existingStart = new Date("2030-01-01T00:00:00.000Z");
      const existingEnd = new Date("2030-02-01T00:00:00.000Z");
      await repos.organizationSubscriptions.upsert({
        organizationId: org.id,
        stripeSubscriptionId: subscriptionId,
        status: "incomplete",
        currentPeriodStart: existingStart,
        currentPeriodEnd: existingEnd,
      });

      const newEnd = Math.floor(new Date("2030-03-01T00:00:00.000Z").getTime() / 1000);
      const event = makeEvent({
        subscriptionId,
        status: "active",
        created: Math.floor(Date.now() / 1000) + 100,
        items: [
          {
            price: { id: "price_123", recurring: { usage_type: "licensed" } },
            // current_period_start intentionally omitted -- must not null
            // out the existing value.
            current_period_end: newEnd,
          },
        ],
      });
      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.currentPeriodStart).toEqual(existingStart);
      expect(sub?.currentPeriodEnd).toEqual(new Date("2030-03-01T00:00:00.000Z"));
    });

    it("preserves an existing currentPeriodEnd when the licensed item omits it, while still updating a supplied currentPeriodStart", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      const existingStart = new Date("2030-01-01T00:00:00.000Z");
      const existingEnd = new Date("2030-02-01T00:00:00.000Z");
      await repos.organizationSubscriptions.upsert({
        organizationId: org.id,
        stripeSubscriptionId: subscriptionId,
        status: "incomplete",
        currentPeriodStart: existingStart,
        currentPeriodEnd: existingEnd,
      });

      const newStart = Math.floor(new Date("2029-12-01T00:00:00.000Z").getTime() / 1000);
      const event = makeEvent({
        subscriptionId,
        status: "active",
        created: Math.floor(Date.now() / 1000) + 100,
        items: [
          {
            price: { id: "price_123", recurring: { usage_type: "licensed" } },
            current_period_start: newStart,
            // current_period_end intentionally omitted -- must not null
            // out the existing value.
          },
        ],
      });
      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.currentPeriodStart).toEqual(new Date("2029-12-01T00:00:00.000Z"));
      expect(sub?.currentPeriodEnd).toEqual(existingEnd);
    });

    it("updates both period fields when a newer event supplies valid values for an existing subscription", async () => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      await repos.organizationSubscriptions.upsert({
        organizationId: org.id,
        stripeSubscriptionId: subscriptionId,
        status: "incomplete",
        currentPeriodStart: new Date("2030-01-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2030-02-01T00:00:00.000Z"),
      });

      const newStart = Math.floor(new Date("2030-02-01T00:00:00.000Z").getTime() / 1000);
      const newEnd = Math.floor(new Date("2030-03-01T00:00:00.000Z").getTime() / 1000);
      const event = makeEvent({
        subscriptionId,
        status: "active",
        created: Math.floor(Date.now() / 1000) + 100,
        items: [
          {
            price: { id: "price_123", recurring: { usage_type: "licensed" } },
            current_period_start: newStart,
            current_period_end: newEnd,
          },
        ],
      });
      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.currentPeriodStart).toEqual(new Date("2030-02-01T00:00:00.000Z"));
      expect(sub?.currentPeriodEnd).toEqual(new Date("2030-03-01T00:00:00.000Z"));
    });
  });

  describe("unresolved organization", () => {
    it("records the event and returns without mutating any subscription state", async () => {
      const { service, repos } = buildService();
      // No existing association, no metadata at all.
      const event = makeEvent();

      await service.processEvent(event);

      expect(await eventAlreadyRecorded(repos, event)).toBe(true);
      expect(
        await repos.organizationSubscriptions.findByStripeSubscriptionId(event.data.object.id),
      ).toBeUndefined();
    });

    it("does not resolve via metadata when the referenced organization does not exist", async () => {
      const { service, repos } = buildService();
      const event = makeEvent({ metadata: { organizationId: randomUUID() } });

      await service.processEvent(event);

      expect(
        await repos.organizationSubscriptions.findByStripeSubscriptionId(event.data.object.id),
      ).toBeUndefined();
    });

    it("does not resolve via metadata when it is not a valid UUID", async () => {
      const { service, repos } = buildService();
      const event = makeEvent({ metadata: { organizationId: "not-a-uuid" } });

      await service.processEvent(event);

      expect(
        await repos.organizationSubscriptions.findByStripeSubscriptionId(event.data.object.id),
      ).toBeUndefined();
    });
  });

  describe("tenant isolation", () => {
    it("resolves via an existing Stripe customer association and never touches another organization", async () => {
      const { service, repos } = buildService();
      const orgA = await repos.organizations.create({ name: "A", slug: `a-${randomUUID()}` });
      const orgB = await repos.organizations.create({ name: "B", slug: `b-${randomUUID()}` });
      const customerId = `cus_${randomUUID()}`;
      await repos.organizationSubscriptions.upsert({
        organizationId: orgA.id,
        stripeCustomerId: customerId,
        status: "incomplete",
      });
      await repos.organizationSubscriptions.upsert({ organizationId: orgB.id, status: "incomplete" });

      const event = makeEvent({ customerId, status: "active" });
      await service.processEvent(event);

      expect((await repos.organizationSubscriptions.findByOrganizationId(orgA.id))?.status).toBe(
        "active",
      );
      expect((await repos.organizationSubscriptions.findByOrganizationId(orgB.id))?.status).toBe(
        "incomplete",
      );
    });

    it("resolves via an existing Stripe subscription association and never touches another organization", async () => {
      const { service, repos } = buildService();
      const orgA = await repos.organizations.create({ name: "A", slug: `a-${randomUUID()}` });
      const orgB = await repos.organizations.create({ name: "B", slug: `b-${randomUUID()}` });
      const subscriptionId = `sub_${randomUUID()}`;
      await repos.organizationSubscriptions.upsert({
        organizationId: orgA.id,
        stripeSubscriptionId: subscriptionId,
        status: "incomplete",
      });
      await repos.organizationSubscriptions.upsert({ organizationId: orgB.id, status: "incomplete" });

      const event = makeEvent({ subscriptionId, status: "active" });
      await service.processEvent(event);

      expect((await repos.organizationSubscriptions.findByOrganizationId(orgA.id))?.status).toBe(
        "active",
      );
      expect((await repos.organizationSubscriptions.findByOrganizationId(orgB.id))?.status).toBe(
        "incomplete",
      );
    });
  });

  describe("status mapping", () => {
    it.each<[string, OrganizationSubscriptionStatus]>([
      ["active", "active"],
      ["trialing", "active"],
      ["past_due", "past_due"],
      ["unpaid", "past_due"],
      ["canceled", "canceled"],
      ["incomplete", "incomplete"],
      ["incomplete_expired", "canceled"],
      ["paused", "paused"],
    ])("maps Stripe status %s to local status %s", async (stripeStatus, expected) => {
      const { service, repos } = buildService();
      const org = await repos.organizations.create({ name: "Acme", slug: `acme-${randomUUID()}` });
      const event = makeEvent({ status: stripeStatus, metadata: { organizationId: org.id } });

      await service.processEvent(event);

      const sub = await repos.organizationSubscriptions.findByOrganizationId(org.id);
      expect(sub?.status).toBe(expected);
    });
  });

  describe("parseStripeWebhookEventPayload", () => {
    it("throws MalformedStripeEventError for invalid JSON", () => {
      expect(() => parseStripeWebhookEventPayload("not json")).toThrow(MalformedStripeEventError);
    });

    it("throws MalformedStripeEventError for JSON missing the minimal Stripe event shape", () => {
      expect(() => parseStripeWebhookEventPayload(JSON.stringify({ hello: "world" }))).toThrow(
        MalformedStripeEventError,
      );
    });

    it("throws MalformedStripeEventError when data.object is missing required fields", () => {
      const body = JSON.stringify({
        id: "evt_1",
        type: "customer.subscription.updated",
        created: 1,
        data: { object: { id: "sub_1" } }, // missing customer/status
      });
      expect(() => parseStripeWebhookEventPayload(body)).toThrow(MalformedStripeEventError);
    });

    it("parses a minimally valid Stripe event without throwing", () => {
      const body = JSON.stringify({
        id: "evt_1",
        type: "customer.subscription.updated",
        created: 1,
        data: { object: { id: "sub_1", customer: "cus_1", status: "active" } },
      });
      expect(() => parseStripeWebhookEventPayload(body)).not.toThrow();
    });
  });
});
