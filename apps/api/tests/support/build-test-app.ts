import { createApp } from "../../src/app.js";
import { createAuthService } from "../../src/services/auth.service.js";
import { createBusinessHoursService } from "../../src/services/business-hours.service.js";
import { createBusinessProfileService } from "../../src/services/business-profile.service.js";
import { createOrganizationService } from "../../src/services/organization.service.js";
import { createServicesCatalogService } from "../../src/services/services-catalog.service.js";
import {
  createInMemorySessionRepository,
  createInMemoryUserRepository,
} from "./in-memory-repositories.js";
import {
  createInMemoryBusinessHoursRepository,
  createInMemoryBusinessProfileRepository,
  createInMemoryOrganizationRepositories,
  createInMemoryServiceRepository,
  createInMemoryUnitOfWork,
} from "./in-memory-organization-repositories.js";

/**
 * Builds a full Express app wired to in-memory repositories instead of
 * Postgres, so the real HTTP layer, controllers, and business logic
 * (hashing, session validation, tenant-membership checks) are exercised
 * end-to-end without needing a live database. See ARCHITECTURE.md
 * "Authentication" / "Organizations" for the test strategy this implements.
 */
export function buildTestApp() {
  const users = createInMemoryUserRepository();
  const sessions = createInMemorySessionRepository();
  const authService = createAuthService({ users, sessions });

  const { organizations, memberships } = createInMemoryOrganizationRepositories();
  const businessProfiles = createInMemoryBusinessProfileRepository();
  const businessHours = createInMemoryBusinessHoursRepository();
  const services = createInMemoryServiceRepository();
  const unitOfWork = createInMemoryUnitOfWork({
    organizations,
    memberships,
    businessProfiles,
    businessHours,
  });

  const organizationService = createOrganizationService(unitOfWork, organizations);
  const businessProfileService = createBusinessProfileService(businessProfiles);
  const businessHoursService = createBusinessHoursService(businessHours);
  const servicesCatalogService = createServicesCatalogService(services);

  const app = createApp({
    authService,
    memberships,
    organizationService,
    businessProfileService,
    businessHoursService,
    servicesCatalogService,
  });

  return {
    app,
    users,
    sessions,
    organizations,
    memberships,
    businessProfiles,
    businessHours,
    services,
  };
}
