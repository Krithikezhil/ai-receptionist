import { randomBytes } from "node:crypto";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { httpRequestSerializer, logger } from "./config/logger.js";
import type { KnowledgeChunkRepository } from "./repositories/knowledge-chunk-types.js";
import type { OrganizationPhoneNumberRepository } from "./repositories/organization-phone-number-types.js";
import type { OrganizationServiceCredentialRepository } from "./repositories/organization-service-credential-types.js";
import type { MembershipRepository } from "./repositories/organization-types.js";
import type { SmsNotificationRepository } from "./repositories/sms-notification-types.js";
import type { SmsOptOutRepository } from "./repositories/sms-opt-out-types.js";
import { createRepositories } from "./repositories/index.js";
import { createApiRouter } from "./routes/index.js";
import { createTwilioSmsRouter } from "./routes/twilio-sms.routes.js";
import { createAppointmentService, type AppointmentService } from "./services/appointment.service.js";
import { createAuthService, type AuthService } from "./services/auth.service.js";
import {
  createBusinessHoursService,
  type BusinessHoursService,
} from "./services/business-hours.service.js";
import {
  createBusinessProfileService,
  type BusinessProfileService,
} from "./services/business-profile.service.js";
import {
  createCalendarConnectionService,
  type CalendarConnectionService,
} from "./services/calendar-connection.service.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "./services/embedding-provider.js";
import { createGoogleCalendarClient } from "./services/google-calendar-client.js";
import { createKnowledgeService, type KnowledgeService } from "./services/knowledge.service.js";
import { createLeadService, type LeadService } from "./services/lead.service.js";
import {
  createOrganizationService,
  type OrganizationService,
} from "./services/organization.service.js";
import {
  createPhoneNumberService,
  type PhoneNumberService,
} from "./services/phone-number.service.js";
import {
  createReceptionistConfigService,
  type ReceptionistConfigService,
} from "./services/receptionist-config.service.js";
import {
  createServicesCatalogService,
  type ServicesCatalogService,
} from "./services/services-catalog.service.js";
import { createSmsNotificationService } from "./services/sms-notification.service.js";

export interface AppDependencies {
  /** Injected in tests to avoid needing a real Postgres connection. */
  authService?: AuthService;
  memberships?: MembershipRepository;
  organizationService?: OrganizationService;
  businessProfileService?: BusinessProfileService;
  businessHoursService?: BusinessHoursService;
  servicesCatalogService?: ServicesCatalogService;
  knowledgeService?: KnowledgeService;
  knowledgeChunks?: KnowledgeChunkRepository;
  /** Injected in tests with a fake (deterministic, no-network) provider instead of a real one. */
  embeddingProvider?: EmbeddingProvider;
  leadService?: LeadService;
  receptionistConfigService?: ReceptionistConfigService;
  phoneNumberService?: PhoneNumberService;
  calendarConnectionService?: CalendarConnectionService;
  appointmentService?: AppointmentService;
  /** Injected in tests with a fixed test value instead of a real env secret. */
  internalServiceKey?: string;
  organizationServiceCredentials?: OrganizationServiceCredentialRepository;
  organizationPhoneNumbers?: OrganizationPhoneNumberRepository;
  /** Injected in tests with a fixed test value instead of a real env secret. */
  twilioCallCredentialSecret?: string;
  /** Injected in tests to avoid needing a real Postgres connection --
   * used only by the M11 Step 4B Twilio SMS status webhook. */
  smsNotifications?: SmsNotificationRepository;
  /** Injected in tests to avoid needing a real Postgres connection --
   * used by the M11 Step 4 Twilio SMS inbound webhook (tenant-scoped
   * opt-out state). */
  smsOptOuts?: SmsOptOutRepository;
}

