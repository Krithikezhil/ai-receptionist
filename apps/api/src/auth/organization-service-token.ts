import { createHash, randomBytes } from "node:crypto";

const ORGANIZATION_SERVICE_TOKEN_BYTES = 32;

/**
 * Per-organization secret that authorizes /internal/v1/organizations/:id/*
 * for exactly that organization — see
 * src/middleware/require-organization-service-token.ts. Same hashed-token
 * discipline as session tokens (src/auth/session.ts): only the SHA-256 hash
 * is ever persisted (organization_service_credentials.token_hash); the raw
 * value returned by generate...() is handed to the caller exactly once, at
 * organization-creation time, and never stored or logged anywhere.
 */
export function generateOrganizationServiceToken(): string {
  return randomBytes(ORGANIZATION_SERVICE_TOKEN_BYTES).toString("hex");
}

export function hashOrganizationServiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
