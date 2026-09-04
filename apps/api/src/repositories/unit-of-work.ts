import type {
  BusinessHoursRepository,
  BusinessProfileRepository,
  MembershipRepository,
  OrganizationRepository,
} from "./organization-types.js";
import type { OrganizationServiceCredentialRepository } from "./organization-service-credential-types.js";
import type { ReceptionistConfigRepository } from "./receptionist-config-types.js";

export interface OrganizationCreationRepos {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  businessProfiles: BusinessProfileRepository;
  businessHours: BusinessHoursRepository;
  receptionistConfigs: ReceptionistConfigRepository;
  organizationServiceCredentials: OrganizationServiceCredentialRepository;
}

/**
 * Organization creation must be transactional (org + owner membership +
 * initial business profile + default disabled receptionist config all
 * succeed or all fail together) — see ARCHITECTURE.md "Organizations". The
 * Postgres implementation wraps this in a real `db.transaction()`; the
 * in-memory test implementation just runs the callback directly (no
 * partial-failure modes to guard against in a single-threaded test double).
 */
export interface UnitOfWork {
  run<T>(fn: (repos: OrganizationCreationRepos) => Promise<T>): Promise<T>;
}