export function createApp(deps: AppDependencies = {}): Express {
  const repos = createRepositories();

  const authService = deps.authService ?? createAuthService(repos);
  const memberships = deps.memberships ?? repos.memberships;
  const organizationService =
    deps.organizationService ?? createOrganizationService(repos.unitOfWork, repos.organizations);
  const businessProfileService =
    deps.businessProfileService ?? createBusinessProfileService(repos.businessProfiles);
  const businessHoursService =
    deps.businessHoursService ?? createBusinessHoursService(repos.businessHours);
  const servicesCatalogService =
    deps.servicesCatalogService ?? createServicesCatalogService(repos.services);
  // M11 Step 3: constructed once, here, from the existing repository
  // bundle -- shared by both leadService and appointmentService below, no
  // new repository instance, no AppDependencies change (nothing above
  // these two services needs direct access to it).
  const smsNotificationService = createSmsNotificationService(repos.smsNotifications);
  const leadService =
    deps.leadService ?? createLeadService(repos.leads, smsNotificationService);
  const knowledgeChunks = deps.knowledgeChunks ?? repos.knowledgeChunks;
  // M8: constructed once, here, at app startup -- createEmbeddingProvider()
  // validates eagerly (see services/embedding-provider.ts), so a
  // misconfigured EMBEDDING_PROVIDER=openai (missing key/model) fails the
  // whole process at boot, the same fail-closed-at-startup treatment
  // assertAuthSecret()/assertServiceAuthSecret() give their own secrets --
  // never deferred to a per-request surprise.
  const embeddingProvider =
    deps.embeddingProvider ??
    createEmbeddingProvider(env.embeddingProvider, {
      apiKey: env.openaiApiKey,
      model: env.openaiEmbeddingModel,
    });
  const knowledgeService =
    deps.knowledgeService ??
    createKnowledgeService(repos.knowledge, knowledgeChunks, embeddingProvider);
  const receptionistConfigService =
    deps.receptionistConfigService ?? createReceptionistConfigService(repos.receptionistConfigs);

  // assertServiceAuthSecret() (server.ts) is what actually enforces
  // INTERNAL_SERVICE_KEY being set for real production startup — it runs
  // before createApp() is ever called there. createApp() itself stays
  // lazy/non-throwing (matching how authSecret is handled: never asserted
  // here either) so callers that don't need /internal/v1 at all — like the
  // M1 health test, which calls createApp() directly — aren't forced to
  // configure it. A random, unguessable per-boot value if nothing is
  // configured means /internal/v1 fails closed (every request 401s) rather
  // than either throwing or accepting a predictable fallback.
  const internalServiceKey =
    deps.internalServiceKey ?? env.internalServiceKey ?? randomBytes(32).toString("hex");
  const organizationServiceCredentials =
    deps.organizationServiceCredentials ?? repos.organizationServiceCredentials;
  const organizationPhoneNumbers =
    deps.organizationPhoneNumbers ?? repos.organizationPhoneNumbers;
  // M11 Step 4B: the Twilio SMS status webhook needs the raw repository
  // directly (not a service) -- overridable here the same way
  // organizationServiceCredentials/organizationPhoneNumbers already are,
  // so tests never silently fall through to the real Postgres-backed
  // repos.smsNotifications.
  const smsNotifications = deps.smsNotifications ?? repos.smsNotifications;
  // M11 Step 4: the Twilio SMS inbound webhook needs the raw opt-out
  // repository directly -- same overridable-for-tests pattern as
  // smsNotifications immediately above.
  const smsOptOuts = deps.smsOptOuts ?? repos.smsOptOuts;
  // Same random-per-boot-if-unset treatment as internalServiceKey above,
  // and for the same reason: Twilio's own routes should fail closed (no
  // credential minted before this boot could ever verify) rather than the
  // whole process refusing to start over a secret most deployments won't
  // configure -- see config/env.ts.
  const twilioCallCredentialSecret =
    deps.twilioCallCredentialSecret ?? env.twilioCallCredentialSecret ?? randomBytes(32).toString("hex");
  const phoneNumberService =
    deps.phoneNumberService ?? createPhoneNumberService(organizationPhoneNumbers);
  const calendarConnectionService =
    deps.calendarConnectionService ??
    createCalendarConnectionService(repos.organizationCalendarConnections);
  const appointmentService =
    deps.appointmentService ??
    createAppointmentService(
      repos.appointments,
      repos.services,
      repos.businessProfiles,
      repos.businessHours,
      calendarConnectionService,
      // Real production client -- native fetch only, no SDK, receives only
      // short-lived access tokens (see google-calendar-client.ts's own
      // security boundary comment). GOOGLE_OAUTH_CLIENT_ID/SECRET,
      // GOOGLE_OAUTH_REDIRECT_URI, GOOGLE_OAUTH_STATE_SECRET, and
      // GOOGLE_TOKEN_ENCRYPTION_KEY are all read lazily, per-request, by
      // the modules that actually need them -- not asserted here at boot,
      // matching TWILIO_CALL_CREDENTIAL_SECRET's optional-per-deployment
      // precedent, since Google Calendar integration is optional per
      // deployment.
      createGoogleCalendarClient(),
      smsNotificationService,
    );

  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: httpRequestSerializer,
      },
    }),
  );

  app.use(
    createApiRouter(
      {
        authService,
        memberships,
        organizationService,
        businessProfileService,
        businessHoursService,
        servicesCatalogService,
        knowledgeService,
        leadService,
        receptionistConfigService,
        phoneNumberService,
        appointmentService,
        calendarConnectionService,
      },
      {
        organizationService,
        businessProfileService,
        businessHoursService,
        servicesCatalogService,
        knowledgeService,
        leadService,
        receptionistConfigService,
        internalServiceKey,
        organizationServiceCredentials,
        organizationPhoneNumbers,
        appointmentService,
        twilioCallCredentialSecret,
      },
    ),
  );

  // M11 Step 4B: mounted directly here (not composed through
  // routes/index.ts's createApiRouter, unlike every other router) --
  // functionally equivalent; public, gated exclusively by
  // X-Twilio-Signature verification inside the controller itself, never
  // by requireAuth/requireOrgMembership/requireServiceAuth (Twilio cannot
  // present any of those). See routes/twilio-sms.routes.ts.
  app.use("/twilio", createTwilioSmsRouter(smsNotifications, organizationPhoneNumbers, smsOptOuts));

  // Centralized error handler: never leak stack traces or internal error
  // details to clients. Express 5 forwards rejected async handler promises
  // here automatically.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}
