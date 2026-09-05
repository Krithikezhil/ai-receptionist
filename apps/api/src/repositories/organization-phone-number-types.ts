/**
 * M7: maps a Twilio phone number to the organization it rings. Many rows per
 * organization are allowed (id is the primary key, not organizationId) --
 * only phoneNumber itself is unique. See src/db/schema.ts and
 * src/controllers/phone-number.controller.ts.
 */
export interface OrganizationPhoneNumber {
  id: string;
  organizationId: string;
  phoneNumber: string;
  createdAt: Date;
}

export interface NewOrganizationPhoneNumber {
  organizationId: string;
  phoneNumber: string;
}

export interface OrganizationPhoneNumberRepository {
  listByOrganizationId(organizationId: string): Promise<OrganizationPhoneNumber[]>;
  /**
   * Global lookup by the dialed number itself, not scoped to an
   * organization -- this is what the Twilio inbound webhook uses to resolve
   * which organization a call belongs to before any organization id is
   * known. See src/routes/twilio.routes.ts.
   */
  findByPhoneNumber(phoneNumber: string): Promise<OrganizationPhoneNumber | undefined>;
  /**
   * Every lookup/mutation by id is also scoped by organizationId in the
   * query itself -- same tenant-isolation discipline as
   * ServiceRepository.findByIdAndOrganizationId. See SECURITY.md "Tenant
   * isolation".
   */
  findByIdAndOrganizationId(
    id: string,
    organizationId: string,
  ): Promise<OrganizationPhoneNumber | undefined>;
  create(phoneNumber: NewOrganizationPhoneNumber): Promise<OrganizationPhoneNumber>;
  deleteByIdAndOrganizationId(id: string, organizationId: string): Promise<void>;
}
