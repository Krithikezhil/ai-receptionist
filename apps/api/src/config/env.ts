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
