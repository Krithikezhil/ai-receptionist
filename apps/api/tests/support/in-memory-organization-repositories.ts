import { randomUUID } from "node:crypto";
import type {
  BusinessHoursEntry,
  BusinessHoursRepository,
  BusinessProfile,
  BusinessProfileRepository,
  MembershipRepository,
  NewBusinessProfile,
  NewOrganization,
  NewOrganizationMembership,
  NewServiceItem,
  Organization,
  OrganizationMembership,
  OrganizationRepository,
  ServiceItem,
  ServiceRepository,
} from "../../src/repositories/organization-types.js";
import type { OrganizationCreationRepos, UnitOfWork } from "../../src/repositories/unit-of-work.js";

/**
 * Applies only the keys present with a non-undefined value — mirrors how a
 * real SQL UPDATE ... SET only touches columns actually named in the
 * statement. Needed because exactOptionalPropertyTypes makes a plain
 * `{ ...base, ...changes }` spread type-unsound when changes' optional
 * fields are typed `T | undefined`.
 */
type PartialUpdate<T> = { [K in keyof T]?: T[K] | undefined };

function applyDefined<T extends object>(base: T, changes: PartialUpdate<T>): T {
  const result: T = { ...base };
  for (const key of Object.keys(changes) as (keyof T)[]) {
    const value = changes[key];
    if (value !== undefined) {
      result[key] = value as T[typeof key];
    }
  }
  return result;
}

/**
 * Test doubles for the M3 repository interfaces — same role as
 * in-memory-repositories.ts from M2. Production code always uses the
 * Postgres/Drizzle implementations (src/repositories/drizzle/*).
 *
 * Organizations and memberships are created as a pair sharing one backing
 * store, since listForUser's join has to be simulated somewhere — this
 * keeps that simulation in one place instead of reaching into the other
 * repository's internals.
 */
export function createInMemoryOrganizationRepositories(): {
  organizations: OrganizationRepository;
  memberships: MembershipRepository;
} {
  const orgs = new Map<string, Organization>();
  const memberships: OrganizationMembership[] = [];

  const organizations: OrganizationRepository = {
    async create(newOrg: NewOrganization) {
      const now = new Date();
      const org: Organization = { id: randomUUID(), ...newOrg, createdAt: now, updatedAt: now };
      orgs.set(org.id, org);
      return org;
    },
    async findById(id) {
      return orgs.get(id);
    },
    async findBySlug(slug) {
      return [...orgs.values()].find((o) => o.slug === slug);
    },
    async listForUser(userId) {
      const orgIds = new Set(
        memberships.filter((m) => m.userId === userId).map((m) => m.organizationId),
      );
      return [...orgs.values()].filter((o) => orgIds.has(o.id));
    },
    async update(id, changes) {
      const existing = orgs.get(id);
      if (!existing) return undefined;
      const updated = applyDefined(existing, changes);
      updated.updatedAt = new Date();
      orgs.set(id, updated);
      return updated;
    },
  };

  const membershipRepo: MembershipRepository = {
    async create(newMembership: NewOrganizationMembership) {
      // Mirrors the real unique(organization_id, user_id) constraint from
      // the migration (see db/migrations) — a real Postgres insert would
      // throw a unique-violation here too.
      const duplicate = memberships.some(
        (m) =>
          m.organizationId === newMembership.organizationId && m.userId === newMembership.userId,
      );
      if (duplicate) {
        throw new Error(
          `Duplicate membership: user ${newMembership.userId} is already a member of organization ${newMembership.organizationId}`,
        );
      }

      const membership: OrganizationMembership = {
        id: randomUUID(),
        ...newMembership,
        createdAt: new Date(),
      };
      memberships.push(membership);
      return membership;
    },
    async findByOrgAndUser(organizationId, userId) {
      return memberships.find((m) => m.organizationId === organizationId && m.userId === userId);
    },
    async listByUser(userId) {
      return memberships.filter((m) => m.userId === userId);
    },
  };

  return { organizations, memberships: membershipRepo };
}

export function createInMemoryBusinessProfileRepository(): BusinessProfileRepository {
  const profiles = new Map<string, BusinessProfile>();

  return {
    async findByOrganizationId(organizationId) {
      return [...profiles.values()].find((p) => p.organizationId === organizationId);
    },
    async create(newProfile: NewBusinessProfile) {
      const now = new Date();
      const profile: BusinessProfile = {
        id: randomUUID(),
        organizationId: newProfile.organizationId,
        businessName: newProfile.businessName,
        description: newProfile.description ?? null,
        phone: newProfile.phone ?? null,
        email: newProfile.email ?? null,
        website: newProfile.website ?? null,
        address: newProfile.address ?? null,
        timezone: newProfile.timezone ?? "UTC",
        createdAt: now,
        updatedAt: now,
      };
      profiles.set(profile.id, profile);
      return profile;
    },
    async update(organizationId, changes) {
      const existing = [...profiles.values()].find((p) => p.organizationId === organizationId);
      if (!existing) return undefined;
      const updated = applyDefined(existing, changes);
      updated.updatedAt = new Date();
      profiles.set(existing.id, updated);
      return updated;
    },
  };
}

export function createInMemoryBusinessHoursRepository(): BusinessHoursRepository {
  let rows: BusinessHoursEntry[] = [];

  return {
    async listByOrganizationId(organizationId) {
      return rows.filter((r) => r.organizationId === organizationId);
    },
    async replaceAll(organizationId, entries) {
      rows = rows.filter((r) => r.organizationId !== organizationId);
      const created = entries.map((e) => ({ id: randomUUID(), organizationId, ...e }));
      rows.push(...created);
      return created;
    },
  };
}

export function createInMemoryServiceRepository(): ServiceRepository {
  const items = new Map<string, ServiceItem>();

  return {
    async listByOrganizationId(organizationId) {
      return [...items.values()].filter((s) => s.organizationId === organizationId);
    },
    async findByIdAndOrganizationId(id, organizationId) {
      const item = items.get(id);
      return item && item.organizationId === organizationId ? item : undefined;
    },
    async create(newService: NewServiceItem) {
      const now = new Date();
      const item: ServiceItem = {
        id: randomUUID(),
        organizationId: newService.organizationId,
        name: newService.name,
        description: newService.description ?? null,
        durationMinutes: newService.durationMinutes,
        price: newService.price ?? null,
        active: newService.active ?? true,
        createdAt: now,
        updatedAt: now,
      };
      items.set(item.id, item);
      return item;
    },
    async update(id, organizationId, changes) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return undefined;
      const updated = { ...existing, ...changes, updatedAt: new Date() };
      items.set(id, updated);
      return updated;
    },
    async deleteByIdAndOrganizationId(id, organizationId) {
      const existing = items.get(id);
      if (!existing || existing.organizationId !== organizationId) return false;
      items.delete(id);
      return true;
    },
  };
}

export function createInMemoryUnitOfWork(repos: OrganizationCreationRepos): UnitOfWork {
  return {
    // No real transaction semantics needed for a single-threaded test double.
    async run(fn) {
      return fn(repos);
    },
  };
}
