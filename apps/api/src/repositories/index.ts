import { getDb } from "../db/client.js";
import { createDrizzleBusinessHoursRepository } from "./drizzle/business-hours.repository.js";
import { createDrizzleBusinessProfileRepository } from "./drizzle/business-profile.repository.js";
import { createDrizzleMembershipRepository } from "./drizzle/membership.repository.js";
import { createDrizzleOrganizationRepository } from "./drizzle/organization.repository.js";
import { createDrizzleServiceRepository } from "./drizzle/service.repository.js";
import { createDrizzleSessionRepository } from "./drizzle/session.repository.js";
import { createDrizzleUnitOfWork } from "./drizzle/unit-of-work.js";
import { createDrizzleUserRepository } from "./drizzle/user.repository.js";
import type {
  BusinessHoursRepository,
  BusinessProfileRepository,
  MembershipRepository,
  OrganizationRepository,
  ServiceRepository,
} from "./organization-types.js";
import type { SessionRepository, UserRepository } from "./types.js";
import type { UnitOfWork } from "./unit-of-work.js";

export interface Repositories {
  users: UserRepository;
  sessions: SessionRepository;
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
  businessProfiles: BusinessProfileRepository;
  businessHours: BusinessHoursRepository;
  services: ServiceRepository;
  unitOfWork: UnitOfWork;
}

export function createRepositories(): Repositories {
  const db = getDb();
  return {
    users: createDrizzleUserRepository(db),
    sessions: createDrizzleSessionRepository(db),
    organizations: createDrizzleOrganizationRepository(db),
    memberships: createDrizzleMembershipRepository(db),
    businessProfiles: createDrizzleBusinessProfileRepository(db),
    businessHours: createDrizzleBusinessHoursRepository(db),
    services: createDrizzleServiceRepository(db),
    unitOfWork: createDrizzleUnitOfWork(db),
  };
}

export type { SessionRepository, UserRepository } from "./types.js";
export type {
  BusinessHoursRepository,
  BusinessProfileRepository,
  MembershipRepository,
  OrganizationRepository,
  ServiceRepository,
} from "./organization-types.js";
export type { UnitOfWork } from "./unit-of-work.js";
