import express, { Router } from "express";
import { createStripeWebhookController } from "../controllers/stripe-webhook.controller.js";

/**
 * /stripe/webhook -- Stripe-originated webhook, public (no session
 * cookie, no Authorization header -- Stripe cannot present either),
 * gated exclusively by Stripe-Signature verification inside the
 * controller. Mounted directly in app.ts, BEFORE the global
 * express.json() (unlike /twilio, which is mounted after it) -- Stripe's
 * payload is application/json, so if the global JSON parser ran first it
 * would consume and re-serialize the body before this route ever saw it,
 * destroying the exact bytes signature verification needs. See app.ts's
 * own mounting comment.
 *
 * express.raw() is mounted HERE, scoped to only this router's route, so
 * req.body arrives as the untouched raw Buffer -- this does NOT change
 * body parsing for any other route.
 */
export function createStripeWebhookRouter(): Router {
  const router = Router();
  const controller = createStripeWebhookController();

  router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    controller.handleWebhook,
  );

  return router;
}
