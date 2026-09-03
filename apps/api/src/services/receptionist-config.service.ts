import type {
  ReceptionistConfigRepository,
  ReceptionistConfiguration,
  ReceptionistConfigurationUpdate,
} from "../repositories/receptionist-config-types.js";

export interface ReceptionistConfigService {
  getReceptionistConfig(organizationId: string): Promise<ReceptionistConfiguration | undefined>;
  updateReceptionistConfig(
    organizationId: string,
    changes: ReceptionistConfigurationUpdate,
  ): Promise<ReceptionistConfiguration>;
}

export function createReceptionistConfigService(
  repo: ReceptionistConfigRepository,
): ReceptionistConfigService {
  return {
    async getReceptionistConfig(organizationId) {
      return repo.findByOrganizationId(organizationId);
    },

    async updateReceptionistConfig(organizationId, changes) {
      // Every organization gets a config row at creation time
      // (organization.service.ts), so this normally always finds one — but
      // don't silently no-op if it somehow doesn't exist yet.
      const existing = await repo.findByOrganizationId(organizationId);
      if (!existing) {
        const created = await repo.create({ organizationId });
        const updated = await repo.update(organizationId, changes);
        return updated ?? created;
      }

      const updated = await repo.update(organizationId, changes);
      if (!updated) throw new Error("Failed to update receptionist configuration");
      return updated;
    },
  };
}
