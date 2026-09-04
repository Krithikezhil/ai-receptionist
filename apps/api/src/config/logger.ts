import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.logLevel,
  // Also redacts the per-organization service token header.
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    'req.headers["x-organization-service-token"]',
  ],
});
