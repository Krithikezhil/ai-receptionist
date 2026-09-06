import "dotenv/config";

type NodeEnv = "development" | "test" | "production";

function readNodeEnv(): NodeEnv {
  const value = process.env.NODE_ENV;
  if (value === "test" || value === "production") return value;
  return "development";
}

/**
 * Central place for environment configuration. Nothing in this module
 * should ever be logged in full — see SECURITY.md.
 */
export const env = {
  nodeEnv: readNodeEnv(),
  port: Number.parseInt(process.env.API_PORT ?? "4000", 10),
  logLevel: process.env.LOG_LEVEL ?? "info",
  corsOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",

  // Not a secret itself (matches the docker-compose.yml local-dev default);
  // production deployments must override this with real credentials.
  databaseUrl:
    process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ai_receptionist",

  // A genuine secret (used as an HMAC pepper for password hashing — see
  // src/auth/password.ts). Deliberately has NO code-level default: shipping
  // a default would let anyone who reads the source compute it for any
  // deployment that forgot to set it. assertAuthSecret() enforces this at
  // startup instead of silently falling back to something insecure.
  authSecret: process.env.AUTH_SECRET,

  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "ai_receptionist_session",
  sessionTtlDays: Number.parseInt(process.env.SESSION_TTL_DAYS ?? "30", 10),
  cookieSecure: readNodeEnv() === "production",

  // A genuine secret shared with services/voice-agent (see
  // middleware/require-service-auth.ts) so that non-interactive backend
  // service can call /internal/v1/* without a browser session cookie.
  // Deliberately has NO code-level default, same reasoning as authSecret.
  internalServiceKey: process.env.INTERNAL_SERVICE_KEY,

  // M7: a second, independent secret shared with services/voice-agent (see
  // auth/call-credential.ts), used only to mint/verify short-lived,
  // call-bound credentials for Twilio-originated sessions. Deliberately
  // optional here (unlike authSecret/internalServiceKey) -- Twilio
  // integration is optional per deployment; createApp() falls back to a
  // random per-boot value when unset, the same fail-closed-not-throwing
  // treatment internalServiceKey gets there. No assert*() function for
  // this one: nothing should force every deployment to configure it just
  // because /internal/v1 itself is always required.
  twilioCallCredentialSecret: process.env.TWILIO_CALL_CREDENTIAL_SECRET,

  // M8: "fake" is the default so tests and local development never need
  // real network access or an API key -- mirrors STT_PROVIDER/LLM_PROVIDER/
  // TTS_PROVIDER's exact convention in services/voice-agent/config.py. Set
  // to "openai" to generate real embeddings for knowledge search.
  embeddingProvider: process.env.EMBEDDING_PROVIDER ?? "fake",

  // Only required when embeddingProvider === "openai". No code-level
  // default -- createEmbeddingProvider() fails closed with a clear error
  // if this is missing and "openai" was explicitly selected.
  openaiApiKey: process.env.OPENAI_API_KEY,

  // text-embedding-3-small is the default OpenAI embedding model. This is
  // the single source of that default -- embedding-provider.ts takes the
  // resolved model string as a required option rather than keeping its
  // own copy, so there is exactly one place this literal is ever written.
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
};

/**
 * Fails closed: the process refuses to start authenticating requests
 * without a real secret rather than silently using an insecure default.
 * Call this before the server starts accepting traffic (see server.ts).
 */
export function assertAuthSecret(): void {
  if (!env.authSecret || env.authSecret.length < 16) {
    throw new Error(
      "AUTH_SECRET is not set (or is too short). Set a random secret of at least 16 " +
        "characters, e.g. via `openssl rand -base64 32`. See .env.example.",
    );
  }
}

/**
 * Fails closed for the service-to-service auth boundary the same way
 * assertAuthSecret() does for user auth: refuse to start rather than let
 * /internal/v1/* silently accept an empty/short key. See
 * middleware/require-service-auth.ts and SECURITY.md.
 */
export function assertServiceAuthSecret(): void {
  if (!env.internalServiceKey || env.internalServiceKey.length < 32) {
    throw new Error(
      "INTERNAL_SERVICE_KEY is not set (or is too short). Set a random secret of at least 32 " +
        "characters, e.g. via `openssl rand -hex 32`. See .env.example.",
    );
  }
}
