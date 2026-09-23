/**
 * Thrown for any Stripe API call failure -- missing configuration,
 * network/connection failure, non-2xx HTTP status, invalid JSON, or a
 * validated-but-malformed response shape. Mirrors GoogleCalendarApiError's
 * single-error-type-per-integration convention (see
 * google-calendar-client-types.ts) -- callers distinguish failure causes
 * only via the message, never a discriminated error subtype, consistent
 * with every other native-fetch client in this codebase. The message never
 * includes the secret key, the Authorization header, or the full Stripe
 * response body.
 */
export class StripeApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeApiError";
  }
}

/**
 * The only Stripe Customer field this codebase ever trusts or persists --
 * see organization-subscription.service.ts's ensureStripeCustomer(). Every
 * other field Stripe's API returns (email, name, balance, metadata, etc.)
 * is deliberately never read.
 */
export interface StripeCustomer {
  id: string;
}

export interface CreateStripeCustomerParams {
  organizationId: string;
}

/**
 * The only Checkout Session field this codebase ever trusts or returns --
 * see organization-subscription.service.ts's createCheckoutSession(). The
 * Checkout Session id, its payment/subscription details, and every other
 * field Stripe's API returns are deliberately never read or persisted (the
 * approved Step 6 design keeps no local Checkout Session record at all).
 */
export interface StripeCheckoutSession {
  url: string;
}

export interface CreateCheckoutSessionParams {
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  setupPriceId: string;
  licensedPriceId: string;
  meteredPriceId: string;
}

export interface StripeClient {
  /**
   * POST /v1/customers, tagged with organization metadata. `idempotencyKey`
   * is computed by the caller (see organization-subscription.service.ts) --
   * this client has no business knowledge of what makes two calls "the
   * same logical operation".
   */
  createCustomer(
    params: CreateStripeCustomerParams,
    idempotencyKey: string,
  ): Promise<StripeCustomer>;

  /**
   * POST /v1/checkout/sessions, mode=subscription, three line items (setup
   * one-time + licensed recurring, both quantity 1; metered overage with
   * no quantity field at all -- Stripe rejects an explicit quantity on a
   * metered Price's line item). `idempotencyKey` is computed fresh by the
   * caller for each individual checkout attempt (see
   * organization-subscription.service.ts) -- unlike createCustomer's
   * stable per-organization key, a Checkout Session is a new short-lived
   * attempt each time, not a durable per-organization resource.
   */
  createCheckoutSession(
    params: CreateCheckoutSessionParams,
    idempotencyKey: string,
  ): Promise<StripeCheckoutSession>;
}
