import express, { Router } from "express";
import { createTwilioSmsInboundController } from "../controllers/twilio-sms-inbound.controller.js";
import { createTwilioSmsStatusController } from "../controllers/twilio-sms-status.controller.js";
import type { OrganizationPhoneNumberRepository } from "../repositories/organization-phone-number-types.js";
import type { SmsNotificationRepository } from "../repositories/sms-notification-types.js";
import type { SmsOptOutRepository } from "../repositories/sms-opt-out-types.js";

/**
 * /twilio/* -- Twilio-originated webhooks, public (no Authorization
 * header, no session cookie -- Twilio cannot present either), gated
 * exclusively by X-Twilio-Signature verification inside each controller.
 * Mounted directly in app.ts (not composed through routes/index.ts's
 * createApiRouter, unlike /oauth) -- a deliberate scope decision for
 * M11 Step 4B; functionally equivalent, see app.ts's own mounting
 * comment for why.
 *
 * express.urlencoded() is mounted HERE, scoped to only this router's
 * routes -- Twilio's webhooks are form-encoded, unlike the rest of this
 * app (app.ts's global body parser is express.json() only). This does
 * NOT change body parsing for any other route.
 *
 * POST /twilio/sms-status (delivery-status) and POST /twilio/sms-inbound
 * (STOP/START/HELP keyword handling, M11 Step 4) are both wired here.
 * The inbound route never sends an application-generated reply -- see
 * controllers/twilio-sms-inbound.controller.ts's own doc comment.
 */
export function createTwilioSmsRouter(
  smsNotifications: SmsNotificationRepository,
  organizationPhoneNumbers: OrganizationPhoneNumberRepository,
  smsOptOuts: SmsOptOutRepository,
): Router {
  const router = Router();
  const statusController = createTwilioSmsStatusController(smsNotifications);
  const inboundController = createTwilioSmsInboundController(organizationPhoneNumbers, smsOptOuts);

  router.post(
    "/sms-status",
    express.urlencoded({ extended: false }),
    statusController.handleStatusCallback,
  );

  router.post(
    "/sms-inbound",
    express.urlencoded({ extended: false }),
    inboundController.handleInboundMessage,
  );

  return router;
}
