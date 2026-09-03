import { getDb } from "../db/client.js";
import { createDrizzleBusinessHoursRepository } from "./drizzle/business-hours.repository.js";
import { createDrizzleBusinessProfileRepository } from "./drizzle/business-profile.repository.js";
import { createDrizzleKnowledgeRepository } from "./drizzle/knowledge.repository.js";
import { createDrizzleMembershipRepository } from "./drizzle/membership.repository.js";
import { createDrizzleOrganizationRepository } from "./drizzle/organization.repository.js";
import { createDrizzleReceptionistConfigRepository } from "./drizzle/receptionist-config.repository.js";
import { createDrizzleServiceRepository } from "./drizzle/service.repository.js";
import { createDrizzleSessionRepository } from "./drizzle/session.repository.js";
import { createDrizzleUnitOfWork } from "./drizzle/unit-of-work.js";
import { createDrizzleUserRepository } from "./drizzle/user.repository.js";
import type { KnowledgeRepository } from "./knowledge-types.js";
import type {
  BusinessHoursRepository,
  BusinessProfileRepository,
  MembershipRepository,
  OrganizationRepository,
  ServiceRepository,
} from "./organization-types.js";
import type { ReceptionistConfigRepository } from "./receptionist-config-types.js";
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
  knowledge: KnowledgeRepository;
  receptionistConfigs: ReceptionistConfigRepository;
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
    knowledge: createDrizzleKnowledgeRepository(db),
    receptionistConfigs: createDrizzleReceptionistConfigRepository(db),
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
export type { KnowledgeRepository } from "./knowledge-types.js";
export type { ReceptionistConfigRepository } from "./receptionist-config-types.js";
export type { UnitOfWork } from "./unit-of-work.js";
