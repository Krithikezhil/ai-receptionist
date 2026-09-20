import { createHmac } from "node:crypto";
import { safeCompare } from "../middleware/require-service-auth.js";

const TOLERANCE_SECONDS = 300;

/**
 * Stripe webhook signature verification -- implements Stripe's own
 * documented Stripe-Signature header scheme directly with Node's stdlib
 * crypto rather than adding the Stripe SDK, matching this codebase's
 * established no-unnecessary-dependency convention (see
 * auth/twilio-webhook-signature.ts).
 *
 * Header format: `t=<unix seconds>,v1=<hex hmac>[,v1=<hex hmac>...]`
 * (Stripe sends multiple v1 values during secret rotation; any match is
 * accepted). Signed payload is exactly `${t}.${rawBody}`, HMAC-SHA256,
 * hex-encoded, compared via the existing safeCompare() primitive
 * (middleware/require-service-auth.ts) -- the same length-guarded
 * timing-safe comparison already used for the internal service-auth
 * boundary. Any mismatch (missing header, missing/malformed timestamp,
 * missing v1, stale timestamp, tampered body, wrong secret) returns
 * false -- there is no partial-success case, and nothing is ever logged
 * here (the caller decides what, if anything, to log).
 *
 * `nowMs` defaults to the real clock but can be overridden so tests can
 * exercise the tolerance window deterministically without waiting on
 * real time.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  if (!signatureHeader) return false;

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (!value) continue;
    if (key === "t") timestamp = value;
    else if (key === "v1") v1Signatures.push(value);
  }

  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  if (v1Signatures.length === 0) return false;

  const timestampSeconds = Number.parseInt(timestamp, 10);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  return v1Signatures.some((signature) => safeCompare(signature, expected));
}
