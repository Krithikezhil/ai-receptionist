import type { Database } from "../../db/client.js";
import type { OrganizationCreationRepos, UnitOfWork } from "../unit-of-work.js";
import { createDrizzleBusinessHoursRepository } from "./business-hours.repository.js";
import { createDrizzleBusinessProfileRepository } from "./business-profile.repository.js";
import { createDrizzleMembershipRepository } from "./membership.repository.js";
import { createDrizzleOrganizationServiceCredentialRepository } from "./organization-service-credential.repository.js";
import { createDrizzleOrganizationRepository } from "./organization.repository.js";
import { createDrizzleReceptionistConfigRepository } from "./receptionist-config.repository.js";

export function createDrizzleUnitOfWork(db: Database): UnitOfWork {
  return {
    run<T>(fn: (repos: OrganizationCreationRepos) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        const repos: OrganizationCreationRepos = {
          organizations: createDrizzleOrganizationRepository(tx),
          memberships: createDrizzleMembershipRepository(tx),
          businessProfiles: createDrizzleBusinessProfileRepository(tx),
          businessHours: createDrizzleBusinessHoursRepository(tx),
          receptionistConfigs: createDrizzleReceptionistConfigRepository(tx),
          organizationServiceCredentials: createDrizzleOrganizationServiceCredentialRepository(tx),
        };
        return fn(repos);
      });
    },
  };
}
