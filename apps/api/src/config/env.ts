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
};
