import type {
  BusinessProfile,
  BusinessProfileRepository,
  BusinessProfileUpdate,
} from "../repositories/organization-types.js";

/** Omits the key entirely when value is undefined, instead of `{ key: undefined }`. */
function defined<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

export interface BusinessProfileService {
  getBusinessProfile(organizationId: string): Promise<BusinessProfile | undefined>;
  updateBusinessProfile(
    organizationId: string,
    changes: BusinessProfileUpdate,
  ): Promise<BusinessProfile>;
}

export function createBusinessProfileService(
  repo: BusinessProfileRepository,
): BusinessProfileService {
  return {
    async getBusinessProfile(organizationId) {
      return repo.findByOrganizationId(organizationId);
    },

    async updateBusinessProfile(organizationId, changes) {
      const existing = await repo.findByOrganizationId(organizationId);

      // Defensive fallback: organization creation always creates a profile,
      // so this normally never runs, but update() shouldn't silently no-op
      // if it somehow doesn't exist yet. Built with defined() rather than a
      // plain object literal because exactOptionalPropertyTypes rejects an
      // explicit `key: undefined` as different from the key being absent.
      if (!existing) {
        return repo.create({
          organizationId,
          businessName: changes.businessName ?? "Untitled Business",
          ...defined("description", changes.description),
          ...defined("phone", changes.phone),
          ...defined("email", changes.email),
          ...defined("website", changes.website),
          ...defined("address", changes.address),
          ...defined("timezone", changes.timezone),
        });
      }

      const updated = await repo.update(organizationId, changes);
      if (!updated) throw new Error("Failed to update business profile");
      return updated;
    },
  };
}
