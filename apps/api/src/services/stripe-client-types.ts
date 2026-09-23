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
}
