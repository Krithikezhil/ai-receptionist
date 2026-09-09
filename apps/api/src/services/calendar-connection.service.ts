import type {
  NewOrganizationCalendarConnection,
  OrganizationCalendarConnectionRepository,
} from "../repositories/calendar-connection-types.js";
import {
  GoogleTokenDecryptionError,
  decryptRefreshToken,
  encryptRefreshToken,
  loadGoogleTokenEncryptionKey,
} from "./google-token-crypto.js";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/**
 * GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not configured
 * anywhere in this deployment -- a setup problem, never thrown for a
 * specific organization's connection. Mirrors GoogleTokenEncryptionKeyError
 * / EmbeddingConfigurationError's "something is wrong with how this was
 * set up" scope exactly.
 */
export class GoogleOAuthConfigurationError extends Error {}

/**
 * A repository operation needed to safely report a state transition (e.g.
 * marking a connection needs_reauthorization) itself failed or found
 * nothing to update. Thrown rather than silently returning a result that
 * would falsely claim the transition succeeded. Message is always generic
 * -- never repository error detail or credential material.
 */
export class CalendarConnectionOperationError extends Error {}

export type GetAccessTokenResult =
  | { status: "ok"; accessToken: string; expiresAt: Date }
  | { status: "not_connected" }
  | { status: "needs_reauthorization" }
  | { status: "error" };

/**
 * Owns the Google Calendar refresh-token lifecycle end to end: exchanges
 * an OAuth authorization code for tokens, encrypts and stores the refresh
 * token, and decrypts and exchanges it for a short-lived access token on
 * demand. The ONLY production module permitted to do any of this (see
 * SECURITY.md, once M10's section is written). There is deliberately no
 * public method that returns the decrypted refresh token, the ciphertext,
 * or the encryption key -- getAccessToken() is the sole way anything else
 * in this codebase can act on behalf of a connected calendar, and it
 * returns only a short-lived access token plus its expiry, never
 * persisted, never returned a second time.
 */
export interface CalendarConnectionService {
  getStatus(
    organizationId: string,
  ): Promise<{ connected: boolean; googleAccountEmail?: string } | undefined>;

  /**
   * Owns the ENTIRE credential-bearing OAuth authorization-code flow:
   * exchanges the code for Google tokens, extracts the refresh token,
   * uses the access token to look up the connected account's email,
   * encrypts the refresh token, and upserts the connection -- all
   * internally. The plaintext refresh token, the access token, and the
   * authorization code never leave this function; the caller receives
   * only a bare {status}.
   */
  completeOAuthConnection(
    organizationId: string,
    authorizationCode: string,
    redirectUri: string,
  ): Promise<{ status: "ok" } | { status: "error" }>;

  /**
   * Decrypts the stored refresh token internally and exchanges it for a
   * short-lived Google access token via Google's OAuth token endpoint.
   * The refresh token itself never leaves this function. See
   * GetAccessTokenResult for the exact outcome mapping.
   */
  getAccessToken(organizationId: string): Promise<GetAccessTokenResult>;

  markNeedsReauthorization(organizationId: string): Promise<void>;

  disconnect(organizationId: string): Promise<boolean>;
}

function loadGoogleOAuthClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleOAuthConfigurationError(
      "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must both be set to exchange a Google " +
        "refresh token. See .env.example.",
    );
  }
  return { clientId, clientSecret };
}

interface GoogleTokenEndpointSuccess {
  access_token: string;
  expires_in: number;
}

interface GoogleTokenEndpointError {
  error: string;
}

function isGoogleTokenEndpointSuccess(body: unknown): body is GoogleTokenEndpointSuccess {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as GoogleTokenEndpointSuccess;
  return (
    typeof candidate.access_token === "string" &&
    typeof candidate.expires_in === "number" &&
    Number.isFinite(candidate.expires_in) &&
    candidate.expires_in > 0
  );
}

function isGoogleTokenEndpointError(body: unknown): body is GoogleTokenEndpointError {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as GoogleTokenEndpointError).error === "string"
  );
}

interface GoogleAuthorizationCodeExchangeSuccess {
  access_token: string;
  refresh_token: string;
}

function isGoogleAuthorizationCodeExchangeSuccess(
  body: unknown,
): body is GoogleAuthorizationCodeExchangeSuccess {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as GoogleAuthorizationCodeExchangeSuccess;
  return (
    typeof candidate.access_token === "string" &&
    candidate.access_token.length > 0 &&
    typeof candidate.refresh_token === "string" &&
    candidate.refresh_token.length > 0
  );
}

interface GoogleUserinfoResponse {
  email: string;
  email_verified?: boolean;
}

function isGoogleUserinfoResponse(body: unknown): body is GoogleUserinfoResponse {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as GoogleUserinfoResponse;
  return (
    typeof candidate.email === "string" &&
    candidate.email.length > 0 &&
    candidate.email_verified === true
  );
}

