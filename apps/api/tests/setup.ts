// Test-only secret — never used outside this process. Real deployments
// must set a genuinely random AUTH_SECRET; see .env.example and
// config/env.ts's assertAuthSecret().
process.env.AUTH_SECRET ??= "test-only-secret-do-not-use-in-prod";

// Keep test output readable — pino-http otherwise logs a full request/response
// dump (including all headers) for every request made by every test.
process.env.LOG_LEVEL ??= "silent";
