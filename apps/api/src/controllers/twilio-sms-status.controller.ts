import type { Request, Response } from "express";
import { verifyTwilioSignature } from "../auth/twilio-webhook-signature.js";
import type {
  SmsNotificationRepository,
  TwilioMessageStatus,
} from "../repositories/sms-notification-types.js";
import { logger } from "../config/logger.js";

const SMS_STATUS_WEBHOOK_PATH = "/twilio/sms-status";

const KNOWN_PROVIDER_STATUS_RANK = {
  queued: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  undelivered: 3,
  failed: 3,
} as const satisfies Record<string, number>;

type KnownProviderStatus = keyof typeof KNOWN_PROVIDER_STATUS_RANK;

function isKnownProviderStatus(status: string): status is KnownProviderStatus {
  return Object.hasOwn(KNOWN_PROVIDER_STATUS_RANK, status);
}

function isKnownTerminal(status: string): boolean {
  return isKnownProviderStatus(status) && KNOWN_PROVIDER_STATUS_RANK[status] === 3;
}

/**
 * Decides whether `incoming` should overwrite `current` -- the approved
 * M11 Step 4B provider-status state machine. Never regresses a known
 * terminal status (delivered/undelivered/failed); an equal-rank known
 * status is allowed (idempotent -- a duplicate/retried Twilio callback is
 * always safe to reapply). No `as` casts anywhere -- isKnownProviderStatus
 * is a real type-predicate narrowing function, not an assertion.
 *
 *   known incoming, current null            -> apply
 *   known incoming, current unknown         -> apply
 *   known incoming, current known           -> apply iff rank(incoming) >= rank(current)
 *   unknown incoming, current null          -> apply
 *   unknown incoming, current known non-terminal -> apply
 *   unknown incoming, current known terminal     -> reject
 *   unknown incoming, current unknown       -> apply
 */
export function shouldApplyProviderStatus(
  current: TwilioMessageStatus | null,
  incoming: TwilioMessageStatus,
): boolean {
  if (isKnownProviderStatus(incoming)) {
    if (current === null) return true;
    if (!isKnownProviderStatus(current)) return true;
    return KNOWN_PROVIDER_STATUS_RANK[incoming] >= KNOWN_PROVIDER_STATUS_RANK[current];
  }

  // incoming is an unrecognized/future value
  if (current === null) return true;
  if (isKnownProviderStatus(current) && isKnownTerminal(current)) return false;
  return true;
}

/**
 * Reads TWILIO_AUTH_TOKEN/API_PUBLIC_BASE_URL directly from process.env,
 * at this integration's own boundary -- matching the established
 * optional-per-deployment-integration convention (Google OAuth's five
 * vars, M7's TWILIO_AUTH_TOKEN/VOICE_AGENT_PUBLIC_BASE_URL) rather than
 * routing through the central env.ts object. Read fresh per request so
 * tests can freely stub process.env without needing a dedicated
 * dependency-injection seam -- mirrors oauth-flow.test.ts's own
 * process.env-stubbing convention for the analogous Google OAuth vars.
 */
function loadTwilioSmsWebhookConfig(): { authToken: string; publicBaseUrl: string } | undefined {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const publicBaseUrl = process.env.API_PUBLIC_BASE_URL;
  if (!authToken || !publicBaseUrl) return undefined;
  return { authToken, publicBaseUrl };
}

function canonicalSmsStatusWebhookUrl(publicBaseUrl: string): string {
  return publicBaseUrl.replace(/\/+$/, "") + SMS_STATUS_WEBHOOK_PATH;
}

/**
 * POST /twilio/sms-status -- Twilio's delivery-status callback. Public,
 * unauthenticated by API key (Twilio cannot present one); gated
 * exclusively by X-Twilio-Signature verification, checked BEFORE any
 * other work -- see the approved M11 Step 4B security ordering, mirroring
 * the M7 voice webhook's own strict order (routes/twilio.py).
 *
 * Never changes sms_notifications.status (the internal queue lifecycle)
 * -- only ever updates providerStatus. The row's current status is
 * always explicitly passed back unchanged to updateStatus(), since that
 * method performs a full overwrite of the fields given, not a partial
 * merge (see sms-notification-types.ts / drizzle/sms-notification.repository.ts).
 *
 * Logging: only ever {event, messageSid, providerStatus} -- messageSid is
 * treated as a safe opaque Twilio-assigned identifier (same trust tier as
 * an organization id or the M7 call_sid precedent), never the auth token,
 * the signature header, a phone number, or message body/content.
 */
export function createTwilioSmsStatusController(smsNotifications: SmsNotificationRepository) {
  return {
    async handleStatusCallback(req: Request, res: Response): Promise<void> {
      const config = loadTwilioSmsWebhookConfig();
      if (!config) {
        logger.error(
          { event: "twilio_sms_status_webhook" },
          "TWILIO_AUTH_TOKEN or API_PUBLIC_BASE_URL not configured, rejecting",
        );
        res.status(403).end();
        return;
      }

      const canonicalUrl = canonicalSmsStatusWebhookUrl(config.publicBaseUrl);
      const formParams: Record<string, string> = req.body ?? {};
      const signatureHeader = req.headers["x-twilio-signature"];
      const signature = typeof signatureHeader === "string" ? signatureHeader : "";

      if (!verifyTwilioSignature(canonicalUrl, formParams, signature, config.authToken)) {
        logger.warn({ event: "twilio_sms_status_webhook" }, "signature rejected");
        res.status(403).end();
        return;
      }

      // Only reached once the signature is verified -- MessageSid/
      // MessageStatus below are now trusted as genuinely from Twilio, not
      // attacker-suppliable on their own.
      const messageSid = formParams.MessageSid;
      const messageStatus = formParams.MessageStatus;
      if (!messageSid || !messageStatus) {
        logger.warn(
          { event: "twilio_sms_status_webhook" },
          "validly signed request missing MessageSid/MessageStatus",
        );
        res.status(400).end();
        return;
      }

      const existing = await smsNotifications.findByProviderMessageSid(messageSid);
      if (!existing) {
        logger.info(
          { event: "twilio_sms_status_webhook", messageSid },
          "no matching notification for this MessageSid",
        );
        res.status(200).end();
        return;
      }

      if (shouldApplyProviderStatus(existing.providerStatus, messageStatus)) {
        await smsNotifications.updateStatus(existing.id, existing.organizationId, {
          status: existing.status, // explicit pass-through -- never changed by this webhook
          providerStatus: messageStatus,
        });
        logger.info(
          { event: "twilio_sms_status_webhook", messageSid, providerStatus: messageStatus },
          "provider status updated",
        );
      } else {
        logger.info(
          { event: "twilio_sms_status_webhook", messageSid, providerStatus: messageStatus },
          "provider status update rejected (regression or terminal-protected)",
        );
      }

      res.status(200).end();
    },
  };
}
