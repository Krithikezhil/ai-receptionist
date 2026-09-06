import { createApp, type AppDependencies } from "../../src/app.js";
import { createAuthService } from "../../src/services/auth.service.js";
import { createBusinessHoursService } from "../../src/services/business-hours.service.js";
import { createBusinessProfileService } from "../../src/services/business-profile.service.js";
import { createEmbeddingProvider } from "../../src/services/embedding-provider.js";
import { createKnowledgeService } from "../../src/services/knowledge.service.js";
import { createLeadService } from "../../src/services/lead.service.js";
import { createOrganizationService } from "../../src/services/organization.service.js";
import { createPhoneNumberService } from "../../src/services/phone-number.service.js";
import { createReceptionistConfigService } from "../../src/services/receptionist-config.service.js";
import { createServicesCatalogService } from "../../src/services/services-catalog.service.js";
import {
  createInMemorySessionRepository,
  createInMemoryUserRepository,
} from "./in-memory-repositories.js";
import {
  createInMemoryBusinessHoursRepository,
  createInMemoryBusinessProfileRepository,
  createInMemoryKnowledgeChunkRepository,
  createInMemoryKnowledgeRepository,
  createInMemoryLeadRepository,
  createInMemoryOrganizationPhoneNumberRepository,
  createInMemoryOrganizationRepositories,
  createInMemoryOrganizationServiceCredentialRepository,
  createInMemoryReceptionistConfigRepository,
  createInMemoryServiceRepository,
  createInMemoryUnitOfWork,
} from "./in-memory-organization-repositories.js";

/**
 * Builds a full Express app wired to in-memory repositories instead of
 * Postgres, so the real HTTP layer, controllers, and business logic
 * (hashing, session validation, tenant-membership checks) are exercised
 * end-to-end without needing a live database. See ARCHITECTURE.md
 * "Authentication" / "Organizations" for the test strategy this implements.
 *
 * Structural safeguard: `deps` below is typed as `Required<AppDependencies>`,
 * not `AppDependencies`. createApp() silently falls back to a real
 * Postgres-backed service for anything not explicitly injected — without
 * this, omitting one here wouldn't fail loudly, it would just mean that
 * resource's tests quietly exercise production wiring instead of the test
 * double (exactly what happened when knowledge/receptionist-config were
 * added — see TASKS.md). With `Required<...>`, adding a new optional field
 * to `AppDependencies` without wiring it here is now a `tsc` compile error
 * ("Property 'x' is missing"), not a silent runtime fallback.
 */

/**
 * Fixed test value for the service-auth key — tests never read a real
 * INTERNAL_SERVICE_KEY env var. Exported so tests can build a matching
 * `Authorization: Bearer` header without duplicating this literal (see
 * tests/internal-api.test.ts).
 */
export const TEST_INTERNAL_SERVICE_KEY =
  "test-internal-service-key-0123456789abcdef0123456789abcdef";

/**
 * Fixed test value for the M7 call-credential secret — mirrors
 * TEST_INTERNAL_SERVICE_KEY's role, just for the second, independent M7
 * secret (see auth/call-credential.ts). Exported so tests can mint a
 * matching credential without duplicating this literal (see
 * tests/twilio-phone-lookup.test.ts).
 */
export const TEST_TWILIO_CALL_CREDENTIAL_SECRET =
  "test-twilio-call-credential-secret-0123456789abcdef";

export function buildTestApp() {
  const users = createInMemoryUserRepository();
  const sessions = createInMemorySessionRepository();
  const authService = createAuthService({ users, sessions });

  const { organizations, memberships } = createInMemoryOrganizationRepositories();
  const businessProfiles = createInMemoryBusinessProfileRepository();
  const businessHours = createInMemoryBusinessHoursRepository();
  const services = createInMemoryServiceRepository();
  const knowledge = createInMemoryKnowledgeRepository();
  const knowledgeChunks = createInMemoryKnowledgeChunkRepository(knowledge);
  const embeddingProvider = createEmbeddingProvider("fake");
  const receptionistConfigs = createInMemoryReceptionistConfigRepository();
  const organizationServiceCredentials = createInMemoryOrganizationServiceCredentialRepository();
  const organizationPhoneNumbers = createInMemoryOrganizationPhoneNumberRepository();
  const leads = createInMemoryLeadRepository();
  const unitOfWork = createInMemoryUnitOfWork({
    organizations,
    memberships,
    businessProfiles,
    businessHours,
    receptionistConfigs,
    organizationServiceCredentials,
  });

  const organizationService = createOrganizationService(unitOfWork, organizations);
  const businessProfileService = createBusinessProfileService(businessProfiles);
  const businessHoursService = createBusinessHoursService(businessHours);
  const servicesCatalogService = createServicesCatalogService(services);
  const knowledgeService = createKnowledgeService(knowledge, knowledgeChunks, embeddingProvider);
  const receptionistConfigService = createReceptionistConfigService(receptionistConfigs);
  const phoneNumberService = createPhoneNumberService(organizationPhoneNumbers);
  const leadService = createLeadService(leads);

  const deps: Required<AppDependencies> = {
    authService,
    memberships,
    organizationService,
    businessProfileService,
    businessHoursService,
    servicesCatalogService,
    knowledgeService,
    knowledgeChunks,
    embeddingProvider,
    leadService,
    receptionistConfigService,
    phoneNumberService,
    internalServiceKey: TEST_INTERNAL_SERVICE_KEY,
    organizationServiceCredentials,
    organizationPhoneNumbers,
    twilioCallCredentialSecret: TEST_TWILIO_CALL_CREDENTIAL_SECRET,
  };

  const app = createApp(deps);

  return {
    app,
    users,
    sessions,
    organizations,
    memberships,
    businessProfiles,
    businessHours,
    services,
    knowledge,
    knowledgeChunks,
    leads,
    receptionistConfigs,
    organizationServiceCredentials,
    organizationPhoneNumbers,
  };
}
