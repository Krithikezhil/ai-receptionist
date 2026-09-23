import type {
  CreateCheckoutSessionParams,
  CreateStripeCustomerParams,
  StripeCheckoutSession,
  StripeClient,
  StripeCustomer,
} from "./stripe-client-types.js";
import { StripeApiError } from "./stripe-client-types.js";

const STRIPE_CUSTOMERS_URL = "https://api.stripe.com/v1/customers";
const STRIPE_CHECKOUT_SESSIONS_URL = "https://api.stripe.com/v1/checkout/sessions";

function isStripeCustomerResponse(body: unknown): body is StripeCustomer {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as StripeCustomer).id === "string" &&
    (body as StripeCustomer).id.length > 0
  );
}

function isStripeCheckoutSessionResponse(body: unknown): body is StripeCheckoutSession {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as StripeCheckoutSession).url === "string" &&
    (body as StripeCheckoutSession).url.length > 0
  );
}

/**
 * Real production StripeClient -- native fetch only, no SDK. Constructed
 * once at boot (see app.ts) with the raw STRIPE_SECRET_KEY value, which may
 * be undefined for a deployment that hasn't configured Stripe yet --
 * createCustomer() fails closed on that case itself, before ever calling
 * fetch, the same fail-closed-without-crashing-boot treatment
 * stripe-webhook.controller.ts's loadStripeWebhookSecret() already gives a
 * missing STRIPE_WEBHOOK_SECRET (this integration is optional per
 * deployment, matching Twilio/Google Calendar's existing precedent -- see
 * env.ts).
 *
 * Uses HTTP Basic auth (secret key as username, empty password) and
 * application/x-www-form-urlencoded encoding -- Stripe's own convention,
 * not Google's Bearer-token/JSON shape (google-calendar-client.ts is
 * architectural precedent only for the four-way error-handling split
 * below, never a template for auth/body format).
 */
export function createStripeClient(secretKey: string | undefined): StripeClient {
  return {
    async createCustomer(params: CreateStripeCustomerParams, idempotencyKey: string) {
      if (!secretKey) {
        // Never attempt an unauthenticated request -- fail closed before
        // fetch is ever called.
        throw new StripeApiError("Stripe is not configured.");
      }

      const body = new URLSearchParams();
      body.set("metadata[organizationId]", params.organizationId);

      let response: Response;
      try {
        response = await fetch(STRIPE_CUSTOMERS_URL, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": idempotencyKey,
          },
          body: body.toString(),
        });
      } catch {
        // Network/DNS/connection failure before any response existed --
        // the secret key is never included in this or any other branch
        // below.
        throw new StripeApiError("Stripe customer creation request failed.");
      }

      if (!response.ok) {
        throw new StripeApiError(
          `Stripe customer creation failed with status ${response.status}.`,
        );
      }

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        throw new StripeApiError("Stripe customer creation response was not valid JSON.");
      }

      if (!isStripeCustomerResponse(responseBody)) {
        throw new StripeApiError("Stripe customer creation response was malformed.");
      }

      return { id: responseBody.id };
    },

    async createCheckoutSession(params: CreateCheckoutSessionParams, idempotencyKey: string) {
      if (!secretKey) {
        throw new StripeApiError("Stripe is not configured.");
      }

      const body = new URLSearchParams();
      body.set("mode", "subscription");
      body.set("customer", params.customerId);
      body.set("success_url", params.successUrl);
      body.set("cancel_url", params.cancelUrl);
      body.set("line_items[0][price]", params.setupPriceId);
      body.set("line_items[0][quantity]", "1");
      body.set("line_items[1][price]", params.licensedPriceId);
      body.set("line_items[1][quantity]", "1");
      body.set("line_items[2][price]", params.meteredPriceId);
      // Deliberately no line_items[2][quantity] -- Stripe rejects an
      // explicit quantity on a metered Price's line item.

      let response: Response;
      try {
        response = await fetch(STRIPE_CHECKOUT_SESSIONS_URL, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": idempotencyKey,
          },
          body: body.toString(),
        });
      } catch {
        throw new StripeApiError("Stripe Checkout Session creation request failed.");
      }

      if (!response.ok) {
        throw new StripeApiError(
          `Stripe Checkout Session creation failed with status ${response.status}.`,
        );
      }

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        throw new StripeApiError("Stripe Checkout Session creation response was not valid JSON.");
      }

      if (!isStripeCheckoutSessionResponse(responseBody)) {
        throw new StripeApiError("Stripe Checkout Session creation response was malformed.");
      }

      return { url: responseBody.url };
    },
  };
}