/**
 * Marks a connection needs_reauthorization, or throws
 * CalendarConnectionOperationError if that update itself did not
 * demonstrably succeed (repository error, or no row found to update) --
 * callers must never proceed to report needs_reauthorization to their own
 * caller unless this resolves without throwing.
 */
async function markNeedsReauthorizationOrThrow(
  repo: OrganizationCalendarConnectionRepository,
  organizationId: string,
): Promise<void> {
  let updated: Awaited<ReturnType<OrganizationCalendarConnectionRepository["updateStatus"]>>;
  try {
    updated = await repo.updateStatus(organizationId, { status: "needs_reauthorization" });
  } catch {
    throw new CalendarConnectionOperationError(
      "Failed to update the calendar connection status for this organization.",
    );
  }
  if (!updated) {
    throw new CalendarConnectionOperationError(
      "Failed to update the calendar connection status for this organization.",
    );
  }
}

/**
 * Encrypts refreshToken immediately and upserts the connection. Private --
 * the only caller is completeOAuthConnection, within this same module.
 * The plaintext argument is never persisted, logged, or retained beyond
 * this function's own stack frame.
 */
async function persistEncryptedConnection(
  repo: OrganizationCalendarConnectionRepository,
  organizationId: string,
  googleAccountEmail: string,
  refreshToken: string,
): Promise<void> {
  const key = loadGoogleTokenEncryptionKey();
  const refreshTokenCiphertext = encryptRefreshToken(refreshToken, key);
  const newConnection: NewOrganizationCalendarConnection = {
    organizationId,
    googleAccountEmail,
    refreshTokenCiphertext,
    status: "connected",
  };
  await repo.upsert(newConnection);
}

export function createCalendarConnectionService(
  repo: OrganizationCalendarConnectionRepository,
): CalendarConnectionService {
  return {
    async getStatus(organizationId) {
      const connection = await repo.findByOrganizationId(organizationId);
      if (!connection) return undefined;
      return {
        connected: connection.status === "connected",
        googleAccountEmail: connection.googleAccountEmail,
      };
    },

    async completeOAuthConnection(organizationId, authorizationCode, redirectUri) {
      const { clientId, clientSecret } = loadGoogleOAuthClientCredentials();

      let response: Response;
      try {
        response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: authorizationCode,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });
      } catch {
        return { status: "error" };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { status: "error" };
      }

      if (!response.ok || !isGoogleAuthorizationCodeExchangeSuccess(body)) {
        // Includes invalid_grant and every other Google-reported failure.
        // Unlike getAccessToken's refresh-grant flow, there is no
        // existing successful connection to protect here -- this never
        // transitions any connection to needs_reauthorization, it simply
        // reports that establishing the connection failed.
        return { status: "error" };
      }

      const { access_token: accessToken, refresh_token: refreshToken } = body;

      let userinfoResponse: Response;
      try {
        userinfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        return { status: "error" };
      }

      let userinfoBody: unknown;
      try {
        userinfoBody = await userinfoResponse.json();
      } catch {
        return { status: "error" };
      }

      if (!userinfoResponse.ok || !isGoogleUserinfoResponse(userinfoBody)) {
        return { status: "error" };
      }

      await persistEncryptedConnection(repo, organizationId, userinfoBody.email, refreshToken);

      return { status: "ok" };
    },

    async getAccessToken(organizationId) {
      const connection = await repo.findByOrganizationId(organizationId);
      if (!connection) return { status: "not_connected" };
      if (connection.status === "needs_reauthorization") {
        return { status: "needs_reauthorization" };
      }

      const key = loadGoogleTokenEncryptionKey();

      let refreshToken: string;
      try {
        refreshToken = decryptRefreshToken(connection.refreshTokenCiphertext, key);
      } catch (err) {
        if (err instanceof GoogleTokenDecryptionError) {
          await markNeedsReauthorizationOrThrow(repo, organizationId);
          return { status: "needs_reauthorization" };
        }
        throw err;
      }

      const { clientId, clientSecret } = loadGoogleOAuthClientCredentials();

      let response: Response;
      try {
        response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
        });
      } catch {
        // Network/DNS/connection failure before any response existed --
        // refreshToken/clientSecret are never included in this or any
        // other branch below.
        return { status: "error" };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { status: "error" };
      }

      if (!response.ok) {
        if (isGoogleTokenEndpointError(body) && body.error === "invalid_grant") {
          await markNeedsReauthorizationOrThrow(repo, organizationId);
          return { status: "needs_reauthorization" };
        }
        return { status: "error" };
      }

      if (!isGoogleTokenEndpointSuccess(body)) {
        return { status: "error" };
      }

      return {
        status: "ok",
        accessToken: body.access_token,
        expiresAt: new Date(Date.now() + body.expires_in * 1000),
      };
    },

    async markNeedsReauthorization(organizationId) {
      await repo.updateStatus(organizationId, { status: "needs_reauthorization" });
    },

    async disconnect(organizationId) {
      return repo.deleteByOrganizationId(organizationId);
    },
  };
}
