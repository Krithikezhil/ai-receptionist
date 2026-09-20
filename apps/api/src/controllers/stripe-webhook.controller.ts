import type { Request, Response } from "express";
import { verifyStripeSignature } from "../auth/stripe-webhook-signature.js";

/**
 * Reads STRIPE_WEBHOOK_SECRET directly from process.env, at this
 * integration's own boundary -- matching the established
 * optional-per-deployment-integration convention already used for the
 * Twilio SMS webhook config (see
 * controllers/twilio-sms-status.controller.ts's loadTwilioSmsWebhookConfig).
 * Read fresh per request so tests can stub process.env without needing a
 * dedicated dependency-injection seam. No code-level default and no
 * random fallback -- an absent secret means verification can never
 * succeed, which is the fail-closed behavior this integration requires.
 */
function loadStripeWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET || undefined;
}

/**
 * POST /stripe/webhook -- signature-verification and raw-body boundary
 * only. This step deliberately does NOT parse the event, resolve an
 * organization, or touch any repository -- see the approved scope. A
 * validly signed request is acknowledged with a bare 200; every failure
 * mode (missing/malformed/invalid/stale signature, or a missing
 * STRIPE_WEBHOOK_SECRET) returns the same generic 400, never
 * distinguishing which check failed to an external caller -- matching
 * this codebase's existing Twilio webhook convention of not leaking
 * which specific check failed. Neither the signing secret nor the raw
 * body is ever logged.
 */
export function createStripeWebhookController() {
  return {
    async handleWebhook(req: Request, res: Response): Promise<void> {
      const secret = loadStripeWebhookSecret();
      if (!secret) {
        res.status(400).json({ error: "Stripe webhook is not configured." });
        return;
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
      const signatureHeader = req.headers["stripe-signature"];
      const signature = typeof signatureHeader === "string" ? signatureHeader : undefined;

      if (!verifyStripeSignature(rawBody, signature, secret)) {
        res.status(400).json({ error: "Invalid Stripe webhook signature." });
        return;
      }

      res.status(200).json({ received: true });
    },
  };
}
