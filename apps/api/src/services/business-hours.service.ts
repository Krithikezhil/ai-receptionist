import type {
  BusinessHoursEntry,
  BusinessHoursEntryInput,
  BusinessHoursRepository,
} from "../repositories/organization-types.js";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export interface BusinessHoursService {
  /** Always returns exactly 7 entries (Sun-Sat), filling in "closed" for any missing day. */
  getBusinessHours(organizationId: string): Promise<BusinessHoursEntry[]>;
  replaceBusinessHours(
    organizationId: string,
    entries: BusinessHoursEntryInput[],
  ): Promise<BusinessHoursEntry[]>;
}

export function createBusinessHoursService(repo: BusinessHoursRepository): BusinessHoursService {
  return {
    async getBusinessHours(organizationId) {
      const rows = await repo.listByOrganizationId(organizationId);
      const byDay = new Map(rows.map((r) => [r.dayOfWeek, r]));
      return ALL_DAYS.map(
        (dayOfWeek) =>
          byDay.get(dayOfWeek) ?? {
            id: "",
            organizationId,
            dayOfWeek,
            isOpen: false,
            openTime: null,
            closeTime: null,
          },
      );
    },

    async replaceBusinessHours(organizationId, entries) {
      return repo.replaceAll(organizationId, entries);
    },
  };
}
