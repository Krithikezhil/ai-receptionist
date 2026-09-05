import { createHmac } from "node:crypto";
import { safeCompare } from "../middleware/require-service-auth.js";

/**
 * M7: a short-lived, cryptographically bound credential minted by apps/api
 * for exactly one inbound Twilio call, used in place of the long-lived M5
 * organization service token (organization-service-token.ts) for that one
 * call. apps/api is the only minter; voice-agent verifies it independently
 * before ever calling session.run_session() (see
 * services/voice-agent/src/voice_agent/twilio/call_credential.py), and
 * apps/api's own requireOrganizationAuth middleware re-verifies it again on
 * every internal-API call — see middleware/require-organization-auth.ts.
 *
 * Deliberately NOT a JWT: a two-part `payload.signature` token, one
 * hard-coded algorithm (HMAC-SHA256), no "alg" field for an attacker to
 * manipulate, no new dependency. See the approved M7 plan §6.
 *
 * Payload shape (JSON, snake_case — must match the Python verifier's
 * expectations byte-for-byte):
 *   { organization_id: string, call_sid: string, exp: number (unix secs) }
 */

/** 4 hours — see the approved M7 plan §3 for the full justification: real
 * calls are realistically minutes long, so this is never at risk of
 * expiring mid-call; call_sid binding (not the TTL) is the primary defense
 * against replay across unrelated calls. */
export const DEFAULT_CALL_CREDENTIAL_TTL_SECONDS = 4 * 60 * 60;

interface CallCredentialPayload {
  organization_id: string;
  call_sid: string;
  exp: number;
}

export type CallCredentialVerifyResult =
  | { valid: true; callSid: string }
  | {
      valid: false;
      reason: "malformed" | "signature" | "expired" | "org_mismatch" | "call_mismatch";
    };

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Mints a call credential bound to exactly one organization and one Twilio
 * call. Called exactly once per inbound call, from the Twilio voice
 * webhook handler, only after the webhook's signature has already been
 * validated (see the approved M7 plan §12's strict fail-closed order).
 */
export function generateCallCredential(
  organizationId: string,
  callSid: string,
  secret: string,
  ttlSeconds: number = DEFAULT_CALL_CREDENTIAL_TTL_SECONDS,
): string {
  const payload: CallCredentialPayload = {
    organization_id: organizationId,
    call_sid: callSid,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sigB64 = sign(payloadB64, secret);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifies a call credential against a known organization id (the caller —
 * requireOrganizationAuth — already knows which :organizationId the URL
 * names; this checks the credential actually authorizes that exact org).
 * `expectedCallSid`, when provided, additionally requires the credential's
 * own call_sid claim to match it — used where the real Twilio call_sid is
 * independently known (the WS entry point; apps/api's HTTP requests don't
 * carry one, so requireOrganizationAuth omits it).
 *
 * Any failure mode — malformed structure, bad signature, wrong org, wrong
 * call_sid, or expired — is reported as `{ valid: false, reason }`; the
 * reason is a fixed enum-like string safe to log, never the token or
 * payload contents themselves (see the approved M7 plan §6).
 */
export function verifyCallCredential(
  token: string,
  organizationId: string,
  secret: string,
  expectedCallSid?: string,
): CallCredentialVerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "malformed" };
  }
  const [payloadB64, sigB64] = parts as [string, string];

  const expectedSig = sign(payloadB64, secret);
  if (!safeCompare(sigB64, expectedSig)) {
    return { valid: false, reason: "signature" };
  }

  let payload: CallCredentialPayload;
  try {
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof (decoded as CallCredentialPayload).organization_id !== "string" ||
      typeof (decoded as CallCredentialPayload).call_sid !== "string" ||
      typeof (decoded as CallCredentialPayload).exp !== "number"
    ) {
      return { valid: false, reason: "malformed" };
    }
    payload = decoded as CallCredentialPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (payload.organization_id !== organizationId) {
    return { valid: false, reason: "org_mismatch" };
  }
  if (expectedCallSid !== undefined && payload.call_sid !== expectedCallSid) {
    return { valid: false, reason: "call_mismatch" };
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, callSid: payload.call_sid };
}
