import type { BusinessHoursEntryInput } from "../repositories/organization-types.js";
import type {
  BusinessProfile,
  Organization,
  OrganizationMembership,
  OrganizationRepository,
  OrganizationUpdate,
} from "../repositories/organization-types.js";
import type { ReceptionistConfiguration } from "../repositories/receptionist-config-types.js";
import type { UnitOfWork } from "../repositories/unit-of-work.js";
import { slugify } from "./slugify.js";

export interface CreateOrganizationResult {
  organization: Organization;
  membership: OrganizationMembership;
  businessProfile: BusinessProfile;
  receptionistConfig: ReceptionistConfiguration;
}

export interface OrganizationService {
  /**
   * Creates the organization, its owner membership, an initial business
   * profile, default (closed) business hours for all 7 days, and a default
   * receptionist configuration — all in one transaction. See
   * ARCHITECTURE.md "Organizations": an organization must never exist
   * without its owner membership. The receptionist configuration is always
   * created disabled — organization creation must never activate it.
   */
  createOrganization(userId: string, name: string): Promise<CreateOrganizationResult>;
  listOrganizationsForUser(userId: string): Promise<Organization[]>;
  getOrganization(organizationId: string): Promise<Organization | undefined>;
  updateOrganization(
    organizationId: string,
    changes: OrganizationUpdate,
  ): Promise<Organization | undefined>;
}

function defaultBusinessHours(): BusinessHoursEntryInput[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isOpen: false,
    openTime: null,
    closeTime: null,
  }));
}

export function createOrganizationService(
  unitOfWork: UnitOfWork,
  organizations: OrganizationRepository,
): OrganizationService {
  return {
    async createOrganization(userId, name) {
      const baseSlug = slugify(name);

      return unitOfWork.run(async (repos) => {
        let slug = baseSlug;
        let suffix = 1;
        // Deterministic collision handling for the common case. A true
        // concurrent race on the same slug still falls back on the
        // database's unique constraint (see SECURITY.md known limitations).
        while (await repos.organizations.findBySlug(slug)) {
          suffix += 1;
          slug = `${baseSlug}-${suffix}`;
        }

        const organization = await repos.organizations.create({ name, slug });
        const membership = await repos.memberships.create({
          organizationId: organization.id,
          userId,
          role: "owner",
        });
        const businessProfile = await repos.businessProfiles.create({
          organizationId: organization.id,
          businessName: name,
        });
        await repos.businessHours.replaceAll(organization.id, defaultBusinessHours());
        // create() itself also forces enabled: false regardless of what's
        // passed — see drizzle/receptionist-config.repository.ts. Not
        // relying on that alone here is deliberate belt-and-suspenders.
        const receptionistConfig = await repos.receptionistConfigs.create({
          organizationId: organization.id,
        });

        return { organization, membership, businessProfile, receptionistConfig };
      });
    },

    async listOrganizationsForUser(userId) {
      return organizations.listForUser(userId);
    },

    async getOrganization(organizationId) {
      return organizations.findById(organizationId);
    },

    async updateOrganization(organizationId, changes) {
      return organizations.update(organizationId, changes);
    },
  };
}
