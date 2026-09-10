import {
  TwilioSmsApiError,
  type SendSmsInput,
  type SendSmsResult,
  type TwilioSmsClient,
} from "./twilio-sms-client-types.js";

const MESSAGES_URL_BASE = "https://api.twilio.com/2010-04-01/Accounts";

interface TwilioMessageResponse {
  sid: string;
  status: string;
}

function isTwilioMessageResponse(body: unknown): body is TwilioMessageResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as TwilioMessageResponse).sid === "string" &&
    (body as TwilioMessageResponse).sid.length > 0 &&
    typeof (body as TwilioMessageResponse).status === "string" &&
    (body as TwilioMessageResponse).status.length > 0
  );
}

interface TwilioErrorResponse {
  code: number;
}

function parseTwilioErrorCode(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as TwilioErrorResponse).code;
  return typeof code === "number" ? code : null;
}

/** Twilio's Retry-After header is either delta-seconds or an HTTP-date
 * (RFC 7231) -- both are handled; anything else parses to null rather
 * than being guessed at. */
function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

/**
 * Real production TwilioSmsClient -- native fetch only, no SDK, mirroring
 * google-calendar-client.ts's exact shape and the M7 Twilio
 * signature-verification precedent's own no-unnecessary-dependency
 * convention. Basic Auth (AccountSid:AuthToken) computed once at
 * construction time via Buffer (this codebase's established base64
 * primitive -- see google-token-crypto.ts, auth/oauth-state.ts,
 * auth/call-credential.ts), never per-call.
 */
export function createTwilioSmsClient(accountSid: string, authToken: string): TwilioSmsClient {
  const messagesUrl = `${MESSAGES_URL_BASE}/${encodeURIComponent(accountSid)}/Messages.json`;
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

  return {
    async sendSms({ to, from, body, statusCallbackUrl }: SendSmsInput): Promise<SendSmsResult> {
      let response: Response;
      try {
        response = await fetch(messagesUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: authHeader,
          },
          body: new URLSearchParams({
            To: to,
            From: from,
            Body: body,
            StatusCallback: statusCallbackUrl,
          }),
        });
      } catch {
        // Network/DNS/connection failure before any response existed --
        // the account SID, auth token, destination phone, and message
        // body are never included in this or any other branch below.
        throw new TwilioSmsApiError("Twilio SMS send request failed.", {
          httpStatus: null,
          twilioErrorCode: null,
          retryAfterMs: null,
        });
      }

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        throw new TwilioSmsApiError("Twilio SMS send response was not valid JSON.", {
          httpStatus: response.status,
          twilioErrorCode: null,
          retryAfterMs: parseRetryAfterMs(response),
        });
      }

      if (!response.ok) {
        throw new TwilioSmsApiError(`Twilio SMS send failed with status ${response.status}.`, {
          httpStatus: response.status,
          twilioErrorCode: parseTwilioErrorCode(responseBody),
          retryAfterMs: parseRetryAfterMs(response),
        });
      }

      if (!isTwilioMessageResponse(responseBody)) {
        throw new TwilioSmsApiError("Twilio SMS send response was malformed.", {
          httpStatus: response.status,
          twilioErrorCode: null,
          retryAfterMs: null,
        });
      }

      return { sid: responseBody.sid, status: responseBody.status };
    },
  };
}
