import type { Request, Response } from "express";
import { verifyTwilioSignature } from "../auth/twilio-webhook-signature.js";
import { logger } from "../config/logger.js";
import type { OrganizationPhoneNumberRepository } from "../repositories/organization-phone-number-types.js";
import type { SmsOptOutRepository } from "../repositories/sms-opt-out-types.js";
import { normalizeE164 } from "../services/phone-normalization.js";
import { classifyInboundSmsBody } from "../services/sms-keyword-classifier.js";

const SMS_INBOUND_WEBHOOK_PATH = "/twilio/sms-inbound";

/**
 * Reads TWILIO_AUTH_TOKEN/API_PUBLIC_BASE_URL directly from process.env,
 * at this integration's own boundary -- mirrors
 * twilio-sms-status.controller.ts's own loadTwilioSmsWebhookConfig()
 * exactly (duplicated, not imported/exported, since that function is
 * private to that file and modifying that controller is outside this
 * step's approved scope -- same reasoning already documented in
 * worker.ts for its own copy of the sibling path constant).
 */
function loadTwilioSmsWebhookConfig(): { authToken: string; publicBaseUrl: string } | undefined {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const publicBaseUrl = process.env.API_PUBLIC_BASE_URL;
  if (!authToken || !publicBaseUrl) return undefined;
  return { authToken, publicBaseUrl };
}

function canonicalSmsInboundWebhookUrl(publicBaseUrl: string): string {
  return publicBaseUrl.replace(/\/+$/, "") + SMS_INBOUND_WEBHOOK_PATH;
}

const EMPTY_TWIML_RESPONSE = "<Response></Response>";

/**
 * POST /twilio/sms-inbound -- Twilio's inbound-SMS webhook (STOP/START/
 * HELP keyword handling). Public, unauthenticated by API key (Twilio
 * cannot present one); gated exclusively by X-Twilio-Signature
 * verification, checked BEFORE any other work -- same strict ordering as
 * the delivery-status webhook (twilio-sms-status.controller.ts).
 *
 * Deliberately does NOT send any application-generated reply -- no TwiML
 * <Message>, no outbound Twilio API call (this controller is never given
 * a reference to a TwilioSmsClient at all), no enqueued sms_notifications
 * row. Per the approved architecture (backed by Twilio's own documented
 * guidance -- Twilio already sends its own STOP/START/HELP confirmation),
 * a second, application-generated reply would risk a duplicate message to
 * the customer. Always responds with an empty TwiML <Response/> -- valid,
 * minimal, and generates no outbound message of any kind.
 *
 * Tenant resolution is exclusively via the inbound `To` number through
 * the existing organizationPhoneNumbers.findByPhoneNumber lookup -- never
 * from any value in the request body itself. An unresolved `To`, or a
 * `From` that fails E.164 normalization, results in no state change at
 * all (fail-closed: never guesses a tenant, never persists an
 * unnormalized phone number).
 *
 * Deliberately does NOT read or depend on Twilio's MessagingServiceSid/
 * OptOutType fields: confirmed (per the approved Twilio research) that
 * OptOutType is gated behind Advanced Opt-Out, a Messaging-Service-scoped
 * feature this application does not use (the worker sends directly via
 * `From`, never a Messaging Service SID). classifyInboundSmsBody's
 * exact-match parsing of Body is the sole, authoritative mechanism,
 * correct whether or not those fields happen to also be present.
 *
 * Idempotency: no separate MessageSid-deduplication mechanism is
 * introduced. smsOptOuts.optOut()/optIn() are already fully idempotent
 * (see sms-opt-out-types.ts) -- a duplicate Twilio webhook retry for the
 * same MessageSid simply re-applies the same already-idempotent
 * operation, which is itself the "appropriate mechanism" already in
 * place.
 *
 * Logging: only ever {event, messageSid, organizationId, classification}
 * -- never the phone number or message body.
 */
export function createTwilioSmsInboundController(
  organizationPhoneNumbers: OrganizationPhoneNumberRepository,
  smsOptOuts: SmsOptOutRepository,
) {
  return {
    async handleInboundMessage(req: Request, res: Response): Promise<void> {
      const config = loadTwilioSmsWebhookConfig();
      if (!config) {
        logger.error(
          { event: "twilio_sms_inbound_webhook" },
          "TWILIO_AUTH_TOKEN or API_PUBLIC_BASE_URL not configured, rejecting",
        );
        res.status(403).end();
        return;
      }

      const canonicalUrl = canonicalSmsInboundWebhookUrl(config.publicBaseUrl);
      const formParams: Record<string, string> = req.body ?? {};
      const signatureHeader = req.headers["x-twilio-signature"];
      const signature = typeof signatureHeader === "string" ? signatureHeader : "";

      if (!verifyTwilioSignature(canonicalUrl, formParams, signature, config.authToken)) {
        logger.warn({ event: "twilio_sms_inbound_webhook" }, "signature rejected");
        res.status(403).end();
        return;
      }

      // Only reached once the signature is verified -- From/To/Body/
      // MessageSid below are now trusted as genuinely from Twilio, not
      // attacker-suppliable on their own.
      const from = formParams.From;
      const to = formParams.To;
      const body = formParams.Body;
      const messageSid = formParams.MessageSid;
      if (!from || !to || body === undefined || !messageSid) {
        logger.warn(
          { event: "twilio_sms_inbound_webhook" },
          "validly signed request missing From/To/Body/MessageSid",
        );
        res.status(400).end();
        return;
      }

      const organization = await organizationPhoneNumbers.findByPhoneNumber(to);
      if (!organization) {
        // Never guesses a tenant -- no state change. A safe generic 200
        // so Twilio doesn't retry a request this application can never
        // resolve.
        logger.info(
          { event: "twilio_sms_inbound_webhook", messageSid },
          "no organization for this To number",
        );
        res.type("text/xml").status(200).send(EMPTY_TWIML_RESPONSE);
        return;
      }

      const normalizedFrom = normalizeE164(from);
      if (!normalizedFrom) {
        // Fail-closed: never guesses or silently transforms an
        // ambiguous/malformed sender number -- no state change.
        logger.warn(
          {
            event: "twilio_sms_inbound_webhook",
            messageSid,
            organizationId: organization.organizationId,
          },
          "From number failed E.164 normalization",
        );
        res.type("text/xml").status(200).send(EMPTY_TWIML_RESPONSE);
        return;
      }

      const classification = classifyInboundSmsBody(body);
      if (classification === "opt_out") {
        await smsOptOuts.optOut(organization.organizationId, normalizedFrom);
      } else if (classification === "opt_in") {
        await smsOptOuts.optIn(organization.organizationId, normalizedFrom);
      }
      // "help" and "unknown" -- no state change, per the approved design.

      logger.info(
        {
          event: "twilio_sms_inbound_webhook",
          messageSid,
          organizationId: organization.organizationId,
          classification,
        },
        "inbound sms processed",
      );

      // Empty TwiML response -- valid, minimal, generates no outbound
      // message. Twilio's own STOP/START/HELP confirmation (if any) is
      // handled entirely on Twilio's own side, independent of this
      // response.
      res.type("text/xml").status(200).send(EMPTY_TWIML_RESPONSE);
    },
  };
}
