export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOrganization {
  name: string;
  slug: string;
}

// `| undefined` matches zod's inferred type for `.optional()` fields exactly
// (zod itself never assigns a literal `undefined` for an absent field, it
// omits the key — this is a type-level accommodation for
// exactOptionalPropertyTypes, not a runtime behavior change).
export interface OrganizationUpdate {
  name?: string | undefined;
}

export interface OrganizationRepository {
  create(org: NewOrganization): Promise<Organization>;
  findById(id: string): Promise<Organization | undefined>;
  findBySlug(slug: string): Promise<Organization | undefined>;
  /** Every organization the given user has a membership in. */
  listForUser(userId: string): Promise<Organization[]>;
  update(id: string, changes: OrganizationUpdate): Promise<Organization | undefined>;
}

export type MembershipRole = "owner" | "member";

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  createdAt: Date;
}

export interface NewOrganizationMembership {
  organizationId: string;
  userId: string;
  role: MembershipRole;
}

export interface MembershipRepository {
  create(membership: NewOrganizationMembership): Promise<OrganizationMembership>;
  /**
   * The single query every tenant-isolation check is built on: is this user
   * actually a member of this organization? Never trust the caller's claim
   * — always re-derive this from the database. See SECURITY.md.
   */
  findByOrgAndUser(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembership | undefined>;
  listByUser(userId: string): Promise<OrganizationMembership[]>;
}

export interface BusinessProfile {
  id: string;
  organizationId: string;
  businessName: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewBusinessProfile {
  organizationId: string;
  businessName: string;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  timezone?: string;
}

export interface BusinessProfileUpdate {
  businessName?: string | undefined;
  description?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  website?: string | null | undefined;
  address?: string | null | undefined;
  timezone?: string | undefined;
}

export interface BusinessProfileRepository {
  findByOrganizationId(organizationId: string): Promise<BusinessProfile | undefined>;
  create(profile: NewBusinessProfile): Promise<BusinessProfile>;
  update(
    organizationId: string,
    changes: BusinessProfileUpdate,
  ): Promise<BusinessProfile | undefined>;
}

/** JS Date#getDay() convention: 0 = Sunday .. 6 = Saturday. */
export interface BusinessHoursEntry {
  id: string;
  organizationId: string;
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export interface BusinessHoursEntryInput {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export interface BusinessHoursRepository {
  listByOrganizationId(organizationId: string): Promise<BusinessHoursEntry[]>;
  /** Atomically replaces all 7 rows for the organization. */
  replaceAll(
    organizationId: string,
    entries: BusinessHoursEntryInput[],
  ): Promise<BusinessHoursEntry[]>;
}

export interface ServiceItem {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: string | null; // numeric column — kept as a string to avoid float precision loss
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewServiceItem {
  organizationId: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  price?: string | null;
  active?: boolean;
}

export interface ServiceItemUpdate {
  name?: string;
  description?: string | null;
  durationMinutes?: number;
  price?: string | null;
  active?: boolean;
}

export interface ServiceRepository {
  listByOrganizationId(organizationId: string): Promise<ServiceItem[]>;
  /**
   * Every lookup/mutation by id is also scoped by organizationId in the
   * query itself — this is what makes it impossible for a member of one
   * organization to read/modify/delete another organization's service by
   * guessing or reusing an id. See SECURITY.md "Tenant isolation".
   */
  findByIdAndOrganizationId(id: string, organizationId: string): Promise<ServiceItem | undefined>;
  create(service: NewServiceItem): Promise<ServiceItem>;
  update(
    id: string,
    organizationId: string,
    changes: ServiceItemUpdate,
  ): Promise<ServiceItem | undefined>;
  deleteByIdAndOrganizationId(id: string, organizationId: string): Promise<boolean>;
}
