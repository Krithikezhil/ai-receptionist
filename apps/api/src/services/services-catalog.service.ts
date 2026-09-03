import type {
  NewServiceItem,
  ServiceItem,
  ServiceItemUpdate,
  ServiceRepository,
} from "../repositories/organization-types.js";

export interface ServicesCatalogService {
  listServices(organizationId: string): Promise<ServiceItem[]>;
  createService(
    organizationId: string,
    input: Omit<NewServiceItem, "organizationId">,
  ): Promise<ServiceItem>;
  /** undefined means "not found for this organization" — same response whether the id doesn't exist at all or belongs to a different organization. */
  updateService(
    organizationId: string,
    serviceId: string,
    changes: ServiceItemUpdate,
  ): Promise<ServiceItem | undefined>;
  deleteService(organizationId: string, serviceId: string): Promise<boolean>;
}

export function createServicesCatalogService(repo: ServiceRepository): ServicesCatalogService {
  return {
    async listServices(organizationId) {
      return repo.listByOrganizationId(organizationId);
    },

    async createService(organizationId, input) {
      return repo.create({ ...input, organizationId });
    },

    async updateService(organizationId, serviceId, changes) {
      return repo.update(serviceId, organizationId, changes);
    },

    async deleteService(organizationId, serviceId) {
      return repo.deleteByIdAndOrganizationId(serviceId, organizationId);
    },
  };
}
