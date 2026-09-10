import { createHmac } from "node:crypto";
import { safeCompare } from "../middleware/require-service-auth.js";

/**
 * Twilio webhook signature verification -- Node/TypeScript port of the
 * already-verified M7 algorithm
 * (services/voice-agent/src/voice_agent/twilio/signature.py), reusing
 * this codebase's own safeCompare primitive
 * (middleware/require-service-auth.ts) in place of Python's
 * hmac.compare_digest. Implements Twilio's own documented
 * request-validation algorithm directly with Node's stdlib crypto rather
 * than adding the official Twilio SDK -- matches this codebase's
 * established no-unnecessary-dependency convention (M7, M10).
 *
 * The caller is responsible for constructing the exact canonical URL
 * Twilio actually signed (an explicitly operator-configured public base
 * URL -- never derived from request headers such as Host/X-Forwarded-*
 * here or anywhere in this codebase). This function only implements the
 * generic verification algorithm given an already-decided URL string --
 * it has no opinion on where that URL comes from.
 *
 * Twilio's documented algorithm (form-encoded requests only -- every
 * Twilio webhook this codebase handles is form-encoded, never JSON):
 *   expected = base64(hmac_sha1(authToken, url + sorted_concatenated_form_key_value_pairs))
 * where sorted_concatenated_form_key_value_pairs is every form
 * parameter's key immediately followed by its value (no separator),
 * concatenated in ascending key order. Comparison is timing-safe. Any
 * mismatch (wrong url, tampered params, wrong authToken,
 * malformed/missing signature) returns false -- there is no
 * partial-success case.
 */
export function verifyTwilioSignature(
  url: string,
  formParams: Record<string, string>,
  signature: string,
  authToken: string,
): boolean {
  if (!signature) return false;

  const concatenated =
    url +
    Object.keys(formParams)
      .sort()
      .map((key) => `${key}${formParams[key]}`)
      .join("");

  const digest = createHmac("sha1", authToken).update(concatenated, "utf8").digest();
  const expected = digest.toString("base64");

  return safeCompare(signature, expected);
}
