import type {
  CreateStripeCustomerParams,
  StripeClient,
  StripeCustomer,
} from "../../src/services/stripe-client-types.js";
import { StripeApiError } from "../../src/services/stripe-client-types.js";

/** One recorded call, in order. */
export interface FakeStripeClientCall {
  params: CreateStripeCustomerParams;
  idempotencyKey: string;
}

/**
 * Test-only double for StripeClient. Mirrors
 * fake-google-calendar-client.ts's exact shape: mutable public fields a
 * test can set before or between calls to deterministically control every
 * outcome, and a `calls` array recording every invocation in order. Never
 * imported by production code -- there is no live Stripe network access in
 * this repository's tests.
 */
export interface FakeStripeClient extends StripeClient {
  calls: FakeStripeClientCall[];

  /** When true, createCustomer throws StripeApiError instead of
   * succeeding. */
  failCreateCustomer: boolean;

  /** The customer id createCustomer returns on success. Defaults to a
   * deterministic, incrementing id ("fake-cus-1", "fake-cus-2", ...) so
   * multiple creations in one test are distinguishable without the test
   * supplying its own id. Once set, stays fixed for every subsequent
   * successful call until changed again (not a one-shot value). */
  nextCustomerId: string | undefined;
}

export function createFakeStripeClient(): FakeStripeClient {
  let customerCounter = 0;

  const fake: FakeStripeClient = {
    calls: [],
    failCreateCustomer: false,
    nextCustomerId: undefined,

    async createCustomer(params: CreateStripeCustomerParams, idempotencyKey: string) {
      fake.calls.push({ params, idempotencyKey });
      if (fake.failCreateCustomer) {
        throw new StripeApiError("Fake Stripe: createCustomer configured to fail.");
      }
      customerCounter += 1;
      const id = fake.nextCustomerId ?? `fake-cus-${customerCounter}`;
      const customer: StripeCustomer = { id };
      return customer;
    },
  };

  return fake;
}
