import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Something is wrong with how the encryption key is configured (missing,
 * not valid base64, wrong length) -- never thrown for a specific stored
 * value, only for the key itself. Mirrors EmbeddingConfigurationError's
 * "setup problem, not a runtime failure" scope in embedding-provider.ts.
 */
export class GoogleTokenEncryptionKeyError extends Error {}

/**
 * A specific stored ciphertext failed to decrypt/authenticate -- tampered,
 * corrupt, truncated, or encrypted under a different key (e.g. after key
 * rotation, which is explicitly not supported in M10 -- see
 * calendar-connection.service.ts). Distinct from
 * GoogleTokenEncryptionKeyError the same way EmbeddingProviderError is
 * distinct from EmbeddingConfigurationError.
 */
export class GoogleTokenDecryptionError extends Error {}

/**
 * Reads and strictly validates GOOGLE_TOKEN_ENCRYPTION_KEY -- a
 * base64-encoded 32-byte AES-256 key. Fails closed: throws rather than
 * falling back to any default, matching
 * assertAuthSecret()/assertServiceAuthSecret()'s refuse-to-proceed-
 * insecurely discipline in config/env.ts. Called lazily, only when a
 * calendar-connect/encrypt/decrypt operation actually runs (see
 * calendar-connection.service.ts) -- not at global server startup,
 * matching TWILIO_CALL_CREDENTIAL_SECRET's optional-per-deployment
 * precedent, since Google Calendar integration is optional per deployment.
 *
 * Buffer.from(str, "base64") alone is NOT trusted to validate this: Node's
 * base64 decoder is permissive and silently drops invalid characters
 * rather than throwing, so malformed input could otherwise pass through
 * undetected. Validation here is strict and two-part: (1) a regex confirms
 * the string is well-formed base64 (correct alphabet, length, and padding
 * placement), and (2) the decoded bytes are re-encoded and compared back
 * to the original string, rejecting non-canonical encodings that (1) alone
 * would miss. Only a value that passes both checks is decoded and
 * accepted.
 */
export function loadGoogleTokenEncryptionKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new GoogleTokenEncryptionKeyError(
      "GOOGLE_TOKEN_ENCRYPTION_KEY is not set. Set a base64-encoded 32-byte key, e.g. via " +
        "`openssl rand -base64 32`. See .env.example.",
    );
  }

  if (!BASE64_PATTERN.test(raw)) {
    throw new GoogleTokenEncryptionKeyError("GOOGLE_TOKEN_ENCRYPTION_KEY is not valid base64.");
  }

  const key = Buffer.from(raw, "base64");
  if (key.toString("base64") !== raw) {
    throw new GoogleTokenEncryptionKeyError("GOOGLE_TOKEN_ENCRYPTION_KEY is not valid base64.");
  }

  if (key.length !== KEY_BYTES) {
    throw new GoogleTokenEncryptionKeyError(
      `GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}). ` +
        "Set a base64-encoded 32-byte key, e.g. via `openssl rand -base64 32`. See .env.example.",
    );
  }

  return key;
}

/**
 * Encrypts a Google refresh token for storage. A fresh random 12-byte IV
 * is generated for every call -- never reused or derived -- and the
 * 16-byte GCM authentication tag is appended after the ciphertext. The
 * stored value is exactly base64(IV || authTag || ciphertext), matching
 * the approved M10 format precisely. Only ever called from
 * calendar-connection.service.ts -- this function has no knowledge of
 * organizations, repositories, or Google's API.
 */
export function encryptRefreshToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypts a stored refresh token ciphertext. GCM's authentication tag is
 * verified automatically by decipher.final() -- any tampering, corruption,
 * or wrong-key mismatch throws GoogleTokenDecryptionError rather than
 * returning a wrong or partial plaintext. Only ever called from
 * calendar-connection.service.ts, which is responsible for catching this
 * and transitioning the connection to needs_reauthorization -- this
 * function itself never touches the database or any connection status.
 */
export function decryptRefreshToken(stored: string, key: Buffer): string {
  let combined: Buffer;
  try {
    combined = Buffer.from(stored, "base64");
  } catch {
    throw new GoogleTokenDecryptionError("Stored refresh token ciphertext is not valid base64.");
  }

  if (combined.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new GoogleTokenDecryptionError("Stored refresh token ciphertext is malformed (too short).");
  }

  const iv = combined.subarray(0, IV_BYTES);
  const authTag = combined.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = combined.subarray(IV_BYTES + AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    throw new GoogleTokenDecryptionError(
      "Refresh token ciphertext failed authentication (tampered, corrupt, or wrong key).",
    );
  }
}
