import { logger } from "./config/logger.js";
import { createRepositories } from "./repositories/index.js";
import { createSmsNotificationService } from "./services/sms-notification.service.js";
import { createTwilioSmsClient } from "./services/twilio-sms-client.js";
import {
  createShutdownSignal,
  runWorkerLoop,
  type SmsWorkerDeps,
} from "./workers/sms-worker.js";

/**
 * Standalone SMS worker process entrypoint (M11 Step 4). Wiring only --
 * all actual worker behavior (claim/process/retry/reminder-materialization/
 * shutdown mechanics) lives in workers/sms-worker.ts, unmodified and never
 * duplicated here. Run via `npm run worker` (tsx src/worker.ts), as a
 * separate process from the HTTP API (server.ts) -- this process never
 * opens a port or accepts a request.
 *
 * TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/API_PUBLIC_BASE_URL are read
 * directly via process.env here, at this integration's own boundary --
 * matching the established optional-per-deployment-integration convention
 * already used by controllers/twilio-sms-status.controller.ts's own
 * loadTwilioSmsWebhookConfig() and Google Calendar's five vars (never
 * routed through config/env.ts, which stays reserved for configuration
 * every deployment needs regardless of which optional integrations are
 * enabled).
 *
 * Unlike the webhook route (which must stay optional -- the API server
 * exists for many purposes besides Twilio SMS), this entire process exists
 * ONLY to send SMS via Twilio: if these three vars aren't set, the worker
 * has nothing useful to do, so it fails closed at startup rather than
 * running forever unable to construct a working Twilio client or a valid
 * callback URL -- the same fail-closed-before-doing-any-work treatment
 * server.ts's assertAuthSecret()/assertServiceAuthSecret() give the HTTP
 * API's own critical secrets, scoped here to what this process needs.
 *
 * TWILIO_PHONE_NUMBER is deliberately NOT read here: createTwilioSmsClient
 * takes only (accountSid, authToken) -- there is no "from number" parameter
 * on the real client at all. The outbound sender number is resolved
 * per-organization by the worker itself (workers/sms-worker.ts's
 * resolveSenderNumber, backed by the organization_phone_numbers table),
 * the same multi-tenant-number design M7 already established for inbound
 * calls. Reading a single global TWILIO_PHONE_NUMBER here would have
 * nowhere correct to be used and would bypass that existing design.
 */

// Must stay byte-for-byte identical to
// controllers/twilio-sms-status.controller.ts's own SMS_STATUS_WEBHOOK_PATH
// and canonicalSmsStatusWebhookUrl() -- duplicated here (not imported)
// because that helper is not exported, and modifying that controller is
// outside this step's approved scope.
const SMS_STATUS_WEBHOOK_PATH = "/twilio/sms-status";

interface WorkerConfig {
  accountSid: string;
  authToken: string;
  statusCallbackUrl: string;
}

function loadWorkerConfig(): WorkerConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const publicBaseUrl = process.env.API_PUBLIC_BASE_URL;
  if (!accountSid || !authToken || !publicBaseUrl) {
    throw new Error(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and API_PUBLIC_BASE_URL must all be set to run " +
        "the SMS worker. See .env.example.",
    );
  }
  return {
    accountSid,
    authToken,
    statusCallbackUrl: publicBaseUrl.replace(/\/+$/, "") + SMS_STATUS_WEBHOOK_PATH,
  };
}

function buildDeps(config: WorkerConfig): SmsWorkerDeps {
  const repos = createRepositories();
  return {
    smsNotifications: repos.smsNotifications,
    appointments: repos.appointments,
    businessProfiles: repos.businessProfiles,
    organizationPhoneNumbers: repos.organizationPhoneNumbers,
    smsOptOuts: repos.smsOptOuts,
    smsNotificationService: createSmsNotificationService(repos.smsNotifications),
    twilioSmsClient: createTwilioSmsClient(config.accountSid, config.authToken),
    statusCallbackUrl: config.statusCallbackUrl,
  };
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const deps = buildDeps(config);
  const { signal, stop } = createShutdownSignal();

  const shutdown = (signalName: string) => {
    logger.info({ signal: signalName }, "sms worker shutting down");
    stop();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("sms worker starting");
  await runWorkerLoop(deps, signal);
  logger.info("sms worker stopped");
}

// No process.exit() on the success path -- the process exits naturally
// once main() resolves and the event loop empties, the same reasoning
// workers/sms-worker.ts's own interruptibleSleep design already
// documents: an explicit process.exit() risks racing pending log I/O.
main().catch((err) => {
  // A fatal startup/runtime error (missing config, unreachable database,
  // an unexpected rejection escaping runWorkerLoop) -- distinct from
  // sms-worker.ts's own per-notification unexpected-error handling, which
  // deliberately avoids err.message because that error can originate from
  // repository/rendering code touching per-customer data. This is a
  // process-level crash diagnostic with no such per-customer context, so
  // the actual message is logged to make the failure actionable.
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "sms worker crashed");
  process.exitCode = 1;
});
