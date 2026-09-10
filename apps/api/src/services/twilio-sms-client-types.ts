/**
 * Implementation-agnostic contract for the one Twilio Messages API
 * operation the M11 Step 4B worker needs. This file defines the interface
 * only -- no implementation lives here, mirroring
 * google-calendar-client-types.ts's exact split (interface here, real
 * fetch-based implementation in twilio-sms-client.ts, fake test double in
 * tests/support/).
 *
 * Security boundary: accountSid/authToken are captured once by the
 * factory function (twilio-sms-client.ts's createTwilioSmsClient), not
 * passed per-call -- unlike Google Calendar's per-organization access
 * token, Twilio's Account SID/Auth Token are a single, global,
 * app-level credential (no per-organization Twilio credential concept
 * exists anywhere in this codebase). Every method here is stateless with
 * respect to any *caller* state beyond that.
 *
 * Retry/error CLASSIFICATION (retryable vs terminal, per the approved
 * M11 Step 4B design) is deliberately NOT this client's job -- it only
 * ever reports what Twilio said (httpStatus, twilioErrorCode,
 * retryAfterMs) via TwilioSmsApiError; the worker is the sole place that
 * turns that into a retry/terminal decision, mirroring how
 * GoogleCalendarApiError stays a thin, opaque signal and AppointmentService
 * alone decides what a given failure means for a booking.
 */

export interface SendSmsInput {
  to: string;
  from: string;
  body: string;
  /** Absolute, publicly-reachable URL Twilio will POST delivery-status
   * updates to -- always built from API_PUBLIC_BASE_URL, never derived
   * from a request header. */
  statusCallbackUrl: string;
}

export interface SendSmsResult {
  /** Twilio's message SID (e.g. "SMxxxx...") -- persisted as
   * sms_notifications.providerMessageSid. */
  sid: string;
  /** Twilio's own initial lifecycle status for this send (typically
   * "queued" -- never "sent"/"delivered" synchronously). Persisted as
   * sms_notifications.providerStatus. */
  status: string;
}

/**
 * Thrown by sendSms() on any failure -- network error before any response
 * existed, a non-2xx response, or a malformed response body. Never
 * constructed with the account SID, auth token, destination phone, or
 * message body in its message -- callers must treat the message as a safe,
 * generic string, and use the structured fields below (never response
 * headers/bodies directly) for retry classification.
 */
export class TwilioSmsApiError extends Error {
  /** null when the failure happened before any HTTP response existed
   * (e.g. a network/DNS error). */
  readonly httpStatus: number | null;
  /** Twilio's own numeric error code from the response body's `code`
   * field, when present and parseable. */
  readonly twilioErrorCode: number | null;
  /** Parsed from a `Retry-After` response header (seconds or an HTTP
   * date), in milliseconds. null when absent or unparseable. */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    details: { httpStatus: number | null; twilioErrorCode: number | null; retryAfterMs: number | null },
  ) {
    super(message);
    this.httpStatus = details.httpStatus;
    this.twilioErrorCode = details.twilioErrorCode;
    this.retryAfterMs = details.retryAfterMs;
  }
}

export interface TwilioSmsClient {
  /** Sends one SMS via Twilio's Messages API. Throws TwilioSmsApiError on
   * any failure -- never returns a partial/error result. */
  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
}
