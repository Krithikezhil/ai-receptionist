export type LeadStatus = "new" | "contacted" | "closed";

export interface Lead {
  id: string;
  organizationId: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  intent: string | null;
  notes: string | null;
  callSid: string | null;
  status: LeadStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewLead {
  organizationId: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  intent?: string | null;
  notes?: string | null;
  callSid?: string | null;
  status?: LeadStatus;
}

export interface LeadStatusUpdate {
  status: LeadStatus;
}

export interface LeadRepository {
  listByOrganizationId(organizationId: string): Promise<Lead[]>;
  /**
   * Every lookup/mutation by id is also scoped by organizationId in the
   * query itself -- this is what makes it impossible for a member of one
   * organization to read/modify/delete another organization's lead by
   * guessing or reusing an id. See SECURITY.md "Tenant isolation". No
   * operation on this interface accepts a bare leadId without an
   * organizationId -- deliberately unrepresentable at the type level, not
   * just unimplemented.
   */
  findByIdAndOrganizationId(id: string, organizationId: string): Promise<Lead | undefined>;
  create(lead: NewLead): Promise<Lead>;
  updateStatus(
    id: string,
    organizationId: string,
    changes: LeadStatusUpdate,
  ): Promise<Lead | undefined>;
  deleteByIdAndOrganizationId(id: string, organizationId: string): Promise<boolean>;
}
