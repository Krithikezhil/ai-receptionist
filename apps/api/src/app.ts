import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
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
import {
  createOrganizationService,
  type OrganizationService,
} from "./services/organization.service.js";
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

  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.use(
    createApiRouter({
      authService,
      memberships,
      organizationService,
      businessProfileService,
      businessHoursService,
      servicesCatalogService,
    }),
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
