import { randomBytes } from "node:crypto";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import type { OrganizationServiceCredentialRepository } from "./repositories/organization-service-credential-types.js";
import type { MembershipRepository } from "./repositories/organization-types.js";
import { createRepositories } from "./repositories/index.js";
import { createApiRouter } from "./routes/index.js";
import { createAuthService, type AuthService } from "./services/auth.service.js";
import {
  createBusinessHoursService,
  type BusinessHoursService,
} from "./services/business-hours.service.js";
import {
  createBusinessProfileService,
  type BusinessProfileService,
} from "./services/business-profile.service.js";
import { createKnowledgeService, type KnowledgeService } from "./services/knowledge.service.js";
import {
  createOrganizationService,
  type OrganizationService,
} from "./services/organization.service.js";
import {
  createReceptionistConfigService,
  type ReceptionistConfigService,
} from "./services/receptionist-config.service.js";
import {
  createServicesCatalogService,
  type ServicesCatalogService,
} from "./services/services-catalog.service.js";

export interface AppDependencies {
  /** Injected in tests to avoid needing a real Postgres connection. */
  authService?: AuthService;
  memberships?: MembershipRepository;
  organizationService?: OrganizationService;
  businessProfileService?: BusinessProfileService;
  businessHoursService?: BusinessHoursService;
  servicesCatalogService?: ServicesCatalogService;
  knowledgeService?: KnowledgeService;
  receptionistConfigService?: ReceptionistConfigService;
  /** Injected in tests with a fixed test value instead of a real env secret. */
  internalServiceKey?: string;
  organizationServiceCredentials?: OrganizationServiceCredentialRepository;
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
  const knowledgeService = deps.knowledgeService ?? createKnowledgeService(repos.knowledge);
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

  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(pinoHttp({ logger }));

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
        receptionistConfigService,
      },
      {
        organizationService,
        businessProfileService,
        businessHoursService,
        servicesCatalogService,
        knowledgeService,
        receptionistConfigService,
        internalServiceKey,
        organizationServiceCredentials,
      },
    ),
  );

  // Centralized error handler: never leak stack traces or internal error
  // details to clients. Express 5 forwards rejected async handler promises
  // here automatically.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}
