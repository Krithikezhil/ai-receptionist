import type {
  NewOrganizationPhoneNumber,
  OrganizationPhoneNumber,
  OrganizationPhoneNumberRepository,
} from "../repositories/organization-phone-number-types.js";

export interface PhoneNumberService {
  listPhoneNumbers(organizationId: string): Promise<OrganizationPhoneNumber[]>;
  /**
   * Returns undefined if the number is already assigned to any
   * organization (including this one) -- check-first, same "the database's
   * unique constraint is only a race backstop" pattern
   * organization.service.ts already uses for slug collisions; a genuine
   * concurrent race still falls back to the DB constraint and surfaces as
   * a generic 500, not silently accepted twice.
   */
  addPhoneNumber(
    organizationId: string,
    phoneNumber: string,
  ): Promise<OrganizationPhoneNumber | undefined>;
  /** false means "not found for this organization" -- same response whether
   * the id doesn't exist at all or belongs to a different organization. */
  removePhoneNumber(organizationId: string, phoneNumberId: string): Promise<boolean>;
}

export function createPhoneNumberService(
  repo: OrganizationPhoneNumberRepository,
): PhoneNumberService {
  return {
    async listPhoneNumbers(organizationId) {
      return repo.listByOrganizationId(organizationId);
    },

    async addPhoneNumber(organizationId, phoneNumber) {
      const existing = await repo.findByPhoneNumber(phoneNumber);
      if (existing) return undefined;
      const newPhoneNumber: NewOrganizationPhoneNumber = { organizationId, phoneNumber };
      return repo.create(newPhoneNumber);
    },

    async removePhoneNumber(organizationId, phoneNumberId) {
      const existing = await repo.findByIdAndOrganizationId(phoneNumberId, organizationId);
      if (!existing) return false;
      await repo.deleteByIdAndOrganizationId(phoneNumberId, organizationId);
      return true;
    },
  };
}
