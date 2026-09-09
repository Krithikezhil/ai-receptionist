import type { Request, Response } from "express";
import { generateOAuthState, verifyOAuthState } from "../auth/oauth-state.js";
import type { CalendarConnectionService } from "../services/calendar-connection.service.js";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_SCOPES =
  "https://www.googleapis.com/auth/calendar.events " +
  "https://www.googleapis.com/auth/calendar.freebusy openid email";

function loadGoogleOAuthClientId(): string {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID is not set. See .env.example.");
  }
  return clientId;
}

function loadGoogleOAuthRedirectUri(): string {
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    throw new Error("GOOGLE_OAUTH_REDIRECT_URI is not set. See .env.example.");
  }
  return redirectUri;
}

/**
 * Identical response for every callback failure path -- state
 * invalid/expired/tampered, Google denial, a missing/malformed
 * code/state, or a failed token exchange are never distinguished to the
 * caller. No state, code, token, secret, id, or Google response detail
 * ever appears here or in any response header.
 */
function sendCallbackFailure(res: Response): void {
  res
    .status(400)
    .type("text/plain")
    .send("Google Calendar connection failed. Please try again from the dashboard.");
}

/**
 * M10 Step 5/6: /organizations/:organizationId/calendar (+ the fixed
 * /oauth/google/callback, mounted separately in routes/oauth.routes.ts) --
 * lets an organization owner connect/disconnect their Google Calendar.
 * GET is open to any member (matches every other read endpoint's
 * convention), connect/disconnect additionally require the owner role --
 * same pattern as phone-number.controller.ts's requireOwner.
 *
 * connect() only mints a signed, short-lived OAuth state (auth/oauth-state.ts)
 * and redirects to Google's consent screen -- it never touches a token or
 * authorization code. handleOAuthCallback() verifies that state, then
 * delegates the entire credential-bearing exchange to
 * CalendarConnectionService.completeOAuthConnection() -- the authorization
 * code, access token, and refresh token never appear in this file.
 *
 * Never returns a refresh token, ciphertext, encryption key, or any other
 * credential material -- only CalendarConnectionService.getStatus()'s own
 * safe {connected, googleAccountEmail?} shape is ever sent to the client.
 */
export function createCalendarConnectionController(
  calendarConnectionService: CalendarConnectionService,
) {
  function requireOwner(req: Request, res: Response): boolean {
    if (req.membership?.role !== "owner") {
      res
        .status(403)
        .json({ error: "Only an organization owner can manage the calendar connection." });
      return false;
    }
    return true;
  }

  return {
    async getStatus(req: Request, res: Response): Promise<void> {
      const status = await calendarConnectionService.getStatus(req.params.organizationId as string);
      res.status(200).json(status ?? { connected: false });
    },

    async connect(req: Request, res: Response): Promise<void> {
      if (!requireOwner(req, res)) return;

      const organizationId = req.params.organizationId as string;
      const state = generateOAuthState(organizationId, req.user!.id);

      const params = new URLSearchParams({
        response_type: "code",
        client_id: loadGoogleOAuthClientId(),
        redirect_uri: loadGoogleOAuthRedirectUri(),
        scope: GOOGLE_OAUTH_SCOPES,
        state,
        access_type: "offline",
        prompt: "consent",
      });
      res.redirect(`${GOOGLE_AUTHORIZATION_URL}?${params.toString()}`);
    },

    async disconnect(req: Request, res: Response): Promise<void> {
      if (!requireOwner(req, res)) return;
      await calendarConnectionService.disconnect(req.params.organizationId as string);
      res.status(204).send();
    },

    /**
     * GET /oauth/google/callback -- mounted with no auth/membership
     * middleware (see routes/oauth.routes.ts): there is no authenticated
     * dashboard session at this point in the flow. Organization context
     * comes exclusively from the verified signed state, never from any
     * request parameter. Fails closed, before any Google token/userinfo
     * request, on every invalid or malformed input.
     */
    async handleOAuthCallback(req: Request, res: Response): Promise<void> {
      const { code, state, error: googleError } = req.query;

      // Google reports denial (or any other problem) via `error`; Express
      // parses a repeated query key (e.g. ?error=a&error=b) as an array,
      // and this must also be rejected, not just a genuinely present
      // string value -- either way, stop before verifying state or
      // exchanging anything with Google.
      if (googleError !== undefined) {
        sendCallbackFailure(res);
        return;
      }

      // Express parses a repeated/array-style query param (e.g.
      // ?state[]=x) as an array or object, not a string -- explicitly
      // rejected here rather than coerced.
      if (typeof state !== "string" || state.length === 0) {
        sendCallbackFailure(res);
        return;
      }
      if (typeof code !== "string" || code.length === 0) {
        sendCallbackFailure(res);
        return;
      }

      const verified = verifyOAuthState(state);
      if (!verified.valid) {
        sendCallbackFailure(res);
        return;
      }

      // Only now -- after successful state verification -- is any Google
      // credential-bearing request permitted.
      const result = await calendarConnectionService.completeOAuthConnection(
        verified.organizationId,
        code,
        loadGoogleOAuthRedirectUri(),
      );

      if (result.status !== "ok") {
        sendCallbackFailure(res);
        return;
      }

      res
        .status(200)
        .type("text/plain")
        .send("Google Calendar connected. You can close this window.");
    },
  };
}
