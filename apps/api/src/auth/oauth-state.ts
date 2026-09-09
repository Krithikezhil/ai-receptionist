import { createHmac, randomBytes } from "node:crypto";
import { safeCompare } from "../middleware/require-service-auth.js";

/**
 * GOOGLE_OAUTH_STATE_SECRET is not configured -- a setup problem, never
 * thrown for a specific OAuth attempt. Mirrors GoogleOAuthConfigurationError
 * / GoogleTokenEncryptionKeyError's "something is wrong with how this was
 * set up" scope exactly.
 */
export class OAuthStateConfigurationError extends Error {}

/** 10 minutes -- generous for a real Google consent screen, short enough
 * that a leaked/replayed state has minimal value. See generateOAuthState's
 * own note below on what "short-lived" does and does not guarantee. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

interface OAuthStatePayload {
  organizationId: string;
  userId: string;
  nonce: string;
  exp: number;
}

/**
 * `reason` is for safe internal use only (e.g. a future log line using a
 * fixed enum-like string, matching call-credential.ts's existing
 * precedent) -- it must never be placed in an HTTP response body.
 */
export type OAuthStateVerifyResult =
  | { valid: true; organizationId: string; userId: string }
  | { valid: false; reason: "malformed" | "signature" | "expired" };

function loadGoogleOAuthStateSecret(): string {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET;
  if (!secret || secret.length < 32) {
    throw new OAuthStateConfigurationError(
      "GOOGLE_OAUTH_STATE_SECRET is not set (or is too short). Set a random secret of at least 32 " +
        "characters, e.g. via `openssl rand -hex 32`. See .env.example.",
    );
  }
  return secret;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Mints a signed, short-lived OAuth state token binding exactly one
 * organization and one authenticated dashboard user to one OAuth attempt.
 * Called only from the calendar-connection controller's connect() handler,
 * after auth/membership/owner checks have already passed --
 * organizationId/userId here are already trusted, verified values, not
 * caller input to be re-validated.
 *
 * The 16-byte nonce is cryptographically random and is included in the
 * signed payload so that two states minted for the same
 * organization/user are never identical and so that an attacker without
 * the secret cannot predict or construct a valid state. It is NOT a
 * server-side one-time-use token: this module keeps no database, cache,
 * session store, or other persistence layer tracking which nonces have
 * been consumed. A state is therefore only bounded by its short TTL, not
 * by single-use enforcement -- if intercepted, it could in principle be
 * replayed until it expires. This is an explicit, disclosed limitation
 * for M10, not a claim of server-side replay prevention.
 */
export function generateOAuthState(organizationId: string, userId: string): string {
  const secret = loadGoogleOAuthStateSecret();
  const payload: OAuthStatePayload = {
    organizationId,
    userId,
    nonce: randomBytes(16).toString("base64url"),
    exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verifies a state token from the OAuth callback. Any failure --
 * malformed structure, bad signature, expired, or missing/empty/
 * wrong-typed claims -- is reported as one of a small, safe,
 * non-credential-bearing reason strings (see OAuthStateVerifyResult),
 * never the token or payload contents. organizationId/userId are
 * trustworthy ONLY when valid:true.
 */
export function verifyOAuthState(token: string): OAuthStateVerifyResult {
  const secret = loadGoogleOAuthStateSecret();
  const parts = token.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed" };
  const [payloadB64, sigB64] = parts as [string, string];

  if (!safeCompare(sigB64, sign(payloadB64, secret))) {
    return { valid: false, reason: "signature" };
  }

  let payload: OAuthStatePayload;
  try {
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as unknown;
    const candidate = decoded as Partial<OAuthStatePayload> | null;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.organizationId !== "string" ||
      candidate.organizationId.length === 0 ||
      typeof candidate.userId !== "string" ||
      candidate.userId.length === 0 ||
      typeof candidate.nonce !== "string" ||
      candidate.nonce.length === 0 ||
      typeof candidate.exp !== "number" ||
      !Number.isFinite(candidate.exp) ||
      !Number.isInteger(candidate.exp)
    ) {
      return { valid: false, reason: "malformed" };
    }
    payload = candidate as OAuthStatePayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, organizationId: payload.organizationId, userId: payload.userId };
}
