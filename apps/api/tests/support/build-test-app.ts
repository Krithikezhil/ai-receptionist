import { createApp } from "../../src/app.js";
import { createAuthService } from "../../src/services/auth.service.js";
import {
  createInMemorySessionRepository,
  createInMemoryUserRepository,
} from "./in-memory-repositories.js";

/**
 * Builds a full Express app wired to in-memory repositories instead of
 * Postgres, so the real HTTP layer, controllers, and business logic
 * (hashing, session validation) are exercised end-to-end without needing a
 * live database. See ARCHITECTURE.md "Authentication" for the test
 * strategy this implements.
 */
export function buildTestApp() {
  const users = createInMemoryUserRepository();
  const sessions = createInMemorySessionRepository();
  const authService = createAuthService({ users, sessions });
  const app = createApp({ authService });
  return { app, users, sessions };
}
